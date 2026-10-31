#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
merge_cards.py — 把「脑袋内容台 · 药化卡片」导出的 JSON 并进 药化脑袋/molecules.js

用法（必须在装了 RDKit 的解释器下跑）：
    python merge_cards.py cards.json                # 真写回 molecules.js
    python merge_cards.py cards.json --dry-run      # 只看会发生什么，不写文件
    python merge_cards.py cards.json --backup       # 写之前留一份 .bak
    python merge_cards.py --check                   # 只体检现有 molecules.js 的 SMILES

它会做四件事：
 1. 用 RDKit 校验每条 SMILES，解析不了的直接跳过并在报告里点名；
 2. 按现有样式渲染 320x260 内联 SVG（白底，与已有 63 张一致）；
 3. 用 key（英文名 slug，重复自动加 -2/-3）生成稳定标识；
 4. 覆盖式合并：id 已存在 → 更新内容（保留原 svg 之外的旧字段如 img），否则按最大 id+1 追加。
图片字段 img 保持为空字符串，前端会自动回落到内联 SVG（index.html 里 m.img || m.svg 的逻辑）。
"""
import io
import json
import os
import re
import shutil
import sys

try:
    from rdkit import Chem
    from rdkit.Chem import AllChem
    from rdkit.Chem.Draw import rdMolDraw2D
    from rdkit import RDLogger
    RDLogger.DisableLog("rdApp.*")
except ImportError:
    sys.stderr.write("需要 RDKit，请用装了 RDKit 的解释器运行\n")
    sys.exit(2)

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
MOL_JS = os.path.join(ROOT, "项目1药化脑袋", "molecules.js")

FOOT = ("// Auto-generated — 教材分组数据（掌握/熟悉按学促会标注，图片取自 img/useful）\n"
        "// group: master=掌握组(看名识结构) familiar=熟悉组(看结构识名)\n")


def read_js(path):
    """拆出 CHAPTERS 与 MOLECULES 两个结构，保留头部注释。"""
    s = io.open(path, encoding="utf-8").read()
    ic = s.index("const CHAPTERS")
    im = s.index("const MOLECULES")
    chapters_line = s[ic:im]                    # 'const CHAPTERS = {...};\n'
    arr_start = s.index("[", im)
    chapters = json.JSONDecoder().raw_decode(
        chapters_line[chapters_line.index("{"):])[0]
    molecules = json.JSONDecoder().raw_decode(s, arr_start)[0]
    return chapters, molecules


def write_js(path, chapters, molecules):
    body = json.dumps(molecules, ensure_ascii=False, indent=1)
    out = (FOOT
           + "const CHAPTERS = " + json.dumps(chapters, ensure_ascii=False) + ";\n"
           + "const MOLECULES = " + body + ";\n")
    tmp = path + ".tmp"
    io.open(tmp, "w", encoding="utf-8", newline="\n").write(out)
    os.replace(tmp, path)
    return len(out)


def to_svg(smi, w=320, h=260):
    """渲染成与现有卡片同规格的内联 SVG；失败返回 (None, 原因)。"""
    m = Chem.MolFromSmiles(smi)
    if m is None:
        return None, "SMILES 解析失败"
    if m.GetNumAtoms() == 0:
        return None, "空分子"
    AllChem.Compute2DCoords(m)
    d = rdMolDraw2D.MolDraw2DSVG(w, h)
    o = d.drawOptions()
    o.clearBackground = True
    o.setBackgroundColour((1.0, 1.0, 1.0, 1.0))
    o.addStereoAnnotation = True
    try:
        rdMolDraw2D.PrepareAndDrawMolecule(d, m)
    except Exception as e:
        return None, "渲染异常: %s" % e
    d.FinishDrawing()
    svg = d.GetDrawingText()
    # 去掉 XML 声明（内联进 JS 不需要，且原文件也没留）
    svg = re.sub(r"^<\?xml[^>]*\?>\s*", "", svg).strip()
    if not svg.startswith("<svg"):
        return None, "渲染结果不是 SVG"
    return svg, None


def slug(en, cn):
    base = (en or cn or "mol").strip().lower()
    base = re.sub(r"[^a-z0-9]+", "-", base).strip("-")
    return base or "mol"


def main(argv):
    global MOL_JS
    dry = "--dry-run" in argv
    backup = "--backup" in argv
    check = "--check" in argv
    rm = []
    for a in argv[1:]:
        if a.startswith("--mol="):          # 换目标文件（自测/多套数据用）
            MOL_JS = a.split("=", 1)[1]
        if a.startswith("--remove="):       # 在内容台里删掉的卡片 id
            rm = [int(x) for x in a.split("=", 1)[1].split(",") if x.strip().isdigit()]
    args = [a for a in argv[1:] if not a.startswith("--")]

    if not os.path.exists(MOL_JS):
        sys.stderr.write("找不到 %s\n" % MOL_JS)
        return 2
    chapters, molecules = read_js(MOL_JS)
    print("现有卡片 %d 张，章节 %d 个" % (len(molecules), len(chapters)))

    gone = []
    if rm:
        gone = [m for m in molecules if m["id"] in rm]
        if gone:
            molecules[:] = [m for m in molecules if m["id"] not in rm]
            print("删除 %d 张：%s" % (len(gone), "，".join("#%s %s" % (m["id"], m["cn"]) for m in gone)))

    if check:
        bad = [m for m in molecules if Chem.MolFromSmiles(m.get("smi", "")) is None]
        if bad:
            print("✗ %d 张 SMILES 有问题：" % len(bad))
            for m in bad:
                print("   #%s %s  %s" % (m.get("id"), m.get("cn"), m.get("smi")))
            return 1
        print("✓ 全部 SMILES 可解析")
        return 0

    if not args and not rm:
        sys.stderr.write("请给出内容台导出的 JSON 路径（或加 --check 只体检）\n")
        return 2
    src = args[0] if args else None
    if src is None:
        incoming = []
    else:
        if not os.path.exists(src):
            sys.stderr.write("找不到 %s\n" % src)
            return 2
        incoming = json.load(io.open(src, encoding="utf-8"))
        if isinstance(incoming, dict):
            incoming = incoming.get("cards") or incoming.get("cardsNew") or []
    print("待并入 %d 张" % len(incoming))

    by_id = {m["id"]: m for m in molecules}
    used_key = {m.get("key") for m in molecules if m.get("key")}
    canon_of = {}                      # 规范化 SMILES -> (id, 中文名)，用于结构查重
    for m in molecules:
        mm = Chem.MolFromSmiles(m.get("smi", "") or "")
        if mm is not None:
            canon_of.setdefault(Chem.MolToSmiles(mm), (m["id"], m["cn"]))
    next_id = max([m["id"] for m in molecules] + [0]) + 1

    added, updated, skipped, dup = [], [], [], []
    for raw in incoming:
        cn = (raw.get("cn") or "").strip()
        smi = (raw.get("smi") or "").strip()
        if not cn or not smi:
            skipped.append((raw.get("id"), cn or "(无名)", "中文名或 SMILES 为空"))
            continue
        svg, why = to_svg(smi)
        if svg is None:
            skipped.append((raw.get("id"), cn, why))
            continue

        rid = raw.get("id")
        canon = Chem.MolToSmiles(Chem.MolFromSmiles(smi))
        if canon in canon_of and canon_of[canon][0] != rid:
            dup.append((rid, cn, canon_of[canon]))
            continue

        ch = int(raw.get("chapter") or 1)
        key = slug(raw.get("en"), cn)
        cand, n = key, 2
        while cand in used_key:
            cand, n = "%s-%d" % (key, n), n + 1

        car = {
            "id": rid if rid else next_id,
            "cn": cn,
            "en": (raw.get("en") or "").strip(),
            "group": raw.get("group") if raw.get("group") in ("master", "familiar") else "master",
            "chapter": ch,
            "chapterName": chapters.get(str(ch), ""),
            "klass": (raw.get("klass") or "").strip(),
            "effect": (raw.get("effect") or "").strip(),
            "img": "",
            "smi": smi,
            "svg": svg,
            "key": cand,
        }

        if car["id"] in by_id:
            old = by_id[car["id"]]
            car["img"] = old.get("img") or ""
            # 原位替换，保持顺序
            for i, m in enumerate(molecules):
                if m["id"] == car["id"]:
                    molecules[i] = car
                    break
            by_id[car["id"]] = car
            updated.append((car["id"], cn, cand))
        else:
            if car["id"] in (None, 0) or car["id"] >= next_id:
                car["id"] = next_id
            next_id = max(next_id, car["id"] + 1)
            molecules.append(car)
            by_id[car["id"]] = car
            added.append((car["id"], cn, cand))
        used_key.add(cand)
        canon_of[canon] = (car["id"], cn)

    print("\n新增 %d 张：" % len(added))
    for i, cn, k in added:
        print("   + #%s  %s  (key=%s)" % (i, cn, k))
    print("更新 %d 张：" % len(updated))
    for i, cn, k in updated:
        print("   ~ #%s  %s  (key=%s)" % (i, cn, k))
    if dup:
        print("结构已在库中，跳过 %d 张（不重复入库）：" % len(dup))
        for i, cn, (eid, ecn) in dup:
            print("   = #%s  %s  → 已有 #%s %s" % (i, cn, eid, ecn))
    if skipped:
        print("解析失败/字段缺失，跳过 %d 张：" % len(skipped))
        for i, cn, why in skipped:
            print("   ! #%s  %s  — %s" % (i, cn, why))

    if not added and not updated and not gone:
        print("\n没有需要写入的内容。")
        return 0
    if dry:
        print("\n[dry-run] 未写文件。")
        return 0
    if backup:
        b = MOL_JS + ".bak"
        shutil.copy2(MOL_JS, b)
        print("\n已备份 → %s" % b)
    size = write_js(MOL_JS, chapters, molecules)
    print("已写回 %s（%d 张 / %.1f KB）" % (MOL_JS, len(molecules), size / 1024.0))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
