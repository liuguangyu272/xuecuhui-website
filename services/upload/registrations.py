"""Private activity registrations. Never included in the public CMS snapshot."""
import base64
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
from datetime import datetime, timezone, timedelta
import zipfile

DB = Path(os.environ.get('REGISTRATION_DB', '/var/lib/xuecuhui-registrations/records.sqlite3'))

@contextlib.contextmanager
def connect():
    DB.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    con=sqlite3.connect(DB, timeout=30)
    con.execute('PRAGMA journal_mode=WAL')
    con.execute('CREATE TABLE IF NOT EXISTS entries (id TEXT PRIMARY KEY, activity TEXT, created TEXT, answers TEXT, fields TEXT, identity TEXT, request_id TEXT, UNIQUE(activity, identity), UNIQUE(activity, request_id))')
    con.execute('CREATE TABLE IF NOT EXISTS limits (ip TEXT, stamp REAL)')
    try:
        yield con
        con.commit()
    except BaseException:
        con.rollback(); raise
    finally: con.close()

def config(activity):
    conf=activity.get('registration') or {}
    fields=conf.get('fields', [])
    if not isinstance(fields,list) or not 1<=len(fields)<=30: raise ValueError('报名字段需要 1–30 项')
    keys=set(); labels=set()
    for f in fields:
        if not isinstance(f,dict): raise ValueError('报名字段无效')
        key=f.get('key',''); label=f.get('label','')
        if not isinstance(key,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}',key) or key in keys: raise ValueError('字段标识重复或无效')
        if not isinstance(label,str) or not label.strip() or len(label)>60 or label in labels: raise ValueError('字段名称重复或过长')
        if f.get('type','text') not in ('text','tel','email','number','textarea','select'): raise ValueError('不支持的字段类型')
        if f.get('type')=='select' and (not isinstance(f.get('options'),list) or not 1<=len(f['options'])<=50 or any(not isinstance(x,str) or len(x)>100 for x in f['options'])): raise ValueError('选择题需要有效选项')
        keys.add(key);labels.add(label)
    capacity=conf.get('capacity',0)
    if isinstance(capacity,bool) or not isinstance(capacity,int) or not 0<=capacity<=10000: raise ValueError('报名人数上限需要 0–10000 的整数')
    if conf.get('deadline'):
        try: datetime.fromisoformat(conf['deadline'])
        except (ValueError,TypeError): raise ValueError('截止时间无效')
    return conf,fields

def version(activity):
    if activity.get('registration',{}).get('version'): return activity['registration']['version']
    return hashlib.sha256(json.dumps(activity.get('registration'),sort_keys=True,ensure_ascii=False).encode()).hexdigest()

def validate(activity,answers):
    _,fields=config(activity)
    if not isinstance(answers,dict): raise ValueError('报名答案无效')
    result={}
    for f in fields:
        value=answers.get(f['key'],'')
        if not isinstance(value,str): raise ValueError('报名内容需要文本')
        value=value.strip()
        if len(value)>2000: raise ValueError(f['label']+' 内容过长')
        if f.get('required') and not value: raise ValueError('请填写 '+f['label'])
        if value and f.get('type')=='email' and not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',value): raise ValueError('邮箱格式不正确')
        if value and f.get('type')=='number' and not re.fullmatch(r'-?\d+(\.\d+)?',value): raise ValueError(f['label']+' 需要数字')
        if value and f.get('type')=='select' and value not in f['options']: raise ValueError(f['label']+' 选项无效')
        result[f['key']]=value
    return result

def add(con,activity,answers,request_id):
    _,fields=config(activity)
    identity=next((answers[f['key']] for f in fields if '学号' in f['label'] and answers[f['key']]),None)
    if identity: identity=hashlib.sha256(identity.encode()).hexdigest()
    # Import and HTTP retries never duplicate an identical answer set.
    if not request_id: request_id='import-'+hashlib.sha256(json.dumps(answers,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    existing=con.execute('SELECT id FROM entries WHERE activity=? AND (request_id=? OR (identity IS NOT NULL AND identity=?))',(activity['id'],request_id,identity)).fetchone()
    if existing: return existing[0],False
    cap=(activity.get('registration') or {}).get('capacity',0)
    if cap and con.execute('SELECT COUNT(*) FROM entries WHERE activity=?',(activity['id'],)).fetchone()[0]>=cap: raise ValueError('报名人数已满')
    ident=secrets.token_hex(12)
    now=datetime.now(timezone(timedelta(hours=8))).isoformat(timespec='seconds')
    con.execute('INSERT INTO entries VALUES (?,?,?,?,?,?,?)',(ident,activity['id'],now,json.dumps(answers,ensure_ascii=False),json.dumps(fields,ensure_ascii=False),identity,request_id))
    return ident,True

def submit(activity,payload,ip):
    conf,_=config(activity)
    if not conf.get('enabled'): raise ValueError('活动未开放报名')
    if conf.get('deadline'):
        deadline=datetime.fromisoformat(conf['deadline'])
        if deadline.tzinfo is None: deadline=deadline.replace(tzinfo=timezone(timedelta(hours=8)))
        if datetime.now(timezone.utc)>=deadline: raise ValueError('报名已截止')
    if payload.get('formVersion')!=version(activity): raise ValueError('报名表已调整，请刷新后重新填写')
    request_id=payload.get('requestId','')
    if not isinstance(request_id,str) or not re.fullmatch(r'[A-Za-z0-9_-]{16,80}',request_id): raise ValueError('请刷新报名页面')
    answers=validate(activity,payload.get('answers'))
    with connect() as con:
        con.execute('BEGIN IMMEDIATE')
        stamp=datetime.now().timestamp()
        con.execute('DELETE FROM limits WHERE stamp<?',(stamp-3600,))
        if con.execute('SELECT COUNT(*) FROM limits WHERE ip=?',(ip,)).fetchone()[0]>=20: raise ValueError('提交过于频繁，请稍后再试')
        ident,new=add(con,activity,answers,request_id)
        if new:con.execute('INSERT INTO limits VALUES (?,?)',(ip,stamp))
    return {'ok':True,'id':ident,'message':'报名成功' if new else '已收到你的报名，请勿重复提交'}

def rows(activity_id):
    with connect() as con:
        return [{'id':r[0],'created':r[1],'answers':json.loads(r[2]),'fields':json.loads(r[3])} for r in con.execute('SELECT id,created,answers,fields FROM entries WHERE activity=? ORDER BY created',(activity_id,))]

def columns(activity,records):
    _,fields=config(activity)
    cols={f['key']:f['label'] for f in fields}
    for row in records:
        for f in row['fields']:cols.setdefault(f['key'],f['label']+'（历史字段）')
    return cols

def export(activity):
    from openpyxl import Workbook
    records=rows(activity['id']);cols=columns(activity,records)
    wb=Workbook();ws=wb.active;ws.title='报名名单'
    ws.append(['报名编号','报名时间']+list(cols.values()))
    for row in records:
        ws.append([row['id'],row['created']]+[row['answers'].get(k,'') for k in cols])
    # Store user text literally, including formula-like values; never export formulas.
    for row in ws:
        for cell in row:
            if isinstance(cell.value,str): cell.data_type='s';cell.number_format='@'
    ws.freeze_panes='A2';ws.auto_filter.ref=ws.dimensions
    for col in ws.columns:ws.column_dimensions[col[0].column_letter].width=24
    out=io.BytesIO();wb.save(out);return out.getvalue()

def import_excel(activity,encoded):
    from openpyxl import load_workbook
    try:data=base64.b64decode(encoded,validate=True)
    except Exception:raise ValueError('Excel 文件无效')
    if len(data)>5*1024*1024:raise ValueError('Excel 不得超过 5MB')
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            if sum(x.file_size for x in archive.infolist())>20*1024*1024:raise ValueError('Excel 解压后过大')
        wb=load_workbook(io.BytesIO(data),read_only=True,data_only=False)
        ws=wb.active
        if ws.max_row>5001 or ws.max_column>35:raise ValueError('最多导入 5000 行、35 列')
        lines=list(ws.iter_rows())
        if not lines:raise ValueError('Excel 为空')
        if any(c.data_type=='f' for row in lines for c in row):raise ValueError('请将公式转换为纯文本后导入')
        headers=[str(c.value or '').strip() for c in lines[0]]
        if len(headers)!=len(set(headers)):raise ValueError('列名不能重复')
        _,fields=config(activity)
        missing=[f['label'] for f in fields if f.get('required') and f['label'] not in headers]
        if missing:raise ValueError('缺少列：'+', '.join(missing))
        parsed=[]
        for index,row in enumerate(lines[1:],2):
            if all(c.value is None for c in row):continue
            values=dict(zip(headers,[str(c.value) if c.value is not None else '' for c in row]))
            try:parsed.append(validate(activity,{f['key']:values.get(f['label'],'') for f in fields}))
            except ValueError as e:raise ValueError('第 '+str(index)+' 行：'+str(e))
    except (zipfile.BadZipFile,KeyError):raise ValueError('请上传有效的 .xlsx 文件')
    finally:
        if 'wb' in locals():wb.close()
    added=0
    with connect() as con:
        con.execute('BEGIN IMMEDIATE')
        for answers in parsed:added+=int(add(con,activity,answers,None)[1])
    return {'ok':True,'added':added,'skipped':len(parsed)-added}

def route(handler,path):
    """Public submission has no read endpoint; admin forwarding requires a server-only secret."""
    if path!='/api/register' and not path.startswith('/api/registration-admin/'):return False
    admin=path.startswith('/api/registration-admin/')
    if admin:
        secret=os.environ.get('REGISTRATION_ADMIN_SECRET','')
        if not secret or not secrets.compare_digest(handler.headers.get('X-Registration-Admin',''),secret):
            handler._json(403,{'ok':False,'error':'需要管理员登录'});return True
    try:
        payload=handler._read_json()
        activity=next((a for a in (handler.registration_content().get('activities') or []) if a['id']==payload.get('activity')),None)
        if not activity:raise ValueError('找不到活动')
        if not admin:result=submit(activity,payload,handler.client_address[0])
        elif path.endswith('/list'):result={'ok':True,'rows':rows(activity['id'])}
        elif path.endswith('/export'):result={'ok':True,'filename':'报名名单.xlsx','file':base64.b64encode(export(activity)).decode()}
        elif path.endswith('/import'):result=import_excel(activity,payload.get('file',''))
        else:raise ValueError('未知操作')
        handler._json(200,result)
    except ValueError as e:handler._json(400,{'ok':False,'error':str(e)})
    except Exception:handler._json(500,{'ok':False,'error':'处理失败，请稍后重试；已保留原有记录'})
    return True
