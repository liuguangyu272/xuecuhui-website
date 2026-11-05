import base64
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

import cms_sync as sync

class SyncTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.root=Path(self.tmp.name)
        self.config=patch.multiple(sync,STATE=self.root/'state',WEB=self.root/'web',EDITOR=self.root/'editor',DATA=self.root/'content.json')
        self.config.start()
        sync.WEB.mkdir(); sync.EDITOR.mkdir()
        sync.DATA.write_text(json.dumps({'announcements':[],'activities':[]}))
        self.files={}; self.commits=[]; self.fail=False; self.race=False
        self.remote_patch=patch.object(sync,'remote',side_effect=lambda:('head'+str(len(self.commits)),'tree',dict(self.files)))
        self.api_patch=patch.object(sync,'api',side_effect=self.api)
        self.remote_patch.start(); self.api_patch.start()
        sync.initialize()

    def tearDown(self):
        self.api_patch.stop();self.remote_patch.stop();self.config.stop();self.tmp.cleanup()

    def api(self,method,path,body=None):
        if self.fail: raise urllib.error.HTTPError('redacted',503,'offline',{},None)
        if path=='git/blobs': return {'sha':sync.gitsha(base64.b64decode(body['content']))}
        if path=='git/trees': self.entries=body['tree'];return {'sha':'newtree'}
        if path=='git/commits': return {'sha':'newcommit'}
        if method=='PATCH':
            assert body['force'] is False
            if self.race:
                self.race=False
                raise urllib.error.HTTPError('redacted',422,'race',{},None)
            for e in self.entries:
                if e['sha'] is None:self.files.pop(e['path'],None)
                else:self.files[e['path']]=e['sha']
            self.commits.append(dict(self.files));return {}
        raise AssertionError((method,path))

    def test_create_modify_delete_articles_and_images(self):
        image=sync.WEB/'assets/posters/a.png';image.parent.mkdir(parents=True);image.write_bytes(b'image-one')
        sync.DATA.write_text(json.dumps({'announcements':[{'id':'a','image':'assets/posters/a.png'}],'activities':[]}))
        sync.enqueue();self.assertTrue(sync.process_one())
        self.assertIn('resources/assets/posters/a.png',self.files)
        image.write_bytes(b'image-two');sync.enqueue();self.assertTrue(sync.process_one())
        self.assertEqual(self.files['resources/assets/posters/a.png'],sync.gitsha(b'image-two'))
        sync.DATA.write_text(json.dumps({'announcements':[],'activities':[]}))
        sync.enqueue();self.assertTrue(sync.process_one())
        self.assertNotIn('resources/assets/posters/a.png',self.files)
        self.assertTrue(image.exists()) # Recovery copy remains on the live server.
        self.assertEqual(len(self.commits),3)

    def test_offline_queue_survives_reopen_and_retries(self):
        sync.enqueue();self.fail=True
        self.assertFalse(sync.process_one())
        self.assertEqual(sync.status()['counts'],{'pending':1})
        self.assertTrue(sync.DATA.exists())
        self.fail=False;self.assertTrue(sync.process_one())
        self.assertEqual(sync.status()['counts'],{'done':1})

    def test_remote_conflict_preserves_both_versions(self):
        sync.enqueue();sync.process_one()
        sync.DATA.write_text(json.dumps({'announcements':[{'id':'local'}]}))
        sync.enqueue();self.files['resources/content.json']='remote-edit'
        self.assertFalse(sync.process_one())
        self.assertEqual(sync.status()['counts']['conflict'],1)
        self.assertEqual(self.files['resources/content.json'],'remote-edit')
        self.assertIn('local',sync.DATA.read_text())
        self.assertEqual(len(self.commits),1)

    def test_nonfastforward_retry_and_idempotency(self):
        sync.enqueue();self.race=True
        self.assertTrue(sync.process_one())
        self.assertIsNone(sync.enqueue())
        self.assertEqual(len(self.commits),1)

    def test_pending_publications_keep_individual_versions(self):
        sync.enqueue()
        sync.DATA.write_text(json.dumps({'announcements':[{'id':'second'}]}));sync.enqueue()
        self.assertTrue(sync.process_one());self.assertTrue(sync.process_one())
        self.assertEqual(len(self.commits),2)
        self.assertNotEqual(self.commits[0]['resources/content.json'],self.commits[1]['resources/content.json'])

    def test_http_revision_and_queue_failure_rollback(self):
        os.environ['UPLOAD_TOKEN']='test-only'
        import server
        server.DATA_FILE=str(sync.DATA)
        http=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        thread=threading.Thread(target=http.serve_forever,daemon=True);thread.start()
        url='http://127.0.0.1:'+str(http.server_port)+'/api/data'
        def post(rev):
            request=urllib.request.Request(url,data=json.dumps({'announcements':[{'id':'new'}]}).encode(),headers={'Content-Type':'application/json','X-Token':'test-only','If-Match':rev})
            return json.load(urllib.request.urlopen(request))
        try:
            initial=json.load(urllib.request.urlopen(url))['revision']
            with patch.dict(os.environ,{'CMS_GITHUB_SYNC':'1'}):
                result=post(initial)
                self.assertNotEqual(initial,result['revision'])
                with self.assertRaises(urllib.error.HTTPError) as e:post(initial)
                self.assertEqual(e.exception.code,409)
                before=sync.DATA.read_bytes()
                with patch.object(sync,'enqueue',side_effect=OSError('disk error')):
                    with self.assertRaises(urllib.error.HTTPError) as e:post(result['revision'])
                    self.assertEqual(e.exception.code,500)
                self.assertEqual(sync.DATA.read_bytes(),before)
        finally:http.shutdown();http.server_close();thread.join()

if __name__=='__main__':unittest.main()
