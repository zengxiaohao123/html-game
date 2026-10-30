#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_library.py —— 把《转盘农场_物品库.xlsx》转成 src/data/generated/library.js

设计原则：
  * 表格是唯一真相源（设计文档 v0.5 §10/§11/§14 已明示）。
  * 本脚本只做机械搬运 + 字段拆分，不做任何数值判断或补全。
  * id / emoji 不在表格里，由 tools/lib_meta.json 提供；缺任何一条即报错中止，
    避免"静默漏条"。

用法：
  python tools/gen_library.py            # 生成并写入
  python tools/gen_library.py --check    # 只校验不写盘

生成物请勿手改，改表格后重跑。
"""

import json
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
XLSX = os.path.join(os.path.dirname(ROOT), 'docs', '转盘农场_物品库.xlsx')
META = os.path.join(ROOT, 'tools', 'lib_meta.json')
OUT = os.path.join(ROOT, 'src', 'data', 'generated', 'library.js')

SHEET = {'说明': 1, '物品总表': 2, '分类字典': 3, '词条字典': 4,
         '产出与掉落': 5, '生物参考': 6, '随机池': 7, '待补录': 8}

# 生物不是物品，走单独的 id 映射（与 src/data/creatures.js 保持一致）
BIO2ID = {
    'BIO-001': 'chick',
    'BIO-002': 'chicken',
    'BIO-003': 'slime',      # 抽象史莱姆，具体元素变体在 creatures.js 里展开
}


# ---------------------------------------------------------------- xlsx 读取
def load_sheets():
    z = zipfile.ZipFile(XLSX)
    shared = []
    try:
        sst = ET.fromstring(z.read('xl/sharedStrings.xml'))
        for si in sst:
            shared.append(''.join(t.text or '' for t in si.iter(NS + 't')))
    except KeyError:
        pass

    def col_index(ref):
        letters = ''.join(c for c in ref if c.isalpha())
        n = 0
        for ch in letters:
            n = n * 26 + ord(ch) - 64
        return n - 1

    def read(idx):
        root = ET.fromstring(z.read('xl/worksheets/sheet%d.xml' % idx))
        rows = []
        for r in root.iter(NS + 'row'):
            cells = {}
            for c in r:
                v = c.find(NS + 'v')
                t = c.get('t')
                if t == 'inlineStr':
                    node = c.find(NS + 'is')
                    val = ''.join(x.text or '' for x in node.iter(NS + 't')) if node is not None else ''
                elif v is None:
                    val = ''
                elif t == 's':
                    val = shared[int(v.text)]
                else:
                    val = v.text or ''
                cells[col_index(c.get('r'))] = val
            width = (max(cells) + 1) if cells else 0
            rows.append([cells.get(i, '').strip() for i in range(width)])
        return rows

    return {name: read(idx) for name, idx in SHEET.items()}


# ---------------------------------------------------------------- 小工具
def num(text, cast=int):
    """空 → None；纯数字 → cast；其余（×2 / 3~4 / '—'）→ None 并把原文留在别处。"""
    if text is None:
        return None
    s = str(text).strip()
    if not s:
        return None
    if re.fullmatch(r'-?\d+(\.\d+)?', s):
        return cast(float(s)) if cast is int else cast(s)
    return None


def bracket_tags(text):
    """抽出【】内的标签"""
    return re.findall(r'【([^】]+)】', text or '')


def split_list(text, seps=(' / ', '/')):
    s = (text or '').strip()
    if not s or s in ('—', '-'):
        return []
    for sep in seps:
        if sep in s:
            return [x.strip() for x in s.split(sep) if x.strip()]
    return [s]


def js(value, indent=2):
    return json.dumps(value, ensure_ascii=False, indent=indent)


# ---------------------------------------------------------------- 各表解析
def parse_items(rows, meta):
    header_i = next(i for i, r in enumerate(rows) if r and r[0] == '物品编号')
    items = []
    missing = []
    for r in rows[header_i + 1:]:
        if not r or not r[0].startswith(('PRD-', 'VEH-', 'FAC-', 'RES-', 'SKL-', 'ITM-', 'TRN-')):
            continue
        cells = r + [''] * (16 - len(r))
        code, name = cells[0], cells[1]
        if code not in meta:
            missing.append('%s %s' % (code, name))
            continue
        ident, emoji = meta[code]

        stack_rule = cells[13]
        tier1, tier2, tier3 = cells[2], cells[3], cells[4]
        hidden = [x for x in re.split(r'[。·]', cells[5]) if x.strip()]
        by_value = '不同价值不可叠放' in stack_rule
        hard_no_stack = ('不可叠放' in stack_rule) and not by_value

        items.append({
            'id': ident,
            'libCode': code,
            'name': name,
            'emoji': emoji,
            'tier1': tier1 or None,
            'tier2': tier2 or None,
            'tier3': tier3 or None,
            'hiddenTags': hidden,
            'owner': cells[6] if cells[6] not in ('', '—') else None,
            'rarity': num(cells[7]),
            'value': num(cells[8]),
            'valueMode': cells[9] or None,
            'traits': bracket_tags(cells[10]),
            'description': cells[11],
            'triggers': split_list(cells[12], (' / ',)),
            'stackRule': stack_rule or None,
            'stackable': not hard_no_stack,
            'stackMax': 999 if '单格999' in stack_rule else 1,
            'stackByValue': by_value,
            'sources': cells[14] or None,
            'notes': cells[15] or None,
        })
    return items, missing


def parse_outputs(rows):
    header_i = next(i for i, r in enumerate(rows) if r and r[0] == '编号')
    out = []
    for r in rows[header_i + 1:]:
        if not r or not r[0].startswith('OUT-'):
            continue
        c = r + [''] * (8 - len(r))
        out.append({'code': c[0], 'fromType': c[1], 'source': c[2], 'product': c[3],
                    'amount': c[4] or None, 'trigger': c[5] or None,
                    'condition': c[6] or None, 'notes': c[7] or None})
    return out


def parse_glossary(rows):
    header_i = next(i for i, r in enumerate(rows) if r and r[0] == '词条')
    out = []
    for r in rows[header_i + 1:]:
        if not r or not r[0] or r[0].startswith('词条字典'):
            continue
        c = r + [''] * (4 - len(r))
        out.append({'term': c[0], 'type': c[1], 'meaning': c[2], 'notes': c[3] or None})
    return out


def parse_creatures(rows):
    header_i = next(i for i, r in enumerate(rows) if r and r[0] == '编号')
    out = []
    for r in rows[header_i + 1:]:
        if not r or not r[0].startswith('BIO-'):
            continue
        c = r + [''] * (12 - len(r))
        out.append({'code': c[0], 'name': c[1], 'kind': c[2],
                    'hp': num(c[3]), 'atk': num(c[4]), 'res': c[5] or None,
                    'mood': num(c[6]), 'growth': c[7] or None,
                    'feed': c[8] or None, 'produce': c[9] or None,
                    'drop': c[10] or None, 'special': c[11] or None,
                    'notes': c[12] if len(c) > 12 else None})
    return out


def parse_pools(rows, code2id):
    pools = []
    cur = None
    for r in rows:
        if not r or not any(r):
            continue
        head = r[0]
        m = re.match(r'^(POOL-\d+)', head)
        if m and len([x for x in r if x]) <= 2:
            title = ' '.join(x for x in r if x).strip()
            name = re.sub(r'^POOL-\d+\s*', '', head).strip()
            name = re.sub(r'[（(].*', '', name).strip()
            dm = re.search(r'(\d+)\s*[~～-]\s*(\d+)\s*件', title)
            cur = {'code': m.group(1), 'name': name, 'title': title,
                   'drawMin': int(dm.group(1)) if dm else None,
                   'drawMax': int(dm.group(2)) if dm else None,
                   'entries': []}
            pools.append(cur)
            continue
        if head == '序号' or cur is None:
            continue
        if not re.fullmatch(r'\d+', head):
            continue
        c = r + [''] * (8 - len(r))
        if not c[1].startswith(('PRD-', 'VEH-', 'FAC-', 'RES-', 'SKL-', 'ITM-', 'TRN-', 'BIO-')):
            continue
        cur['entries'].append({
            'libCode': c[1],
            'id': code2id.get(c[1]) or BIO2ID.get(c[1]),
            'name': c[2] or None,
            'price': num(c[3]),
            'weight': num(c[4], float),
            'rarity': num(c[5]),
            'placeholder': (c[6] == '是'),
            'notes': c[7] or None,
        })
    return pools


def parse_todo(rows):
    header_i = next(i for i, r in enumerate(rows) if r and r[0] == '序号')
    out = []
    for r in rows[header_i + 1:]:
        if not r or not re.fullmatch(r'\d+', r[0] or ''):
            continue
        c = r + [''] * (7 - len(r))
        out.append({'no': int(c[0]), 'title': c[1], 'type': c[2], 'detail': c[3],
                    'where': c[4] or None, 'priority': c[5] or None, 'status': c[6] or None})
    return out


# ---------------------------------------------------------------- 主流程
def main():
    check_only = '--check' in sys.argv
    meta_raw = json.load(open(META, encoding='utf-8'))
    meta = {k: v for k, v in meta_raw.items() if not k.startswith('_')}

    sheets = load_sheets()
    items, missing = parse_items(sheets['物品总表'], meta)
    code2id = {it['libCode']: it['id'] for it in items}

    id_seen, dup = set(), []
    for it in items:
        if it['id'] in id_seen:
            dup.append(it['id'])
        id_seen.add(it['id'])

    pools = parse_pools(sheets['随机池'], code2id)
    outputs = parse_outputs(sheets['产出与掉落'])
    glossary = parse_glossary(sheets['词条字典'])
    creatures = parse_creatures(sheets['生物参考'])
    todo = parse_todo(sheets['待补录'])

    # ---- 校验 ----
    problems = []
    if missing:
        problems.append('lib_meta.json 缺少 %d 条映射：%s' % (len(missing), '、'.join(missing)))
    if dup:
        problems.append('id 重复：%s' % '、'.join(sorted(set(dup))))
    unused = [k for k in meta if k not in code2id]
    if unused:
        problems.append('lib_meta.json 有 %d 条多余映射（表格中已无此编号）：%s' % (len(unused), '、'.join(unused)))
    for p in pools:
        for e in p['entries']:
            if e['id'] is None:
                problems.append('%s 引用了未知编号 %s（%s）' % (p['code'], e['libCode'], e['name']))

    if problems:
        print('✗ 校验失败：')
        for p in problems:
            print('   -', p)
        return 1

    # ---- 统计 ----
    by_tier = {}
    for it in items:
        by_tier[it['tier1']] = by_tier.get(it['tier1'], 0) + 1
    stat = {'total': len(items), 'byTier1': by_tier,
            'pools': len(pools), 'outputs': len(outputs),
            'glossary': len(glossary), 'creatures': len(creatures),
            'todo': len(todo)}

    print('✓ 校验通过：物品 %d 条 / 随机池 %d 个 / 产出 %d 条 / 词条 %d 条 / 生物 %d 条 / 待补 %d 条'
          % (len(items), len(pools), len(outputs), len(glossary), len(creatures), len(todo)))
    print('  一级分类：', '、'.join('%s %d' % kv for kv in sorted(by_tier.items(), key=lambda x: -x[1])))

    if check_only:
        print('  （--check 模式，未写盘）')
        return 0

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write('// ⚠️ 本文件由 tools/gen_library.py 从 docs/转盘农场_物品库.xlsx 自动生成，请勿手改。\n')
        f.write('// 重新生成：python tools/gen_library.py\n')
        f.write('// 手工维护的部分只有 tools/lib_meta.json（编号 → id / emoji）。\n\n')
        f.write('export const LIB_STAT = %s;\n\n' % js(stat))
        f.write('/** 物品总表（%d 条）—— 表格第 2 张工作表 */\n' % len(items))
        f.write('export const ITEMS = {\n')
        for it in items:
            f.write('  %s: %s,\n' % (it['id'], js(it)))
        f.write('};\n\n')
        f.write('/** 随机池（%d 个）—— 表格第 7 张工作表 */\n' % len(pools))
        f.write('export const POOLS = {\n')
        for p in pools:
            f.write('  %s: %s,\n' % (json.dumps(p['code']), js(p)))
        f.write('};\n\n')
        f.write('/** 产出与掉落（%d 条）—— 表格第 5 张工作表 */\n' % len(outputs))
        f.write('export const OUTPUTS = %s;\n\n' % js(outputs))
        f.write('/** 词条字典（%d 条）—— 表格第 4 张工作表 */\n' % len(glossary))
        f.write('export const GLOSSARY = %s;\n\n' % js(glossary))
        f.write('/** 生物参考（%d 条）—— 表格第 6 张工作表，非物品 */\n' % len(creatures))
        f.write('export const CREATURES_REF = %s;\n\n' % js(creatures))
        f.write('/** 待补录清单（%d 条）—— 表格第 8 张工作表 */\n' % len(todo))
        f.write('export const TODO_LIST = %s;\n' % js(todo))

    print('✓ 已写入 %s' % os.path.relpath(OUT, ROOT))
    return 0


if __name__ == '__main__':
    sys.exit(main())
