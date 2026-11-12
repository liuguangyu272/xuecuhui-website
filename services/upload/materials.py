"""Internal material workflow. Uses the existing CMS token; no personal accounts.

Pending submissions and working files never enter public JSON or GitHub snapshots.
Only an explicit publication copies an approved archive into the public library.
"""
import cgi
import contextlib
import json
import mimetypes
import os
from pathlib import Path
import secrets
import shutil
import sqlite3
import threading
from datetime import datetime
from urllib.parse import parse_qs, urlsplit, quote

ROOT = Path(os.environ.get('MATERIALS_STATE', '/var/lib/xuecuhui-materials'))
LOCK = threading.RLock()
MAX_FILE = 50 * 1024 * 1024
DEFAULT_REQUIREMENTS = '格式要求\n按任务要求统一标题、正文、字号、行距和页边距。\n\n内容要求\n核对人物、时间、地点、数据和引用来源。\n\n提交要求\n上传实际成果文件，填写修改说明；退回后按意见修改并重新提交。'


class Invalid(ValueError):
    pass


def text(value, limit=2000):
    return str(value or '').strip()[:limit]


def required(data, key):
    value = text(data.get(key))
    if not value:
        raise Invalid('请填写' + {'actor':'操作人姓名', 'title':'标题', 'description':'任务要求', 'deadline':'截止日期', 'material':'材料负责人', 'designer':'美工负责人', 'note':'修改说明', 'name':'名称'}.get(key, key))
    return value


@contextlib.contextmanager
def database():
    ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    con = sqlite3.connect(str(ROOT / 'materials.sqlite3'), timeout=30)
    con.row_factory = sqlite3.Row
    con.executescript('''
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
        deadline TEXT NOT NULL, material TEXT NOT NULL, designer TEXT NOT NULL DEFAULT '',
        stage TEXT NOT NULL DEFAULT 'material', status TEXT NOT NULL DEFAULT 'assigned',
        reference_id INTEGER, resource_id INTEGER, created_by TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, stored TEXT NOT NULL, ext TEXT NOT NULL,
        size INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS submissions (
        id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL, stage TEXT NOT NULL,
        file_id INTEGER NOT NULL, actor TEXT NOT NULL, note TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', reviewer TEXT, comment TEXT,
        reviewed_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS resources (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
        file_id INTEGER NOT NULL, published_id TEXT, public_url TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS versions (
        id INTEGER PRIMARY KEY, resource_id INTEGER NOT NULL, file_id INTEGER NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS templates (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
        file_id INTEGER NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    ''')
    con.execute('INSERT OR IGNORE INTO settings VALUES (?, ?)', ('requirements', DEFAULT_REQUIREMENTS))
    try:
        yield con
        con.commit()
    except BaseException:
        con.rollback()
        raise
    finally:
        con.close()


def row(con, table, id):
    # All table arguments are developer-owned constants.
    found = con.execute('SELECT * FROM ' + table + ' WHERE id=?', (id,)).fetchone()
    if found is None:
        raise Invalid('记录不存在')
    return dict(found)


def file_info(con, id):
    item = row(con, 'files', id)
    return {k:item[k] for k in ('id', 'name', 'ext', 'size', 'active')}


def board(con):
    tasks = [dict(r) for r in con.execute('SELECT * FROM tasks ORDER BY updated_at DESC, id DESC')]
    resources = [dict(r) for r in con.execute('SELECT * FROM resources ORDER BY id DESC')]
    templates = [dict(r) for r in con.execute('SELECT * FROM templates ORDER BY id DESC')]
    for item in resources + templates:
        item['file'] = file_info(con, item['file_id'])
    return {'tasks':tasks, 'resources':resources, 'templates':templates,
            'requirements':con.execute('SELECT value FROM settings WHERE key=?', ('requirements',)).fetchone()[0]}


def save_file(con, handler, required_fields=()):
    import server
    length = int(handler.headers.get('Content-Length', '0'))
    if not 0 < length <= MAX_FILE + 512 * 1024:
        raise Invalid('请选择文件，单个文件不能超过 50MB')
    if not handler.headers.get('Content-Type', '').startswith('multipart/form-data'):
        raise Invalid('需要上传实际文件')
    form = cgi.FieldStorage(fp=handler.rfile, headers=handler.headers,
                           environ={'REQUEST_METHOD':'POST', 'CONTENT_TYPE':handler.headers['Content-Type'], 'CONTENT_LENGTH':str(length)})
    if 'file' not in form or not getattr(form['file'], 'file', None):
        raise Invalid('请选择成果文件')
    part = form['file']
    fields = {key:form.getfirst(key, '') for key in form.keys() if key != 'file'}
    for key in required_fields:
        required(fields, key)
    data = part.file.read(MAX_FILE + 1)
    if not data or len(data) > MAX_FILE:
        raise Invalid('文件为空或超过 50MB')
    name = text(part.filename, 200)
    ext = server.detect_image(data[:16])
    if not ext:
        ext, error = server.detect_doc(name, data[:16])
        if error:
            raise Invalid(error)
    stored = secrets.token_hex(16) + '.' + ext
    directory = ROOT / 'files'
    directory.mkdir(exist_ok=True, mode=0o700)
    (directory / stored).write_bytes(data)
    id = con.execute('INSERT INTO files (name, stored, ext, size) VALUES (?, ?, ?, ?)',
                     (name, stored, ext, len(data))).lastrowid
    return id, fields


def retire(con, file_id):
    """Retire an old internal version; public files are independent copies."""
    item = row(con, 'files', file_id)
    con.execute('UPDATE files SET active=0 WHERE id=?', (file_id,))
    (ROOT / 'files' / item['stored']).unlink(missing_ok=True)


def review(con, id, data):
    submission = row(con, 'submissions', id)
    task = row(con, 'tasks', submission['task_id'])
    if submission['status'] != 'pending' or task['status'] != 'review' or task['stage'] != submission['stage']:
        raise Invalid('该提交已处理，请刷新后重试')
    actor, action, comment = required(data, 'actor'), data.get('action'), text(data.get('comment'))
    if action not in ('approve', 'return'):
        raise Invalid('审核操作无效')
    if action == 'return' and not comment:
        raise Invalid('退回时必须填写修改意见')
    final = action == 'approve' and (task['stage'] == 'design' or not task['designer'])
    resource_id = task['resource_id']
    if final:
        if resource_id:
            resource = row(con, 'resources', resource_id)
            con.execute('INSERT INTO versions (resource_id, file_id) VALUES (?, ?)', (resource_id, resource['file_id']))
            con.execute('UPDATE resources SET file_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', (submission['file_id'], resource_id))
            if not data.get('keepOld'):
                con.execute('DELETE FROM versions WHERE resource_id=? AND file_id=?', (resource_id, resource['file_id']))
                retire(con, resource['file_id'])
        else:
            resource_id = con.execute('INSERT INTO resources (name, description, file_id) VALUES (?, ?, ?)',
                                      (task['title'], task['description'], submission['file_id'])).lastrowid
    stage = 'done' if final else 'design' if action == 'approve' else task['stage']
    status = 'done' if final else 'assigned' if action == 'approve' else 'returned'
    con.execute('UPDATE submissions SET status=?, reviewer=?, comment=?, reviewed_at=CURRENT_TIMESTAMP WHERE id=?',
                ('approved' if action == 'approve' else 'returned', actor, comment, id))
    con.execute('UPDATE tasks SET stage=?, status=?, resource_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', (stage, status, resource_id, task['id']))
    return {'stage':stage, 'status':status, 'resourceId':resource_id}


def publish(con, resource_id, data):
    """Explicitly publish one approved resource using the existing CMS snapshot path."""
    import server
    resource = row(con, 'resources', resource_id)
    file = row(con, 'files', resource['file_id'])
    grade, subject = text(data.get('grade'), 80), text(data.get('subject'), 80)
    if not grade or not subject:
        raise Invalid('请选择年级和学科')
    public_id = resource['published_id'] or 'material-' + secrets.token_hex(10)
    public_name = 'material-' + secrets.token_hex(12) + '.' + file['ext']
    target = Path(server.DOCS_DIR) / public_name
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(ROOT / 'files' / file['stored'], target)
    url = 'assets/docs/' + public_name
    with server.CONTENT_LOCK:
        content = server.read_content()
        if not content:
            target.unlink(missing_ok=True)
            raise Invalid('网站内容尚未初始化')
        previous = Path(server.DATA_FILE).read_bytes()
        library = content.setdefault('library', {})
        if grade not in library.get('grades', []) or subject not in library.get('subjects', []):
            target.unlink(missing_ok=True)
            raise Invalid('年级或学科已变化，请刷新后重试')
        docs = library.setdefault('docs', [])
        existing = next((d for d in docs if d.get('id') == public_id), None)
        old_url = existing.get('url') if existing else None
        record = dict(existing or {})
        record.update({'id':public_id, 'name':resource['name'], 'note':resource['description'],
                       'grade':grade, 'subject':subject, 'ext':file['ext'], 'url':url,
                       'size':str(round(file['size']/1024))+' KB', 'date':datetime.now().date().isoformat()})
        if existing is not None:
            docs[docs.index(existing)] = record
        else:
            docs.append(record)
        content['updatedAt'] = datetime.now().isoformat()
        server.write_content(content)
        try:
            if os.environ.get('CMS_GITHUB_SYNC') == '1':
                server.cms_sync.enqueue()
        except Exception:
            server.cms_sync.atomic(Path(server.DATA_FILE), previous)
            target.unlink(missing_ok=True)
            raise Invalid('公开资料快照保存失败，原资料保持不变，请重试')
        con.execute('UPDATE resources SET published_id=?, public_url=? WHERE id=?', (public_id, url, resource_id))
    # Prior public copies are retained: another reader or stored reference may use them.
    return {'id':public_id, 'url':url, 'reader':'reader.html?id='+public_id}


def route(handler, path):
    if not path.startswith('/api/materials'):
        return False
    if not handler._auth_ok():
        handler._json(403, {'ok':False, 'error':'请先进入内容台'})
        return True
    try:
        parts = path.strip('/').split('/')[2:]
        with LOCK, database() as con:
            result = None
            if handler.command == 'GET' and not parts:
                result = board(con)
            elif handler.command == 'GET' and len(parts) == 2 and parts[0] == 'tasks':
                task = row(con, 'tasks', int(parts[1]))
                submissions = [dict(r) for r in con.execute('SELECT * FROM submissions WHERE task_id=? ORDER BY id DESC', (task['id'],))]
                for item in submissions:
                    item['file'] = file_info(con, item['file_id'])
                result = {'task':task, 'submissions':submissions}
            elif handler.command == 'GET' and len(parts) == 2 and parts[0] == 'versions':
                result = {'versions':[dict(r) for r in con.execute('SELECT v.*, f.name, f.size, f.ext FROM versions v JOIN files f ON f.id=v.file_id WHERE resource_id=? AND f.active=1 ORDER BY v.id DESC', (int(parts[1]),))]}
            elif handler.command == 'GET' and len(parts) == 2 and parts[0] == 'files':
                file = row(con, 'files', int(parts[1]))
                location = ROOT / 'files' / file['stored']
                if not file['active'] or not location.is_file():
                    raise Invalid('文件已被替换或不存在')
                handler.send_response(200)
                handler.send_header('Content-Type', mimetypes.guess_type(file['name'])[0] or 'application/octet-stream')
                handler.send_header('Content-Length', str(file['size']))
                handler.send_header('Content-Disposition', "attachment; filename*=UTF-8''" + quote(file['name']))
                handler.send_header('Cache-Control', 'no-store')
                handler.send_header('X-Content-Type-Options', 'nosniff')
                handler.end_headers()
                with location.open('rb') as stream:
                    shutil.copyfileobj(stream, handler.wfile)
                return True
            elif handler.command == 'POST' and parts == ['tasks']:
                data = handler._read_json()
                title, description, deadline, material, actor = [required(data, key) for key in ('title', 'description', 'deadline', 'material', 'actor')]
                datetime.strptime(deadline, '%Y-%m-%d')
                designer = required(data, 'designer') if data.get('designRequired') else ''
                reference_id, resource_id = data.get('referenceId') or None, data.get('resourceId') or None
                if reference_id: row(con, 'templates', int(reference_id))
                if resource_id: row(con, 'resources', int(resource_id))
                id = con.execute('INSERT INTO tasks (title,description,deadline,material,designer,created_by,reference_id,resource_id) VALUES (?,?,?,?,?,?,?,?)',
                                 (title, description, deadline, material, designer, actor, reference_id, resource_id)).lastrowid
                result = {'id':id}
            elif handler.command == 'POST' and len(parts) == 3 and parts[0] == 'tasks' and parts[2] == 'submit':
                task = row(con, 'tasks', int(parts[1]))
                if task['status'] not in ('assigned', 'returned'):
                    raise Invalid('当前状态不能提交；请等待审核或先处理退回意见')
                file_id, data = save_file(con, handler, ('note', 'actor'))
                note, actor = required(data, 'note'), required(data, 'actor')
                id = con.execute('INSERT INTO submissions (task_id,stage,file_id,actor,note) VALUES (?,?,?,?,?)',
                                 (task['id'],task['stage'],file_id,actor,note)).lastrowid
                con.execute("UPDATE tasks SET status='review', updated_at=CURRENT_TIMESTAMP WHERE id=?", (task['id'],))
                result = {'id':id}
            elif handler.command == 'POST' and len(parts) == 3 and parts[0] == 'submissions' and parts[2] == 'review':
                result = review(con, int(parts[1]), handler._read_json())
            elif handler.command == 'POST' and parts in (['resources'], ['templates']):
                file_id, data = save_file(con, handler, ('name',))
                name = required(data, 'name')
                table = parts[0]
                id = con.execute('INSERT INTO '+table+' (name,description,file_id) VALUES (?,?,?)', (name,text(data.get('description')),file_id)).lastrowid
                result = {'id':id}
            elif handler.command == 'POST' and parts == ['requirements']:
                data = handler._read_json()
                content = text(data.get('content'), 15000)
                if not content: raise Invalid('要求内容不能为空')
                con.execute('UPDATE settings SET value=? WHERE key=?', (content,'requirements'))
                result = {}
            elif handler.command == 'POST' and len(parts) == 3 and parts[0] == 'resources' and parts[2] == 'publish':
                result = publish(con, int(parts[1]), handler._read_json())
            if result is None:
                handler._json(404, {'ok':False, 'error':'接口不存在'})
            else:
                # Commit before acknowledging success.
                con.commit()
                handler._json(200, {'ok':True, **result})
    except (Invalid, ValueError, KeyError) as error:
        handler._json(400, {'ok':False, 'error':str(error)})
    except Exception as error:
        handler.log_message('materials: %s', type(error).__name__)
        handler._json(500, {'ok':False, 'error':'材料操作失败，请稍后重试'})
    return True
