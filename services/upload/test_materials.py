"""Isolated HTTP integration checks; never writes to the live site."""
import contextlib
import http.client
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import types
import unittest
from unittest.mock import patch

# The production CMS sync uses Linux fcntl. Local workflow tests do not enqueue
# public GitHub snapshots, so replace only that unrelated integration on Windows.
if os.name == 'nt':
    sync_stub = types.ModuleType('cms_sync')
    sync_stub.atomic = lambda path, data: path.write_bytes(data)
    sys.modules['cms_sync'] = sync_stub
os.environ.setdefault('UPLOAD_TOKEN', 'local-test-only')
import server
import materials

WEB = Path(__file__).resolve().parents[2] / 'web'


class LocalHandler(server.Handler):
    def log_message(self, *args): pass
    def do_GET(self):
        if self.path.startswith('/api/'):
            return super().do_GET()
        relative = self.path.split('?')[0].lstrip('/') or 'console.html'
        file = (WEB / relative).resolve()
        if not file.is_relative_to(WEB.resolve()) or not file.is_file():
            return self._json(404, {'error':'missing'})
        data = file.read_bytes()
        if file.name == 'app.js':
            data = data.replace(b'__SERVER_CONSOLE_TOKEN__', server.TOKEN.encode())
        import mimetypes
        self.send_response(200)
        self.send_header('Content-Type', mimetypes.guess_type(file.name)[0] or 'application/octet-stream')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)


@contextlib.contextmanager
def fixture():
    with tempfile.TemporaryDirectory(prefix='materials-qa-') as temp:
        root = Path(temp)
        content = json.loads((WEB.parent/'resources/content.json').read_text(encoding='utf-8'))
        content['library']['docs'] = []
        content_file = root/'content.json'
        content_file.write_text(json.dumps(content), encoding='utf-8')
        with patch.object(materials, 'ROOT', root/'private'), patch.object(server, 'DATA_FILE', str(content_file)), patch.object(server, 'DOCS_DIR', str(root/'public/docs')), patch.dict(os.environ, {'CMS_GITHUB_SYNC':'0'}):
            srv = server.ThreadingHTTPServer(('127.0.0.1', 0), LocalHandler)
            thread = threading.Thread(target=srv.serve_forever, daemon=True)
            thread.start()
            try: yield srv
            finally: srv.shutdown(); srv.server_close()


def request(srv, method, path, body=None, auth=True, upload=None):
    headers = {'X-Token':server.TOKEN} if auth else {}
    if upload:
        name, data = upload
        boundary = 'QA-MULTIPART-BOUNDARY'
        chunks=[]
        for key,value in (body or {}).items():
            chunks.append(('--'+boundary+'\r\nContent-Disposition: form-data; name="'+key+'"\r\n\r\n'+str(value)+'\r\n').encode())
        chunks.append(('--'+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="'+name+'"\r\nContent-Type: application/octet-stream\r\n\r\n').encode()+data+b'\r\n')
        chunks.append(('--'+boundary+'--\r\n').encode())
        body = b''.join(chunks)
        headers['Content-Type']='multipart/form-data; boundary='+boundary
    elif body is not None:
        body=json.dumps(body).encode()
        headers['Content-Type']='application/json'
    con=http.client.HTTPConnection('127.0.0.1',srv.server_port,timeout=10)
    con.request(method,path,body,headers)
    reply=con.getresponse();raw=reply.read();status=reply.status
    result=json.loads(raw) if 'json' in (reply.getheader('Content-Type') or '') else raw
    con.close()
    return status,result


class WorkflowTests(unittest.TestCase):
    def test_complete_workflow_and_publication(self):
        with fixture() as srv:
            req=lambda method,path,body=None,**kw:request(srv,method,'/api/materials'+path,body,**kw)
            self.assertEqual(req('GET','',auth=False)[0],403)
            task={'title':'真实材料流程','description':'完成编写与排版','material':'材料同学','designer':'美工同学','designRequired':True,'actor':'操作同学','deadline':'2026-11-25'}
            status,result=req('POST','/tasks',task);self.assertEqual(status,200,result);id=result['id']
            self.assertEqual(req('POST',f'/tasks/{id}/submit',{'note':'缺少文件'})[0],400)
            status,result=req('POST',f'/tasks/{id}/submit',{'note':'初稿','actor':'材料同学'},upload=('draft.md',b'# Draft'))
            self.assertEqual(status,200,result)
            submission=result['id']
            self.assertEqual(req('POST',f'/submissions/{submission}/review',{'action':'return','actor':'审核同学'})[0],400)
            req('POST',f'/submissions/{submission}/review',{'action':'return','actor':'审核同学','comment':'请补充正文'})
            _,result=req('POST',f'/tasks/{id}/submit',{'note':'已补充','actor':'材料同学'},upload=('revised.md',b'# Revised'))
            submission=result['id']
            req('POST',f'/submissions/{submission}/review',{'action':'approve','actor':'审核同学'})
            self.assertEqual(req('GET',f'/tasks/{id}')[1]['task']['stage'],'design')
            self.assertEqual(request(srv,'GET','/api/data')[1]['data']['library']['docs'],[])
            _,result=req('POST',f'/tasks/{id}/submit',{'note':'排版完成','actor':'美工同学'},upload=('final.pdf',b'%PDF-1.4\nfinal'))
            final_id=result['id']
            req('POST',f'/submissions/{final_id}/review',{'action':'approve','actor':'审核同学'})
            self.assertEqual(req('POST',f'/submissions/{final_id}/review',{'action':'approve','actor':'审核同学'})[0],400)
            board=req('GET','')[1];resource=board['resources'][0]
            self.assertEqual(req('GET','/files/'+str(resource['file_id']))[1],b'%PDF-1.4\nfinal')
            self.assertEqual(req('GET','/files/'+str(resource['file_id']),auth=False)[0],403)
            self.assertEqual(request(srv,'GET','/api/data')[1]['data']['library']['docs'],[])
            status,result=req('POST',f"/resources/{resource['id']}/publish",{'grade':'大一','subject':'高等数学'})
            self.assertEqual(status,200,result)
            docs=request(srv,'GET','/api/data')[1]['data']['library']['docs']
            self.assertEqual(len(docs),1)
            req('POST',f"/resources/{resource['id']}/publish",{'grade':'大一','subject':'高等数学'})
            self.assertEqual(len(request(srv,'GET','/api/data')[1]['data']['library']['docs']),1)
            # New submissions do not change the formal file until approved.
            update=dict(task,designRequired=False,resourceId=resource['id'],title='更新资料')
            tid=req('POST','/tasks',update)[1]['id']
            sid=req('POST',f'/tasks/{tid}/submit',{'note':'新版','actor':'材料同学'},upload=('new.md',b'# New'))[1]['id']
            self.assertEqual(req('GET','')[1]['resources'][0]['file_id'],resource['file_id'])
            req('POST',f'/submissions/{sid}/review',{'action':'approve','actor':'审核同学','keepOld':True})
            self.assertEqual(len(req('GET','/versions/'+str(resource['id']))[1]['versions']),1)
            tid=req('POST','/tasks',update)[1]['id']
            sid=req('POST',f'/tasks/{tid}/submit',{'note':'小更新','actor':'材料同学'},upload=('newer.md',b'# Newer'))[1]['id']
            req('POST',f'/submissions/{sid}/review',{'action':'approve','actor':'审核同学','keepOld':False})
            self.assertEqual(len(req('GET','/versions/'+str(resource['id']))[1]['versions']),1)
            self.assertEqual(req('GET','')[1]['resources'][0]['file']['name'],'newer.md')


if __name__ == '__main__':
    if '--serve' in sys.argv:
        with fixture() as srv:
            print('LOCAL_MATERIALS_URL=http://127.0.0.1:'+str(srv.server_port)+'/console.html',flush=True)
            threading.Event().wait()
    else:
        unittest.main()
