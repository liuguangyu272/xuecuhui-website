#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 yaohua-src 打包成单文件 HTML，直接输出到线上 yaohua/index.html

输出 JSON（供 server.js 调用）：
  {ok, molecules, embedded, missing, size} 或 {ok:false, error}

安全策略：解析失败时直接返回错误、不写目标文件，线上保留旧版本。
"""
import base64
import json
import os
import re

BASE = '/opt/xuecuhui-console/yaohua-src'
OUT = '/www/wwwroot/xuecuhui/yaohua/index.html'


def main():
    mol_path = os.path.join(BASE, 'molecules.js')
    ui_path = os.path.join(BASE, 'index.html')

    if not os.path.exists(mol_path) or not os.path.exists(ui_path):
        return {'ok': False, 'error': '源文件缺失'}

    src = open(mol_path, encoding='utf-8').read()
    mc = re.search(r'const CHAPTERS = (\{.*?\});', src, re.S)
    mm = re.search(r'const MOLECULES = (\[.*\]);', src, re.S)
    if not mc or not mm:
        return {'ok': False, 'error': 'molecules.js 结构无法解析（可能被改坏了）'}

    try:
        chapters = json.loads(mc.group(1))
        mols = json.loads(mm.group(1))
    except Exception as e:
        return {'ok': False, 'error': 'molecules.js JSON 解析失败: %s' % e}

    embedded = 0
    missing = []
    for m in mols:
        rel = m.get('img') or ''
        if rel.startswith('data:'):
            embedded += 1
            continue
        if not rel:
            continue
        path = os.path.join(BASE, rel)
        if os.path.exists(path):
            ext = os.path.splitext(rel)[1].lower()
            mime = 'image/png' if ext == '.png' else 'image/jpeg'
            b64 = base64.b64encode(open(path, 'rb').read()).decode('ascii')
            m['img'] = 'data:%s;base64,%s' % (mime, b64)
            embedded += 1
        else:
            m['img'] = ''
            missing.append(rel)

    ui = open(ui_path, encoding='utf-8').read()
    tag = '<script src="molecules.js"></script>'
    if tag not in ui:
        return {'ok': False, 'error': 'index.html 中找不到 molecules.js 引用'}

    data_js = ('<script>\nconst CHAPTERS = ' + json.dumps(chapters, ensure_ascii=False)
               + ';\nconst MOLECULES = ' + json.dumps(mols, ensure_ascii=False) + ';\n</script>')
    ui = ui.replace(tag, data_js)

    if 'img/crops/' in ui or 'img/useful/' in ui:
        return {'ok': False, 'error': '打包后仍残留外链图片引用'}

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = OUT + '.part'
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(ui)
    os.replace(tmp, OUT)

    return {
        'ok': True,
        'molecules': len(mols),
        'embedded': embedded,
        'missing': missing[:10],
        'size': os.path.getsize(OUT),
    }


if __name__ == '__main__':
    try:
        print(json.dumps(main(), ensure_ascii=False))
    except Exception as e:
        print(json.dumps({'ok': False, 'error': str(e)}, ensure_ascii=False))
