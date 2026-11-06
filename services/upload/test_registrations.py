import base64
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import registrations as r

class RegistrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.patch=patch.object(r,'DB',Path(self.tmp.name)/'private/records.sqlite3');self.patch.start()
        self.activity={'id':'lesson','registration':{'enabled':True,'capacity':2,'fields':[{'key':'name','label':'姓名','required':True},{'key':'student','label':'学号','required':True},{'key':'group','label':'场次','type':'select','options':['A','B'],'required':True}]}}
    def tearDown(self):self.patch.stop();self.tmp.cleanup()
    def payload(self,student='001',name='张同学'):
        return {'formVersion':r.version(self.activity),'requestId':'request-'+student+'-1234567890','answers':{'name':name,'student':student,'group':'A'}}
    def excel(self,rows):
        from openpyxl import Workbook
        w=Workbook();s=w.active
        for row in rows:s.append(row)
        data=io.BytesIO();w.save(data);return base64.b64encode(data.getvalue()).decode()
    def test_validation_duplicates_capacity_and_closing(self):
        self.assertTrue(r.submit(self.activity,self.payload(),'ip')['ok'])
        r.submit(self.activity,self.payload(),'ip');self.assertEqual(len(r.rows('lesson')),1)
        r.submit(self.activity,self.payload('002'),'ip')
        with self.assertRaises(ValueError):r.submit(self.activity,self.payload('003'),'ip')
        self.activity['registration']['enabled']=False
        with self.assertRaises(ValueError):r.submit(self.activity,self.payload('004'),'ip')
    def test_schema_version_and_required_options(self):
        p=self.payload();p['formVersion']='stale'
        with self.assertRaises(ValueError):r.submit(self.activity,p,'ip')
        p=self.payload();p['answers']['group']='C'
        with self.assertRaises(ValueError):r.submit(self.activity,p,'ip')
        p=self.payload();p['answers']['name']=''
        with self.assertRaises(ValueError):r.submit(self.activity,p,'ip')
    def test_excel_roundtrip_literal_and_duplicates(self):
        from openpyxl import load_workbook
        r.submit(self.activity,self.payload(name='=1+1'),'ip')
        data=r.export(self.activity)
        w=load_workbook(io.BytesIO(data));self.assertEqual(w.active['C2'].data_type,'s');self.assertEqual(w.active['D2'].value,'001');w.close()
        result=r.import_excel(self.activity,base64.b64encode(data).decode());self.assertEqual(result['added'],0);self.assertEqual(result['skipped'],1)
    def test_invalid_import_is_atomic_and_formula_rejected(self):
        data=self.excel([['姓名','学号','场次'],['甲','001','A'],['乙','002','INVALID']])
        with self.assertRaises(ValueError):r.import_excel(self.activity,data)
        self.assertEqual(r.rows('lesson'),[])
        with self.assertRaises(ValueError):r.import_excel(self.activity,self.excel([['姓名','学号','场次'],['=1+1','001','A']]))
    def test_field_change_preserves_previous_answers(self):
        r.submit(self.activity,self.payload(),'ip')
        self.activity['registration']['fields']=[{'key':'new','label':'备注'}]
        exported=r.export(self.activity)
        from openpyxl import load_workbook
        w=load_workbook(io.BytesIO(exported));self.assertIn('学号（历史字段）',[c.value for c in w.active[1]]);w.close()
    def test_admin_secret_not_legacy_public_token(self):
        class Handler:
            headers={'X-Token':'public-old-token'}
            def _json(self,code,obj):self.code=code
        h=Handler()
        with patch.dict(os.environ,{'REGISTRATION_ADMIN_SECRET':'private-test-secret'}):r.route(h,'/api/registration-admin/list')
        self.assertEqual(h.code,403)

    def test_pdf_upload_for_publication_and_poster(self):
        import threading,urllib.request
        os.environ['UPLOAD_TOKEN']='test-only'
        import server
        boundary='test-media-boundary'
        body=('--'+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="poster.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4\n%%EOF\r\n--'+boundary+'--\r\n').encode()
        with patch.multiple(server,UPLOAD_DIR=str(Path(self.tmp.name)/'posters'),ISSUE_DIR=str(Path(self.tmp.name)/'issue')):
            http=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler);thread=threading.Thread(target=http.serve_forever,daemon=True);thread.start()
            try:
                for route in ('upload','upload-issue'):
                    req=urllib.request.Request('http://127.0.0.1:'+str(http.server_port)+'/api/'+route,data=body,headers={'Content-Type':'multipart/form-data; boundary='+boundary,'X-Token':'test-only'})
                    result=json.load(urllib.request.urlopen(req));self.assertTrue(result['url'].split('?')[0].endswith('.pdf'))
            finally:http.shutdown();http.server_close();thread.join()

if __name__=='__main__':unittest.main()
