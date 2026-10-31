#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
学促会站点 · 后端服务

两个能力：
  1. POST /api/upload  接收海报图片，落盘到 assets/posters/
  2. GET  /api/data    读取站点内容（公告/活动/部门/站点信息…），公开
     POST /api/data    保存站点内容，需 X-Token

设计约束：
  - 只监听 127.0.0.1，由 nginx 反代 /api/，不直接面对公网
  - 只用标准库，无第三方依赖
  - 上传按文件头字节校验类型，不信任扩展名；文件名随机
  - 数据文件保存前自动备份上一版，写入走临时文件 + 原子替换
  - 写接口统一校验 X-Token

环境变量：
  UPLOAD_TOKEN  口令，必须由服务器环境变量提供
  UPLOAD_PORT   监听端口，默认 8788
  UPLOAD_DIR    图片保存目录
  DATA_FILE     内容 JSON 路径
"""

import os
import sys
import json
import cgi
import shutil
import secrets
import warnings
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

warnings.filterwarnings('ignore')

UPLOAD_DIR = os.environ.get('UPLOAD_DIR', '/www/wwwroot/xuecuhui/assets/posters')
DOCS_DIR = os.environ.get('DOCS_DIR', '/www/wwwroot/xuecuhui/assets/docs')
ISSUE_DIR = os.environ.get('ISSUE_DIR', '/www/wwwroot/xuecuhui/assets/issue')
DATA_FILE = os.environ.get('DATA_FILE', '/opt/xuecuhui-upload/data/content.json')
TOKEN = os.environ['UPLOAD_TOKEN']
PORT = int(os.environ.get('UPLOAD_PORT', '8788'))

MAX_IMAGE = 8 * 1024 * 1024
MAX_DOC = 50 * 1024 * 1024
MAX_JSON = 4 * 1024 * 1024
MAX_FORM = 512 * 1024

LIST_KEYS = ('announcements', 'activities', 'departments', 'tools')
DICT_KEYS = ('site', 'library')

# 允许的资料文件类型
DOC_EXT = {
    '.pdf': ('pdf', (b'%PDF',)),
    '.doc': ('doc', (b'\xd0\xcf\x11\xe0',)),
    '.docx': ('docx', (b'PK',)),
    '.ppt': ('ppt', (b'\xd0\xcf\x11\xe0',)),
    '.pptx': ('pptx', (b'PK',)),
    '.xls': ('xls', (b'\xd0\xcf\x11\xe0',)),
    '.xlsx': ('xlsx', (b'PK',)),
    '.zip': ('zip', (b'PK',)),
    '.rar': ('rar', (b'Rar!',)),
    '.7z': ('7z', (b'7z\xbc\xaf',)),
    '.txt': ('txt', ()),
    '.md': ('md', ()),
}


# ---------------- 工具 ----------------

def detect_image(head: bytes):
    if head.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'png'
    if head.startswith(b'\xff\xd8\xff'):
        return 'jpg'
    if head[:6] in (b'GIF87a', b'GIF89a'):
        return 'gif'
    if head[:4] == b'RIFF' and head[8:12] == b'WEBP':
        return 'webp'
    return None


def detect_doc(filename, head: bytes):
    """按扩展名 + 文件头判断资料文件类型，返回 (ext, error)"""
    ext = os.path.splitext(filename or '')[1].lower()
    if ext not in DOC_EXT:
        return None, '不支持的类型（仅 PDF / Word / PPT / Excel / ZIP / RAR / 7Z / TXT / MD）'
    name, magics = DOC_EXT[ext]
    if magics and not any(head.startswith(m) for m in magics):
        return None, '文件内容与扩展名不符'
    return name, None


def read_content():
    if not os.path.exists(DATA_FILE):
        return None
    with open(DATA_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)


def validate_content(d):
    if not isinstance(d, dict):
        return '内容必须是 JSON 对象'
    for k in LIST_KEYS:
        if k in d and not isinstance(d[k], list):
            return '%s 必须是数组' % k
    for k in DICT_KEYS:
        if k in d and not isinstance(d[k], dict):
            return '%s 必须是对象' % k
    if 'announcements' not in d and 'activities' not in d:
        return '缺少 announcements / activities'
    return None


def write_content(d):
    directory = os.path.dirname(DATA_FILE)
    os.makedirs(directory, exist_ok=True)
    if os.path.exists(DATA_FILE):
        try:
            shutil.copy2(DATA_FILE, DATA_FILE + '.bak')
        except Exception:
            pass
    tmp = DATA_FILE + '.part'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, DATA_FILE)


# ---------------- HTTP ----------------

class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'XuecuhuiAPI/2.0'

    def log_message(self, fmt, *args):
        sys.stderr.write('[api] %s - %s\n' % (self.address_string(), fmt % args))

    # ---- 响应 ----

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def _auth_ok(self):
        return self.headers.get('X-Token', '') == TOKEN

    def _read_json(self):
        try:
            n = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            raise ValueError('Content-Length 无效')
        if n <= 0:
            raise ValueError('请求体为空')
        if n > MAX_JSON:
            raise ValueError('内容过大（上限 2MB）')
        raw = self.rfile.read(n)
        try:
            return json.loads(raw.decode('utf-8'))
        except Exception:
            raise ValueError('JSON 解析失败')

    # ---- GET ----

    def do_GET(self):
        p = self.path.split('?')[0].rstrip('/')

        if p == '/api/health':
            n_img = 0
            if os.path.isdir(UPLOAD_DIR):
                n_img = len([f for f in os.listdir(UPLOAD_DIR) if not f.startswith('.')])
            return self._json(200, {
                'ok': True,
                'service': 'api',
                'images': n_img,
                'hasContent': os.path.exists(DATA_FILE),
            })

        if p == '/api/data':
            try:
                data = read_content()
            except Exception as e:
                return self._json(500, {'ok': False, 'error': '读取失败: %s' % e})
            return self._json(200, {'ok': True, 'data': data})

        return self._json(404, {'ok': False, 'error': 'not found'})

    # ---- POST ----

    def do_POST(self):
        p = self.path.split('?')[0].rstrip('/')

        if p == '/api/data':
            return self._post_data()
        if p == '/api/upload':
            return self._post_upload()
        if p == '/api/upload-doc':
            return self._post_upload_doc()
        if p == '/api/upload-issue':
            return self._post_upload_issue()
        return self._json(404, {'ok': False, 'error': 'not found'})

    def _post_data(self):
        if not self._auth_ok():
            return self._json(403, {'ok': False, 'error': '密令不正确'})
        try:
            data = self._read_json()
        except ValueError as e:
            return self._json(400, {'ok': False, 'error': str(e)})

        err = validate_content(data)
        if err:
            return self._json(400, {'ok': False, 'error': err})

        data['updatedAt'] = datetime.now().isoformat(timespec='seconds')

        try:
            write_content(data)
        except Exception as e:
            return self._json(500, {'ok': False, 'error': '写入失败: %s' % e})

        return self._json(200, {'ok': True, 'updatedAt': data['updatedAt']})

    def _post_upload(self):
        if not self._auth_ok():
            return self._json(403, {'ok': False, 'error': '密令不正确'})

        ctype = self.headers.get('Content-Type', '')
        if 'multipart/form-data' not in ctype:
            return self._json(400, {'ok': False, 'error': '需要 multipart/form-data'})

        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            return self._json(400, {'ok': False, 'error': 'Content-Length 无效'})

        if length <= 0:
            return self._json(400, {'ok': False, 'error': '请求体为空'})
        if length > MAX_IMAGE + MAX_FORM:
            return self._json(413, {'ok': False, 'error': '文件超过 8MB'})

        try:
            form = cgi.FieldStorage(
                fp=self.rfile,
                headers=self.headers,
                environ={
                    'REQUEST_METHOD': 'POST',
                    'CONTENT_TYPE': ctype,
                    'CONTENT_LENGTH': str(length),
                },
            )
        except Exception as e:
            return self._json(400, {'ok': False, 'error': '表单解析失败: %s' % e})

        if 'file' not in form:
            return self._json(400, {'ok': False, 'error': '没有收到 file 字段'})

        item = form['file']
        if not getattr(item, 'file', None):
            return self._json(400, {'ok': False, 'error': '文件字段格式不对'})

        data = item.file.read(MAX_IMAGE + 1)
        if len(data) > MAX_IMAGE:
            return self._json(413, {'ok': False, 'error': '文件超过 8MB'})
        if not data:
            return self._json(400, {'ok': False, 'error': '文件为空'})

        ext = detect_image(data[:16])
        if not ext:
            return self._json(415, {'ok': False, 'error': '只支持 PNG / JPG / GIF / WEBP 图片'})

        try:
            os.makedirs(UPLOAD_DIR, exist_ok=True)
        except Exception as e:
            return self._json(500, {'ok': False, 'error': '无法创建目录: %s' % e})

        name = secrets.token_hex(8) + '.' + ext
        path = os.path.join(UPLOAD_DIR, name)
        tmp = path + '.part'
        try:
            with open(tmp, 'wb') as f:
                f.write(data)
            os.replace(tmp, path)
        except Exception as e:
            try:
                os.path.exists(tmp) and os.remove(tmp)
            except Exception:
                pass
            return self._json(500, {'ok': False, 'error': '写入失败: %s' % e})

        return self._json(200, {
            'ok': True,
            'url': 'assets/posters/' + name,
            'size': len(data),
            'type': ext,
        })


    def _post_upload_doc(self):
        """资料文件上传：PDF / Office / 压缩包，最大 50MB"""
        if not self._auth_ok():
            return self._json(403, {'ok': False, 'error': '密令不正确'})

        ctype = self.headers.get('Content-Type', '')
        if 'multipart/form-data' not in ctype:
            return self._json(400, {'ok': False, 'error': '需要 multipart/form-data'})

        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            return self._json(400, {'ok': False, 'error': 'Content-Length 无效'})
        if length <= 0:
            return self._json(400, {'ok': False, 'error': '请求体为空'})
        if length > MAX_DOC + MAX_FORM:
            return self._json(413, {'ok': False, 'error': '文件超过 50MB'})

        try:
            form = cgi.FieldStorage(
                fp=self.rfile,
                headers=self.headers,
                environ={'REQUEST_METHOD': 'POST', 'CONTENT_TYPE': ctype,
                         'CONTENT_LENGTH': str(length)},
            )
        except Exception as e:
            return self._json(400, {'ok': False, 'error': '表单解析失败: %s' % e})

        if 'file' not in form:
            return self._json(400, {'ok': False, 'error': '没有收到 file 字段'})
        item = form['file']
        if not getattr(item, 'file', None):
            return self._json(400, {'ok': False, 'error': '文件字段格式不对'})

        data = item.file.read(MAX_DOC + 1)
        if len(data) > MAX_DOC:
            return self._json(413, {'ok': False, 'error': '文件超过 50MB'})
        if not data:
            return self._json(400, {'ok': False, 'error': '文件为空'})

        ext, err = detect_doc(getattr(item, 'filename', ''), data[:16])
        if err:
            return self._json(415, {'ok': False, 'error': err})

        try:
            os.makedirs(DOCS_DIR, exist_ok=True)
        except Exception as e:
            return self._json(500, {'ok': False, 'error': '无法创建目录: %s' % e})

        fname = secrets.token_hex(8) + '.' + ext
        path = os.path.join(DOCS_DIR, fname)
        tmp = path + '.part'
        try:
            with open(tmp, 'wb') as f:
                f.write(data)
            os.replace(tmp, path)
        except Exception as e:
            try:
                os.path.exists(tmp) and os.remove(tmp)
            except Exception:
                pass
            return self._json(500, {'ok': False, 'error': '写入失败: %s' % e})

        return self._json(200, {
            'ok': True,
            'url': 'assets/docs/' + fname,
            'original': getattr(item, 'filename', ''),
            'size': len(data),
            'ext': ext,
        })


    def _post_upload_issue(self):
        """新生刊图片上传：固定文件名，上传即覆盖旧图（不保留历史）"""
        if not self._auth_ok():
            return self._json(403, {'ok': False, 'error': '密令不正确'})

        ctype = self.headers.get('Content-Type', '')
        if 'multipart/form-data' not in ctype:
            return self._json(400, {'ok': False, 'error': '需要 multipart/form-data'})

        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            return self._json(400, {'ok': False, 'error': 'Content-Length 无效'})
        if length <= 0:
            return self._json(400, {'ok': False, 'error': '请求体为空'})
        if length > MAX_IMAGE + MAX_FORM:
            return self._json(413, {'ok': False, 'error': '图片超过 8MB'})

        try:
            form = cgi.FieldStorage(
                fp=self.rfile,
                headers=self.headers,
                environ={'REQUEST_METHOD': 'POST', 'CONTENT_TYPE': ctype,
                         'CONTENT_LENGTH': str(length)},
            )
        except Exception as e:
            return self._json(400, {'ok': False, 'error': '表单解析失败: %s' % e})

        if 'file' not in form:
            return self._json(400, {'ok': False, 'error': '没有收到 file 字段'})
        item = form['file']
        if not getattr(item, 'file', None):
            return self._json(400, {'ok': False, 'error': '文件字段格式不对'})

        data = item.file.read(MAX_IMAGE + 1)
        if len(data) > MAX_IMAGE:
            return self._json(413, {'ok': False, 'error': '图片超过 8MB'})
        if not data:
            return self._json(400, {'ok': False, 'error': '文件为空'})

        ext = detect_image(data[:16])
        if not ext:
            return self._json(415, {'ok': False, 'error': '只支持 PNG / JPG / GIF / WEBP 图片'})

        try:
            os.makedirs(ISSUE_DIR, exist_ok=True)
            # 覆盖式：先清掉目录里所有旧图，只留这一张
            for f in os.listdir(ISSUE_DIR):
                fp = os.path.join(ISSUE_DIR, f)
                if os.path.isfile(fp):
                    try:
                        os.remove(fp)
                    except Exception:
                        pass
        except Exception as e:
            return self._json(500, {'ok': False, 'error': '无法准备目录: %s' % e})

        fname = 'issue.' + ext
        path = os.path.join(ISSUE_DIR, fname)
        tmp = path + '.part'
        try:
            with open(tmp, 'wb') as f:
                f.write(data)
            os.replace(tmp, path)
        except Exception as e:
            try:
                os.path.exists(tmp) and os.remove(tmp)
            except Exception:
                pass
            return self._json(500, {'ok': False, 'error': '写入失败: %s' % e})

        # 带时间戳，绕开浏览器/nginx 缓存
        stamp = int(datetime.now().timestamp() * 1000)   # 毫秒，避免同秒重复上传命中旧缓存
        return self._json(200, {
            'ok': True,
            'url': 'assets/issue/%s?v=%d' % (fname, stamp),
            'size': len(data),
            'ext': ext,
        })


def main():
    srv = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    sys.stderr.write('[api] listening on 127.0.0.1:%d\n' % PORT)
    sys.stderr.write('[api] images=%s\n' % UPLOAD_DIR)
    sys.stderr.write('[api] content=%s\n' % DATA_FILE)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
