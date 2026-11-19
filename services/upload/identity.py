"""Private CMS identities and append-only audit records. No roster in source."""
import contextlib
import hashlib
import hmac
from http.cookies import SimpleCookie
import json
import os
from pathlib import Path
import secrets
import sqlite3
import time
from urllib.parse import parse_qs, urlsplit

ROOT = Path(os.environ.get('IDENTITY_STATE', '/var/lib/xuecuhui-identity'))
SESSION_SECONDS = 7 * 86400
OWNER_IDENTITY_HASH = '227c9568064df6c178c20ee5ef0c29a84af6712991cc417183e9ba1f8e3500f0'


class AccessError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


@contextlib.contextmanager
def database():
    ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    con = sqlite3.connect(str(ROOT / 'identity.sqlite3'), timeout=30)
    con.row_factory = sqlite3.Row
    con.execute('PRAGMA journal_mode=WAL')
    con.executescript('''
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, student_id TEXT NOT NULL UNIQUE,
        department TEXT NOT NULL DEFAULT '', position TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT 'member', enabled INTEGER NOT NULL DEFAULT 1,
        is_owner INTEGER NOT NULL DEFAULT 0, academic_year TEXT NOT NULL DEFAULT '',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at REAL NOT NULL);
      CREATE TABLE IF NOT EXISTS attempts (
        client TEXT NOT NULL, attempted_at REAL NOT NULL);
      CREATE INDEX IF NOT EXISTS attempts_client ON attempts(client, attempted_at);
      CREATE TABLE IF NOT EXISTS audit (
        id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, user_name TEXT NOT NULL,
        department TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL,
        before_json TEXT, after_json TEXT, changes_json TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    ''')
    if 'changes_json' not in [r[1] for r in con.execute('PRAGMA table_info(audit)')]:
        con.execute('ALTER TABLE audit ADD COLUMN changes_json TEXT')
    try:
        yield con
        con.commit()
    except BaseException:
        con.rollback()
        raise
    finally:
        con.close()


def public_user(row):
    return {'id':row['id'], 'name':row['name'], 'studentId':row['student_id'],
            'department':row['department'], 'position':row['position'], 'role':row['role'],
            'enabled':bool(row['enabled']), 'isOwner':bool(row['is_owner']),
            'academicYear':row['academic_year']}


def token(handler):
    cookie = SimpleCookie()
    try: cookie.load(handler.headers.get('Cookie', ''))
    except Exception: return ''
    item = cookie.get('yc_session')
    return item.value if item else ''


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def current_user(handler):
    value = token(handler)
    if not value or len(value) > 200:
        return None
    with database() as con:
        row = con.execute('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=? AND expires_at>? AND enabled=1', (digest(value),time.time())).fetchone()
        return public_user(row) if row else None


def require_user(handler, admin=False):
    user = current_user(handler)
    if user is None:
        raise AccessError('请先使用姓名和学号登录', 401)
    if admin and user['role'] != 'admin':
        raise AccessError('此操作仅限网站管理员', 403)
    return user


SENSITIVE = {'password','token','cookie','studentid','student_id','authorization','secret','members'}


def sanitize(value, depth=0):
    if depth > 7: return '…'
    if isinstance(value, dict):
        return {str(k)[:100]:sanitize(v, depth+1) for k,v in list(value.items())[:120]
                if not any(s in str(k).lower() for s in SENSITIVE)}
    if isinstance(value, (list,tuple)):
        return [sanitize(v,depth+1) for v in value[:60]] + ([{'omitted':len(value)-60}] if len(value)>60 else [])
    if isinstance(value,str): return value[:3000]
    if value is None or isinstance(value,(int,float,bool)): return value
    return str(value)[:3000]


def changed(before, after):
    if isinstance(before,dict) and isinstance(after,dict):
        keys = [key for key in set(before)|set(after) if before.get(key)!=after.get(key)]
        return ({k:before.get(k) for k in keys}, {k:after.get(k) for k in keys})
    return before, after


def differences(before, after, path='', output=None):
    if output is None: output=[]
    if before == after or len(output) >= 200: return output
    if isinstance(before,dict) and isinstance(after,dict):
        for key in sorted(set(before)|set(after)):
            if any(s in str(key).lower() for s in SENSITIVE): continue
            differences(before.get(key),after.get(key),(path+'.' if path else '')+key,output)
    elif isinstance(before,list) and isinstance(after,list) and all(isinstance(v,dict) and 'id' in v for v in before+after):
        first={str(v['id']):v for v in before};second={str(v['id']):v for v in after}
        for key in sorted(set(first)|set(second)):
            differences(first.get(key),second.get(key),path+'[id='+key+']',output)
    else:
        output.append({'path':path or '内容','before':sanitize(before),'after':sanitize(after)})
    return output


def audit(handler, action, target, before=None, after=None):
    # Keep the already-authenticated actor for this request when a member update
    # revokes their own session. The request attribute is never taken from JSON.
    user = getattr(handler, '_identity_audit_user', None) or require_user(handler)
    changes = differences(before,after)
    before, after = changed(before, after)
    before, after = sanitize(before), sanitize(after)
    with database() as con:
        con.execute('INSERT INTO audit (user_id,user_name,department,action,target,before_json,after_json,changes_json) VALUES (?,?,?,?,?,?,?,?)',
                    (user['id'],user['name'],user['department'],str(action)[:150],str(target)[:300],
                     json.dumps(before,ensure_ascii=False),json.dumps(after,ensure_ascii=False),json.dumps(changes,ensure_ascii=False)))


def reply(handler, status, payload, cookie=None):
    data = json.dumps(payload,ensure_ascii=False).encode()
    handler.send_response(status)
    handler.send_header('Content-Type','application/json; charset=utf-8')
    handler.send_header('Content-Length',str(len(data)))
    handler.send_header('Cache-Control','no-store')
    handler.send_header('X-Content-Type-Options','nosniff')
    if cookie: handler.send_header('Set-Cookie',cookie)
    handler.end_headers()
    handler.wfile.write(data)


def body(handler):
    try:
        length = int(handler.headers.get('Content-Length','0'))
        if not 0 < length <= 2*1024*1024:
            raise AccessError('请求为空或超过 2MB')
        result = json.loads(handler.rfile.read(length).decode())
        if not isinstance(result,dict): raise AccessError('请求内容必须为对象')
        return result
    except (UnicodeError, json.JSONDecodeError, ValueError) as error:
        if isinstance(error,AccessError): raise
        raise AccessError('请求内容格式不正确')


def clean(value,limit=200):
    return str(value or '').strip()[:limit]


def account(data):
    name, student_id = clean(data.get('name'),40), clean(data.get('studentId'),40)
    if not 1 <= len(name) <= 40: raise AccessError('请填写成员姓名')
    if not student_id or len(student_id) > 30 or not student_id.isascii() or not student_id.isalnum():
        raise AccessError('学号需为不超过 30 位的数字或字母')
    role = data.get('role','member')
    if role not in ('admin','member'): raise AccessError('账号角色无效')
    return {'name':name,'studentId':student_id,'department':clean(data.get('department')),
            'position':clean(data.get('position')),'role':role,'enabled':data.get('enabled',True) is not False}


def cookie_for(handler, value, max_age=SESSION_SECONDS):
    secure = handler.headers.get('X-Forwarded-Proto','').lower() == 'https'
    return 'yc_session='+value+'; HttpOnly; SameSite=Strict; Path=/; Max-Age='+str(max_age)+('; Secure' if secure else '')


def establish(handler, user_id):
    value = secrets.token_urlsafe(36)
    with database() as con:
        con.execute('DELETE FROM sessions WHERE expires_at<?',(time.time(),))
        con.execute('INSERT INTO sessions VALUES (?,?,?)',(digest(value),user_id,time.time()+SESSION_SECONDS))
        row = con.execute('SELECT * FROM users WHERE id=?',(user_id,)).fetchone()
    # For bootstrap/login audit, use the same server-generated session on this request.
    original = handler.headers.get('Cookie')
    if original is not None: del handler.headers['Cookie']
    handler.headers['Cookie']='yc_session='+value
    return public_user(row), cookie_for(handler,value)


def route(handler, path):
    if not path.startswith('/api/auth/'):
        return False
    try:
        if handler.command == 'GET' and path == '/api/auth/session':
            user = current_user(handler)
            with database() as con:
                setup = con.execute('SELECT COUNT(*) FROM users').fetchone()[0] == 0
            reply(handler,200,{'ok':True,'user':user,'setupRequired':setup})
            return True
        if handler.command == 'POST' and path == '/api/auth/bootstrap':
            provided = handler.headers.get('X-Internal-Token','')
            expected = os.environ.get('UPLOAD_TOKEN','')
            if not expected or not hmac.compare_digest(provided,expected):
                raise AccessError('首次初始化需要服务器管理凭据',403)
            data = account(body(handler))
            if not hmac.compare_digest(digest(data['name']+'|'+data['studentId']),OWNER_IDENTITY_HASH):
                raise AccessError('初始化身份与网站管理员不一致',403)
            with database() as con:
                con.execute('BEGIN IMMEDIATE')
                if con.execute('SELECT COUNT(*) FROM users').fetchone()[0]:
                    raise AccessError('管理员已经初始化',409)
                user_id=con.execute("INSERT INTO users (name,student_id,department,position,role,is_owner) VALUES (?,?,?,?,'admin',1)",
                                    (data['name'],data['studentId'],data['department'],data['position'])).lastrowid
            user, cookie = establish(handler,user_id)
            audit(handler,'初始化网站管理员','成员管理',after={'name':user['name'],'role':'admin'})
            reply(handler,201,{'ok':True,'user':user},cookie)
            return True
        if handler.command == 'POST' and path == '/api/auth/login':
            data = body(handler)
            name, student_id = clean(data.get('name'),40), clean(data.get('studentId'),40)
            client = digest(str(handler.client_address[0])+'|'+name+'|'+student_id)
            now = time.time()
            with database() as con:
                con.execute('DELETE FROM attempts WHERE attempted_at<?',(now-900,))
                if con.execute('SELECT COUNT(*) FROM attempts WHERE client=?',(client,)).fetchone()[0] >= 30:
                    raise AccessError('登录尝试过多，请 15 分钟后重试',429)
                row=con.execute('SELECT * FROM users WHERE name=? AND student_id=? AND enabled=1',(name,student_id)).fetchone()
                if row is None:
                    con.execute('INSERT INTO attempts VALUES (?,?)',(client,now))
                else:
                    con.execute('DELETE FROM attempts WHERE client=?',(client,))
            if row is None: raise AccessError('姓名或学号不匹配，或者账号已停用',401)
            user,cookie=establish(handler,row['id'])
            audit(handler,'登录内容台','登录')
            reply(handler,200,{'ok':True,'user':user},cookie)
            return True
        if handler.command == 'POST' and path == '/api/auth/logout':
            if int(handler.headers.get('Content-Length','0')) > 0:
                body(handler)
            user=current_user(handler)
            if user: audit(handler,'退出内容台','登录')
            value=token(handler)
            if value:
                with database() as con: con.execute('DELETE FROM sessions WHERE token_hash=?',(digest(value),))
            reply(handler,200,{'ok':True},cookie_for(handler,'',0))
            return True
        if handler.command == 'POST' and path == '/api/auth/internal-audit':
            require_user(handler)
            expected=os.environ.get('UPLOAD_TOKEN','')
            if not expected or not hmac.compare_digest(handler.headers.get('X-Internal-Token',''),expected):
                raise AccessError('服务端审计凭据无效',403)
            data=body(handler)
            audit(handler,data.get('action','修改题库'),data.get('target','题库内容台'),data.get('before'),data.get('after'))
            reply(handler,200,{'ok':True})
            return True
        handler._identity_audit_user = require_user(handler,admin=True)
        if handler.command == 'GET' and path == '/api/auth/members':
            with database() as con:
                users=[public_user(r) for r in con.execute('SELECT * FROM users ORDER BY is_owner DESC, enabled DESC, department, name')]
            reply(handler,200,{'ok':True,'members':users})
        elif handler.command == 'POST' and path == '/api/auth/members':
            data=body(handler)
            id=data.get('id')
            with database() as con:
                before=con.execute('SELECT * FROM users WHERE id=?',(id,)).fetchone() if id else None
                if id and not before: raise AccessError('成员不存在',404)
                # Partial updates (enable/disable) preserve all other fields.
                merged=dict(public_user(before)) if before else {}
                merged.update(data)
                item=account(merged)
                if before and before['is_owner'] and (item['studentId']!=before['student_id'] or item['name']!=before['name'] or not item['enabled'] or item['role']!='admin'):
                    raise AccessError('不能修改、停用或降级网站所有者账号',403)
                args=(item['name'],item['studentId'],item['department'],item['position'],item['role'],int(item['enabled']))
                if before:
                    con.execute('UPDATE users SET name=?,student_id=?,department=?,position=?,role=?,enabled=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',args+(id,))
                    # Existing sessions end when identity, role, or enabled state changes.
                    if before['student_id']!=item['studentId'] or before['name']!=item['name'] or before['role']!=item['role'] or not item['enabled']:
                        con.execute('DELETE FROM sessions WHERE user_id=?',(id,))
                else:
                    id=con.execute('INSERT INTO users (name,student_id,department,position,role,enabled) VALUES (?,?,?,?,?,?)',args).lastrowid
                after=public_user(con.execute('SELECT * FROM users WHERE id=?',(id,)).fetchone())
            audit(handler,'修改成员' if before else '新增成员','成员 #'+str(id),public_user(before) if before else None,after)
            reply(handler,200,{'ok':True,'member':after})
        elif handler.command == 'POST' and path == '/api/auth/import':
            data=body(handler)
            items=data.get('members')
            if not isinstance(items,list) or not 1<=len(items)<=2000:
                raise AccessError('名单需为 1 至 2000 条成员记录')
            merged={}
            for raw in items:
                item=account(dict(raw,role='member'))
                key=item['studentId']
                if key in merged:
                    if item['name'] != merged[key]['name']: raise AccessError('同一学号存在不同姓名，请核对名单')
                    for field in ('department','position'):
                        merged[key][field]='、'.join(dict.fromkeys(filter(None,[merged[key][field],item[field]])))
                else: merged[key]=item
            created=updated=0
            with database() as con:
                for item in merged.values():
                    old=con.execute('SELECT * FROM users WHERE student_id=?',(item['studentId'],)).fetchone()
                    if old:
                        if old['is_owner']: continue
                        if old['name']!=item['name']: raise AccessError('已登记学号的姓名不一致，请先在成员管理核对')
                        con.execute('UPDATE users SET department=?,position=?,academic_year=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',
                                    (item['department'],item['position'],clean(data.get('academicYear'),40),old['id']))
                        updated+=1
                    else:
                        con.execute('INSERT INTO users (name,student_id,department,position,academic_year) VALUES (?,?,?,?,?)',
                                    (item['name'],item['studentId'],item['department'],item['position'],clean(data.get('academicYear'),40)))
                        created+=1
            audit(handler,'导入成员名单','成员管理',after={'academicYear':clean(data.get('academicYear'),40),'created':created,'updated':updated,'uniqueMembers':len(merged)})
            reply(handler,200,{'ok':True,'created':created,'updated':updated,'total':len(merged)})
        elif handler.command == 'GET' and path == '/api/auth/audit':
            query=parse_qs(urlsplit(handler.path).query)
            limit=min(100,max(1,int(query.get('limit',['50'])[0])))
            offset=max(0,int(query.get('offset',['0'])[0]))
            name=clean(query.get('name',[''])[0],40)
            with database() as con:
                where=' WHERE user_name LIKE ?' if name else ''
                args=('%'+name+'%',) if name else ()
                total=con.execute('SELECT COUNT(*) FROM audit'+where,args).fetchone()[0]
                rows=con.execute('SELECT * FROM audit'+where+' ORDER BY id DESC LIMIT ? OFFSET ?',args+(limit,offset)).fetchall()
            entries=[]
            for row in rows:
                item=dict(row)
                item['before']=json.loads(item.pop('before_json'))
                item['after']=json.loads(item.pop('after_json'))
                item['changes']=json.loads(item.pop('changes_json') or '[]')
                item.update({'userName':item['user_name'],'actor_name':item['user_name'],'createdAt':item['created_at'],'userId':item['user_id']})
                entries.append(item)
            reply(handler,200,{'ok':True,'events':entries,'entries':entries,'logs':entries,'total':total,'offset':offset,'limit':limit,'hasMore':offset+len(entries)<total})
        else:
            reply(handler,404,{'ok':False,'error':'接口不存在'})
    except AccessError as error:
        reply(handler,error.status,{'ok':False,'error':str(error)})
    except sqlite3.IntegrityError:
        reply(handler,409,{'ok':False,'error':'该学号已登记，请核对成员名单'})
    except (TypeError,ValueError):
        reply(handler,400,{'ok':False,'error':'参数格式不正确，请核对后重试'})
    except Exception:
        handler.log_message('identity request failed')
        reply(handler,500,{'ok':False,'error':'账号服务暂时不可用，请联系网站管理员'})
    return True
