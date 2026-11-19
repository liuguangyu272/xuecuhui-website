"""Isolated HTTP tests for identities, authorization and audit attribution."""
import http.client
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import identity


class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def do_GET(self): self.dispatch()
    def do_POST(self): self.dispatch()
    def dispatch(self):
        path=self.path.split('?')[0]
        if identity.route(self,path): return
        if path == '/edit':
            try:
                identity.require_user(self)
                size=int(self.headers.get('Content-Length','0'))
                data=json.loads(self.rfile.read(size))
                # Deliberately ignore the supplied actor; attribution is server-owned.
                identity.audit(self,'修改公告','测试公告',{'announcements':[{'id':'a1','title':'旧标题'}]}, {'announcements':[{'id':'a1','title':'新标题'}]})
                identity.reply(self,200,{'ok':True})
            except identity.AccessError as error:
                identity.reply(self,error.status,{'ok':False})
        else: identity.reply(self,404,{'ok':False})


class IdentityTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.patches=[patch.object(identity,'ROOT',Path(self.temp.name)),
                      patch.object(identity,'OWNER_IDENTITY_HASH',identity.digest('测试所有者|ADMIN1001')),
                      patch.dict(identity.os.environ,{'UPLOAD_TOKEN':'internal-test-only'})]
        for p in self.patches:p.start()
        self.server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True)
        self.thread.start()
        self.owner=None
    def tearDown(self):
        self.server.shutdown();self.server.server_close()
        for p in reversed(self.patches):p.stop()
        self.temp.cleanup()
    def call(self,path,body=None,cookie=None,internal=False,method=None):
        conn=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=10)
        headers={}
        if cookie:headers['Cookie']=cookie
        if internal:headers['X-Internal-Token']='internal-test-only'
        if body is not None:headers['Content-Type']='application/json'
        conn.request(method or ('POST' if body is not None else 'GET'),path,json.dumps(body).encode() if body is not None else None,headers)
        response=conn.getresponse();result=json.loads(response.read());status=response.status
        cookie=(response.getheader('Set-Cookie') or '').split(';')[0]
        conn.close()
        return status,result,cookie
    def bootstrap(self):
        status,data,cookie=self.call('/api/auth/bootstrap',{'name':'测试所有者','studentId':'ADMIN1001'},internal=True)
        self.assertEqual(status,201,data);self.owner=cookie
        return data['user']
    def test_login_members_audit_and_revoke(self):
        self.assertTrue(self.call('/api/auth/session')[1]['setupRequired'])
        self.assertEqual(self.call('/api/auth/bootstrap',{'name':'其他人','studentId':'OTHER1001'},internal=True)[0],403)
        self.assertEqual(self.call('/api/auth/bootstrap',{'name':'测试所有者','studentId':'ADMIN1001'})[0],403)
        owner=self.bootstrap()
        self.assertFalse(self.call('/api/auth/session')[1]['setupRequired'])
        self.assertEqual(self.call('/api/auth/bootstrap',{'name':'测试所有者','studentId':'ADMIN1001'},internal=True)[0],409)
        self.assertEqual(self.call('/api/auth/members')[0],401)
        data={'academicYear':'2026-2027','members':[
            {'name':'材料同学','studentId':'STU1001','department':'材料部'},
            {'name':'材料同学','studentId':'STU1001','department':'教学部'}]}
        status,imported,_=self.call('/api/auth/import',data,self.owner)
        self.assertEqual(status,200,imported);self.assertEqual(imported['created'],1)
        members=self.call('/api/auth/members',cookie=self.owner)[1]['members']
        member=next(v for v in members if v['studentId']=='STU1001')
        self.assertEqual(member['department'],'材料部、教学部')
        self.assertEqual(self.call('/api/auth/login',{'name':'错误姓名','studentId':'STU1001'})[0],401)
        status,logged,session=self.call('/api/auth/login',{'name':'材料同学','studentId':'STU1001'})
        self.assertEqual(status,200,logged)
        self.assertEqual(self.call('/api/auth/members',cookie=session)[0],403)
        self.assertEqual(self.call('/api/auth/import',data,session)[0],403)
        self.assertEqual(self.call('/edit',{'actor':'冒充的管理员'},session)[0],200)
        entries=self.call('/api/auth/audit',cookie=self.owner)[1]['entries']
        edit=next(v for v in entries if v['action']=='修改公告')
        self.assertEqual(edit['userName'],'材料同学')
        self.assertEqual(edit['changes'][0]['path'],'announcements[id=a1].title')
        self.assertEqual(edit['changes'][0]['before'],'旧标题')
        self.assertNotIn('STU1001',json.dumps(entries,ensure_ascii=False))
        self.assertEqual(self.call('/api/auth/members',{'id':owner['id'],'enabled':False},self.owner)[0],403)
        self.assertEqual(self.call('/api/auth/members',{'id':member['id'],'enabled':False},self.owner)[0],200)
        self.assertIsNone(self.call('/api/auth/session',cookie=session)[1]['user'])
        self.assertEqual(self.call('/api/auth/login',{'name':'材料同学','studentId':'STU1001'})[0],401)
    def test_import_atomic_and_rate_limit_is_per_identity(self):
        self.bootstrap()
        items=[{'name':'甲同学','studentId':'STU2001'},{'name':'乙同学','studentId':'STU2001'}]
        self.assertEqual(self.call('/api/auth/import',{'members':items},self.owner)[0],400)
        self.assertEqual(len(self.call('/api/auth/members',cookie=self.owner)[1]['members']),1)
        for _ in range(30):self.assertEqual(self.call('/api/auth/login',{'name':'未知同学','studentId':'UNKNOWN1'})[0],401)
        self.assertEqual(self.call('/api/auth/login',{'name':'未知同学','studentId':'UNKNOWN1'})[0],429)
        self.assertEqual(self.call('/api/auth/login',{'name':'测试所有者','studentId':'ADMIN1001'})[0],200)
        for _ in range(32):self.assertEqual(self.call('/api/auth/login',{'name':'测试所有者','studentId':'ADMIN1001'})[0],200)
    def test_internal_audit_requires_session_and_server_credential(self):
        self.bootstrap()
        payload={'action':'修改题库','target':'药化','before':{'title':'A'},'after':{'title':'B','token':'secret'}}
        self.assertEqual(self.call('/api/auth/internal-audit',payload,internal=True)[0],401)
        self.assertEqual(self.call('/api/auth/internal-audit',payload,self.owner)[0],403)
        self.assertEqual(self.call('/api/auth/internal-audit',payload,self.owner,internal=True)[0],200)
        entries=self.call('/api/auth/audit',cookie=self.owner)[1]['entries']
        self.assertNotIn('secret',json.dumps(entries))
        self.call('/api/auth/logout',{},self.owner)
        self.assertIsNone(self.call('/api/auth/session',cookie=self.owner)[1]['user'])
    def test_audit_changes_scope_filters_before_pagination_without_deleting(self):
        self.bootstrap()
        self.call('/api/auth/login',{'name':'测试所有者','studentId':'ADMIN1001'})
        self.call('/api/auth/internal-audit',{'action':'保存网站内容','before':{'title':'相同'},'after':{'title':'相同'}},self.owner,internal=True)
        self.call('/api/auth/internal-audit',{'action':'保存网站内容','before':{'updatedAt':'昨天'},'after':{'updatedAt':'今天'}},self.owner,internal=True)
        self.call('/edit',{},self.owner)
        self.call('/api/auth/login',{'name':'测试所有者','studentId':'ADMIN1001'})
        all_events=self.call('/api/auth/audit',cookie=self.owner)[1]
        filtered=self.call('/api/auth/audit?scope=changes&limit=1',cookie=self.owner)[1]
        self.assertEqual(filtered['entries'][0]['action'],'修改公告')
        self.assertEqual(filtered['total'],2)  # bootstrap and actual edit
        self.assertTrue(filtered['hasMore'])
        second=self.call('/api/auth/audit?scope=changes&limit=1&offset=1',cookie=self.owner)[1]
        self.assertEqual(second['entries'][0]['action'],'初始化网站管理员')
        self.assertFalse(second['hasMore'])
        self.assertEqual(all_events['total'],6)
        self.assertEqual(len(self.call('/api/auth/audit',cookie=self.owner)[1]['entries']),6)
        self.assertEqual(self.call('/api/auth/audit?scope=changes')[0],401)

    def test_admin_self_demotion_keeps_audit_then_revokes(self):
        self.bootstrap()
        status,data,_=self.call('/api/auth/members',{'name':'其他管理员','studentId':'SECOND1','role':'admin'},self.owner)
        self.assertEqual(status,200,data)
        member=data['member']
        session=self.call('/api/auth/login',{'name':'其他管理员','studentId':'SECOND1'})[2]
        self.assertEqual(self.call('/api/auth/members',{'id':member['id'],'role':'member'},session)[0],200)
        self.assertIsNone(self.call('/api/auth/session',cookie=session)[1]['user'])
        edits=self.call('/api/auth/audit',cookie=self.owner)[1]['entries']
        self.assertEqual(next(e for e in edits if e['target']=='成员 #'+str(member['id']))['userName'],'其他管理员')


if __name__=='__main__':unittest.main()
