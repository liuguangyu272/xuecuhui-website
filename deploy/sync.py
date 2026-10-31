#!/usr/bin/env python3
"""Installed outside the checkout. Pull main and atomically update managed code only."""
import datetime
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import shlex
import subprocess
import tarfile
import tempfile
import urllib.request

STATE = Path('/var/lib/xuecuhui-deploy')
REPO = STATE / 'repo'
KEY = '/root/.ssh/xuecuhui_github_deploy'
ROOTS = {'web': Path('/www/wwwroot/xuecuhui'),
         'services/console': Path('/opt/xuecuhui-console'),
         'services/upload': Path('/opt/xuecuhui-upload')}

def run(*args, **kw):
    return subprocess.check_output(args, stderr=subprocess.STDOUT, **kw)

def allowed(prefix, rel):
    s = rel.as_posix()
    if any(x.startswith('.') or '.bak' in x or x in ('__pycache__', 'node_modules', '_versions', 'data') for x in rel.parts): return False
    if '单文件' in s: return False
    if prefix == 'web':
        if s.startswith(('assets/posters/', 'assets/docs/', 'assets/issue/')): return False
        if len(rel.parts) == 2 and rel.parts[0] in ('yaofen','yaoji') and rel.name.startswith('data_'): return False
        if s in ('yaohua/index.html','yaohua/molecules.js'): return False
    if prefix == 'services/console':
        if s == 'content_data.js': return False
        if s.startswith('yaohua-src/') and s != 'yaohua-src/index.html': return False
    return True

def atomic(path, data, mode=0o644):
    missing=[]
    parent=path.parent
    while not parent.exists():
        missing.append(parent)
        parent=parent.parent
    path.parent.mkdir(parents=True, exist_ok=True)
    for parent in missing: parent.chmod(0o755)
    fd, tmp = tempfile.mkstemp(prefix='.deploy-', dir=str(path.parent))
    try:
        with os.fdopen(fd,'wb') as f: f.write(data)
        os.chmod(tmp,mode)
        os.replace(tmp,path)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)

def environment(service):
    raw = run('systemctl','show',service,'--property=Environment','--value').decode()
    return dict(x.split('=',1) for x in shlex.split(raw) if '=' in x)

def health():
    for url in ('http://127.0.0.1/', 'http://127.0.0.1/api/health', 'http://127.0.0.1/api/data'):
        with urllib.request.urlopen(url,timeout=15) as r:
            data=r.read()
            if '/api/' in url and not json.loads(data).get('ok'): raise RuntimeError('API health check failed')
    for service in ('xuecuhui-console','xuecuhui-upload'):
        run('systemctl','is-active','--quiet',service)

def main():
    STATE.mkdir(parents=True,exist_ok=True)
    lock=(STATE/'lock').open('w')
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    env=dict(os.environ, GIT_SSH_COMMAND='ssh -i '+KEY+' -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15')
    run('git','-C',str(REPO),'fetch','--quiet','origin','main',env=env,timeout=240)
    sha=run('git','-C',str(REPO),'rev-parse','FETCH_HEAD').decode().strip()
    previous=json.loads((STATE/'deployed.json').read_text()) if (STATE/'deployed.json').exists() else {'files':[]}
    if previous.get('commit') == sha: return
    tokens=environment('xuecuhui-console')
    upload_tokens=environment('xuecuhui-upload')
    if not tokens.get('CONSOLE_TOKEN') or not upload_tokens.get('UPLOAD_TOKEN'): raise RuntimeError('Missing server tokens')
    if tokens['CONSOLE_TOKEN'] != upload_tokens['UPLOAD_TOKEN']: raise RuntimeError('Existing frontend expects matching console/upload tokens')
    archive=run('git','-C',str(REPO),'archive',sha,timeout=30)
    with tempfile.TemporaryDirectory(prefix='stage-',dir=str(STATE)) as temp:
        stage=Path(temp)
        with tarfile.open(fileobj=io.BytesIO(archive)) as t:
            for item in t.getmembers():
                if item.issym() or item.islnk() or not (item.isfile() or item.isdir()): raise RuntimeError('Nonregular repository entry')
            # Git archive has repository-relative paths only; reject traversal explicitly.
            for item in t.getmembers():
                if item.name.startswith('/') or '..' in Path(item.name).parts: raise RuntimeError('Invalid archive path')
            t.extractall(stage)
        files={}
        for prefix,root in ROOTS.items():
            for source in (stage/prefix).rglob('*'):
                if not source.is_file(): continue
                rel=source.relative_to(stage/prefix)
                if not allowed(prefix,rel): raise RuntimeError('Repository contains protected runtime data: '+str(rel))
                data=source.read_bytes()
                if source.suffix in ('.js','.html'):
                    literal=json.dumps(tokens['CONSOLE_TOKEN']).encode()
                    data=data.replace(b"'__SERVER_CONSOLE_TOKEN__'",literal).replace(b'"__SERVER_CONSOLE_TOKEN__"',literal)
                    source.write_bytes(data)
                if source.suffix == '.js': run('node','--check',str(source),timeout=25)
                if source.suffix == '.py': compile(data,str(source),'exec')
                files[str(root/rel)]=data
        # Removed managed files can be deleted; runtime paths are never eligible.
        old_files=set(previous.get('files',[]))
        for old in old_files:
            p=Path(old)
            if not any(p.is_relative_to(root) and allowed(prefix,p.relative_to(root)) for prefix,root in ROOTS.items()): raise RuntimeError('Invalid deployment manifest')
        changed={p:d for p,d in files.items() if not Path(p).exists() or Path(p).read_bytes()!=d}
        removed=old_files-set(files)
        if any(Path(p).is_symlink() for p in set(changed)|removed): raise RuntimeError('Unexpected symlink target')
        # The content-console generates this page from its live data after UI changes.
        template='/opt/xuecuhui-console/yaohua-src/index.html'
        rebuild=template in changed and (not Path(template).exists() or Path(template).read_bytes().replace(b'\r\n',b'\n') != changed[template].replace(b'\r\n',b'\n'))
        extra={'/www/wwwroot/xuecuhui/yaohua/index.html'} if rebuild else set()
        stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+sha[:12]
        backup=STATE/'backups'/stamp
        backup.mkdir(parents=True)
        prior={}
        for p in set(changed)|removed|extra:
            path=Path(p)
            prior[p]={'exists':path.exists(),'mode':path.stat().st_mode & 0o777 if path.exists() else 0o644}
            if path.exists():
                dest=backup/p.lstrip('/')
                dest.parent.mkdir(parents=True,exist_ok=True)
                dest.write_bytes(path.read_bytes())
        (backup/'manifest.json').write_text(json.dumps(prior,indent=2))
        restart=[]
        for prefix,svc in [('services/console','xuecuhui-console'),('services/upload','xuecuhui-upload')]:
            if any(Path(p).is_relative_to(ROOTS[prefix]) for p in set(changed)|removed): restart.append(svc)
        try:
            for p,data in changed.items(): atomic(Path(p),data,prior[p]['mode'])
            for p in removed: Path(p).unlink(missing_ok=True)
            if rebuild:
                result=json.loads(run('/usr/bin/python3','/opt/xuecuhui-console/build_single.py',timeout=180))
                if not result.get('ok'): raise RuntimeError('Drug chemistry page rebuild failed')
            for svc in restart: run('systemctl','restart',svc)
            # A restart can precede socket readiness; use bounded health retries.
            import time
            for attempt in range(10):
                try: health(); break
                except Exception:
                    if attempt==9: raise
                    time.sleep(1)
        except Exception:
            for p,meta in prior.items():
                if meta['exists']: atomic(Path(p),(backup/p.lstrip('/')).read_bytes(),meta['mode'])
                else: Path(p).unlink(missing_ok=True)
            for svc in restart: run('systemctl','restart',svc)
            raise
        manifest={'commit':sha,'deployed_at':stamp,'files':sorted(files),'backup':str(backup)}
        atomic(STATE/'deployed.json',json.dumps(manifest,indent=2).encode(),0o600)
        # Public status contains no credentials or runtime data.
        status={'commit':sha,'deployed_at':stamp}
        atomic(Path('/www/wwwroot/xuecuhui/deployment-status.json'),json.dumps(status).encode())
        print('Deployed '+sha+'; changed='+str(len(changed))+'; removed='+str(len(removed)),flush=True)

if __name__=='__main__': main()
