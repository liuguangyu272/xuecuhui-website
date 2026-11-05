"""Durable CMS snapshots and GitHub Git Data API commits. No credentials in responses."""
import base64
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import tempfile
import time
import urllib.error
import urllib.request

STATE = Path(os.environ.get('CMS_SYNC_STATE', '/var/lib/xuecuhui-cms-sync'))
WEB = Path(os.environ.get('CMS_WEB_ROOT', '/www/wwwroot/xuecuhui'))
EDITOR = Path(os.environ.get('CMS_EDITOR_ROOT', '/opt/xuecuhui-console'))
DATA = Path(os.environ.get('DATA_FILE', '/opt/xuecuhui-upload/data/content.json'))
REPO = os.environ.get('CMS_GITHUB_REPO', 'liuguangyu272/xuecuhui-website')
BRANCH = os.environ.get('CMS_GITHUB_BRANCH', 'main')
TOKEN_FILE = Path(os.environ.get('CMS_GITHUB_TOKEN_FILE', '/etc/xuecuhui/github-token'))

class Conflict(Exception): pass

def atomic(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent))
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(data); f.flush(); os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)

@contextlib.contextmanager
def db():
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    con = sqlite3.connect(STATE/'queue.sqlite3', timeout=30)
    con.execute('PRAGMA journal_mode=WAL')
    con.execute('PRAGMA synchronous=FULL')
    con.execute('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    con.execute('CREATE TABLE IF NOT EXISTS jobs (id INTEGER PRIMARY KEY, snapshot TEXT NOT NULL, status TEXT NOT NULL DEFAULT "pending", commit_sha TEXT, error TEXT)')
    try:
        yield con
        con.commit()
    except BaseException:
        con.rollback(); raise
    finally: con.close()

def meta(con, key, default=None):
    row=con.execute('SELECT value FROM meta WHERE key=?',(key,)).fetchone()
    return json.loads(row[0]) if row else default

def put(con,key,value):
    con.execute('INSERT OR REPLACE INTO meta VALUES (?,?)',(key,json.dumps(value)))

def gitsha(data): return hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()

def managed(path):
    return (path == 'resources/content.json' or path == 'resources/editor/content_data.js'
        or path == 'resources/editor/yaohua/molecules.js'
        or path.startswith('resources/editor/yaohua/img/')
        or re.fullmatch(r'resources/question-banks/(yaofen|yaoji)/data_[a-z]+\.js',path) is not None
        or path == 'resources/question-banks/yaohua/molecules.js'
        or re.fullmatch(r'resources/assets/(docs|posters|issue)/[A-Za-z0-9_.-]+',path) is not None
        or path == 'resources/cms-manifest.json')

def read_stable(path):
    if path.is_symlink(): raise ValueError('Symlink is not publishable')
    before=path.stat(); data=path.read_bytes(); after=path.stat()
    if (before.st_size,before.st_mtime_ns)!=(after.st_size,after.st_mtime_ns):
        raise RuntimeError('Content is changing; retry snapshot')
    return data

def snapshot():
    marker=EDITOR/'.cms-publishing'
    if marker.exists():
        try: os.kill(int(marker.read_text()),0)
        except ProcessLookupError: marker.unlink(missing_ok=True)
        else: raise RuntimeError('Question bank publication in progress')
    seen={}
    def read(path):
        data=read_stable(path)
        stat=path.stat(); seen[path]=(stat.st_mtime_ns,stat.st_size)
        return data
    content=read(DATA)
    parsed=json.loads(content)
    result={'resources/content.json':content}
    refs=set(re.findall(r'assets/(?:docs|posters|issue)/[A-Za-z0-9_.-]+',json.dumps(parsed,ensure_ascii=False)))
    for ref in refs:
        path=WEB/ref
        if not path.resolve().is_relative_to(WEB.resolve()): raise ValueError('Invalid upload path')
        result['resources/'+ref]=read(path)
    for subject in ('yaofen','yaoji'):
        for p in sorted((WEB/subject).glob('data_*.js')):
            result['resources/question-banks/'+subject+'/'+p.name]=read(p)
    for p,target in [(WEB/'yaohua/molecules.js','resources/question-banks/yaohua/molecules.js'),
                     (EDITOR/'content_data.js','resources/editor/content_data.js'),
                     (EDITOR/'yaohua-src/molecules.js','resources/editor/yaohua/molecules.js')]:
        if p.exists(): result[target]=read(p)
    molecules=result.get('resources/editor/yaohua/molecules.js',b'').decode('utf-8')
    for ref in set(re.findall(r'"img"\s*:\s*"(img/[^"?]+)"',molecules)):
        if '..' in Path(ref).parts: raise ValueError('Invalid molecule image path')
        result['resources/editor/yaohua/'+ref]=read(EDITOR/'yaohua-src'/ref)
    for path,stamp in seen.items():
        stat=path.stat()
        if stamp!=(stat.st_mtime_ns,stat.st_size): raise RuntimeError('Concurrent publication; retry snapshot')
    if marker.exists(): raise RuntimeError('Concurrent question bank publication; retry snapshot')
    return result

def enqueue():
    """Persist immutable files before acknowledging a publication; no network call."""
    STATE.mkdir(parents=True,exist_ok=True,mode=0o700)
    with (STATE/'capture.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        files=snapshot()
        manifest={p:{'sha256':hashlib.sha256(d).hexdigest(),'bytes':len(d)} for p,d in sorted(files.items())}
        files['resources/cms-manifest.json']=(json.dumps({'files':manifest},ensure_ascii=False,indent=2)+'\n').encode()
        items={}
        for path,data in files.items():
            if not managed(path): raise ValueError('Unexpected publish path')
            sha=gitsha(data); dest=STATE/'objects'/sha
            if not dest.exists(): atomic(dest,data)
            items[path]=sha
        signature=hashlib.sha256(json.dumps(items,sort_keys=True).encode()).hexdigest()
        with db() as con:
            if meta(con,'last_snapshot')==signature: return None
            cur=con.execute('INSERT INTO jobs(snapshot) VALUES (?)',(json.dumps(items,sort_keys=True),))
            put(con,'last_snapshot',signature)
            return cur.lastrowid

def status():
    with db() as con:
        counts=dict(con.execute('SELECT status,COUNT(*) FROM jobs GROUP BY status'))
        last=con.execute('SELECT id,status,commit_sha,error FROM jobs ORDER BY id DESC LIMIT 1').fetchone()
    return {'counts':counts,'latest':dict(zip(('id','status','commit','error'),last)) if last else None}

def api(method,path,body=None):
    token=TOKEN_FILE.read_text().strip()
    if not token: raise RuntimeError('GitHub credential is not configured')
    headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','User-Agent':'Xuecuhui-CMS','X-GitHub-Api-Version':'2022-11-28'}
    data=json.dumps(body).encode() if body is not None else None
    if data is not None: headers['Content-Type']='application/json'
    request=urllib.request.Request('https://api.github.com/repos/'+REPO+'/'+path,data=data,headers=headers,method=method)
    with urllib.request.urlopen(request,timeout=120) as response: return json.load(response)

def remote():
    head=api('GET','git/ref/heads/'+BRANCH)['object']['sha']
    tree=api('GET','git/commits/'+head)['tree']['sha']
    listing=api('GET','git/trees/'+tree+'?recursive=1')
    if listing.get('truncated'): raise RuntimeError('Repository tree is truncated')
    return head,tree,{e['path']:e['sha'] for e in listing['tree'] if e['type']=='blob' and managed(e['path'])}

def initialize():
    """Explicit bootstrap: current live CMS is authoritative for the first export."""
    _,_,files=remote()
    with db() as con:
        if meta(con,'baseline') is None: put(con,'baseline',files)

def process_one():
    with db() as con:
        job=con.execute('SELECT id,snapshot,status FROM jobs WHERE status != "done" ORDER BY id LIMIT 1').fetchone()
        baseline=meta(con,'baseline')
    if not job or job[2]=='conflict': return False
    if baseline is None: raise RuntimeError('Run initialize before syncing')
    ident,encoded,_=job; desired=json.loads(encoded)
    try:
        for attempt in range(3):
            head,tree,current=remote()
            paths=set(baseline)|set(desired)
            changed=[p for p in paths if baseline.get(p)!=desired.get(p)]
            conflicts=[p for p in changed if current.get(p) not in (baseline.get(p),desired.get(p))]
            if conflicts: raise Conflict('Remote content changed: '+', '.join(sorted(conflicts)))
            entries=[]
            for path in sorted(changed):
                sha=desired.get(path)
                if sha==current.get(path): continue
                if sha:
                    data=(STATE/'objects'/sha).read_bytes()
                    result=api('POST','git/blobs',{'content':base64.b64encode(data).decode(),'encoding':'base64'})
                    if result['sha']!=sha: raise RuntimeError('Blob checksum mismatch')
                entries.append({'path':path,'mode':'100644','type':'blob','sha':sha})
            commit=head
            if entries:
                newtree=api('POST','git/trees',{'base_tree':tree,'tree':entries})['sha']
                commit=api('POST','git/commits',{'message':'CMS publish #'+str(ident),'tree':newtree,'parents':[head]})['sha']
                try: api('PATCH','git/refs/heads/'+BRANCH,{'sha':commit,'force':False})
                except urllib.error.HTTPError as error:
                    if error.code in (409,422) and attempt<2: continue
                    raise
            with db() as con:
                # Preserve unrelated remote edits in the baseline; only acknowledge our changes.
                for path in changed:
                    if path in desired: baseline[path]=desired[path]
                    else: baseline.pop(path,None)
                put(con,'baseline',baseline)
                con.execute('UPDATE jobs SET status="done",commit_sha=?,error=NULL WHERE id=?',(commit,ident))
            return True
    except Conflict as error:
        with db() as con: con.execute('UPDATE jobs SET status="conflict",error=? WHERE id=?',(str(error),ident))
    except Exception as error:
        # HTTP bodies and request headers can include sensitive information; never log them.
        message='GitHub HTTP '+str(error.code) if isinstance(error,urllib.error.HTTPError) else type(error).__name__
        with db() as con: con.execute('UPDATE jobs SET error=? WHERE id=?',(message,ident))
    return False

def worker():
    STATE.mkdir(parents=True,exist_ok=True,mode=0o700)
    with (STATE/'worker.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        while True:
            try:
                # Recovery scan catches a crash between a local write and enqueue.
                enqueue()
                if process_one(): continue
            except Exception as error: print('CMS sync: '+type(error).__name__,flush=True)
            time.sleep(15)

def resolve_local():
    """Explicit administrator decision; GitHub's previous content stays in Git history."""
    _,_,current=remote()
    with db() as con:
        job=con.execute('SELECT id FROM jobs WHERE status="conflict" ORDER BY id LIMIT 1').fetchone()
        if not job: raise RuntimeError('No conflict to resolve')
        put(con,'baseline',current)
        con.execute('UPDATE jobs SET status="pending",error=NULL WHERE id=?',(job[0],))

if __name__=='__main__':
    command=sys.argv[1] if len(sys.argv)>1 else 'status'
    if command=='initialize': initialize()
    elif command=='capture': enqueue()
    elif command=='worker': worker()
    elif command=='status': print(json.dumps(status()))
    elif command=='resolve' and sys.argv[2:]==['--accept-local']: resolve_local()
    else: raise SystemExit('Use initialize, capture, worker or status')
