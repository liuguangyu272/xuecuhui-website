"""Exercise deployment failures in an isolated temporary tree on Linux."""
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import time

spec=importlib.util.spec_from_file_location('sync',str(Path(__file__).with_name('sync.py')))
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
with tempfile.TemporaryDirectory(prefix='xuecuhui-deploy-test-') as d:
    base=Path(d)
    m.STATE=base/'state'
    m.REPO=base/'repo'
    m.ROOTS={k:base/k for k in ('web','services/console','services/upload')}
    (base/'web/assets').mkdir(parents=True)
    live=base/'web/assets/app.js'
    live.write_text('const version = 0;')
    runtime=base/'web/assets/posters/keep.txt'
    runtime.parent.mkdir()
    runtime.write_text('live upload')
    fixture={'web/assets/app.js':b'const version = 1;'}
    version=['1'*40]
    original_run=m.run
    def fake_run(*args,**kw):
        if args[0]=='git':
            if 'rev-parse' in args: return (version[0]+'\n').encode()
            if 'archive' in args:
                b=io.BytesIO()
                with tarfile.open(fileobj=b,mode='w') as t:
                    for name,data in fixture.items():
                        f=tarfile.TarInfo(name); f.size=len(data); t.addfile(f,io.BytesIO(data))
                return b.getvalue()
            return b''
        if args[0]=='systemctl': return b''
        return original_run(*args,**kw)
    original_atomic=m.atomic
    def safe_atomic(path,data,mode=0o644):
        if str(path)=='/www/wwwroot/xuecuhui/deployment-status.json': path=base/'status.json'
        assert path.is_relative_to(base), path
        original_atomic(path,data,mode)
    m.run=fake_run
    m.atomic=safe_atomic
    m.environment=lambda svc:{'CONSOLE_TOKEN':'test-only','UPLOAD_TOKEN':'test-only'}
    m.health=lambda:None
    m.main()
    assert live.read_text()=='const version = 1;'
    assert runtime.read_text()=='live upload'
    # A health failure must restore prior code and keep the prior deployed commit.
    version[0]='2'*40
    fixture['web/assets/app.js']=b'const version = 2;'
    def failed_health(): raise RuntimeError('simulated failure')
    m.health=failed_health
    original_sleep=time.sleep
    time.sleep=lambda seconds:None
    try:
        try: m.main(); raise AssertionError('health failure was ignored')
        except RuntimeError: pass
    finally: time.sleep=original_sleep
    assert live.read_text()=='const version = 1;'
    assert json.loads((m.STATE/'deployed.json').read_text())['commit']=='1'*40
    # Invalid JS is rejected before copying any live files.
    fixture['web/assets/app.js']=b'const broken = ;'
    try: m.main(); raise AssertionError('invalid syntax was accepted')
    except subprocess.CalledProcessError: pass
    assert live.read_text()=='const version = 1;'
    fixture['web/assets/app.js']=b'const version = 3;'
    fixture['web/assets/posters/overwrite.png']=b'bad'
    try: m.main(); raise AssertionError('runtime upload accepted')
    except RuntimeError as e: assert 'protected runtime data' in str(e)
    assert runtime.read_text()=='live upload'
    assert live.read_text()=='const version = 1;'
    print('PASS: successful deployment, runtime preservation, health-failure rollback, syntax rejection, protected-path rejection')
