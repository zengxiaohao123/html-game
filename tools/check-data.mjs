// tools/check-data.mjs —— 数据层一致性巡检（Node，无 DOM，不依赖浏览器）
//
// 目的：把"表格改了但代码没跟上""池子候选不够抽""引用了不存在的 id"
// 这类静默错误在命令行里抓出来，而不是等玩家点到某个面板才崩。
//
// 用法：
//   node tools/check-data.mjs          # 巡检 + 覆盖率报告
//   node tools/check-data.mjs --strict # 有警告也返回非 0（CI 用）
//
// 退出码：0 = 无硬错误；1 = 有硬错误（引用断裂 / 生成物缺失）

import { ITEMS, POOLS, OUTPUTS, LIB_STAT, GLOSSARY } from '../src/data/items.js';

const STRICT = process.argv.includes('--strict');
const HARD = [];   // 必须修
const WARN = [];   // 应该修

const ok = (m) => console.log('  \x1b[32m✓\x1b[0m ' + m);
const warn = (m) => { WARN.push(m); console.log('  \x1b[33m!\x1b[0m ' + m); };
const bad = (m) => { HARD.push(m); console.log('  \x1b[31m✗\x1b[0m ' + m); };
const head = (m) => console.log('\n\x1b[36m' + m + '\x1b[0m');

// ────────────────────────────────────────────── 1. 生成物自身
head('1. 物品库生成物');
const ids = Object.keys(ITEMS);
console.log(`  条目 ${ids.length} 条（LIB_STAT.total = ${LIB_STAT.total}）`);
if (ids.length !== LIB_STAT.total) bad(`条目数 ${ids.length} 与 LIB_STAT.total ${LIB_STAT.total} 不一致`);
else ok('条目数与统计一致');

const needFields = ['id', 'libCode', 'name', 'emoji', 'tier1', 'rarity'];
for (const id of ids) {
  const it = ITEMS[id];
  if (it.id !== id) bad(`${id}: 键名与 id 字段不一致（${it.id}）`);
  for (const f of needFields) {
    if (it[f] === undefined || it[f] === null || it[f] === '') bad(`${id}: 缺字段 ${f}`);
  }
  if (it.value == null && it.valueMode !== '未定义') warn(`${id}: value 为空但价值口径不是「未定义」`);
}
if (!HARD.length) ok('全部条目必填字段齐备');

const tiers = {};
for (const id of ids) tiers[ITEMS[id].tier1] = (tiers[ITEMS[id].tier1] || 0) + 1;
console.log('  一级分类：' + Object.entries(tiers).map(([k, v]) => `${k} ${v}`).join(' / '));
for (const t of ['地块内容', '道具', '产物', '载具', '地形']) {
  if (!tiers[t]) bad(`一级分类「${t}」没有任何条目`);
}

// ────────────────────────────────────────────── 2. 随机池
head('2. 随机池候选量');
for (const [code, pool] of Object.entries(POOLS)) {
  const n = pool.entries.length;
  const real = pool.entries.filter((e) => !e.placeholder).length;
  const ph = n - real;
  const need = pool.drawMin;
  let line = `  ${code} ${pool.name}: 候选 ${n}（可用 ${real} + 占位 ${ph}）`;
  if (pool.drawMin != null) line += `，每抽 ${pool.drawMin}~${pool.drawMax}`;
  console.log(line);

  if (pool.drawMin != null && real < pool.drawMin) {
    // 占位物品会自动补入（RandomPool.resolveCandidates），所以这里只告警不判死
    warn(`${code} 可用候选 ${real} 条 < 抽取下限 ${pool.drawMin} 条 —— 将自动用占位物品补足`);
  } else if (pool.drawMax != null && real < pool.drawMax) {
    warn(`${code} 可用候选 ${real} 条 < 抽取上限 ${pool.drawMax} 条 —— 抽满时会重复/不足`);
  }
  const noWeight = pool.entries.filter((e) => e.weight == null).length;
  if (noWeight === n && n > 0) warn(`${code} 权重全为空，抽取只能按等权实现`);
}

// ────────────────────────────────────────────── 3. 池内引用
head('3. 池内引用有效性');
const itemIdSet = new Set(ids);
let broken = 0;
for (const [code, pool] of Object.entries(POOLS)) {
  for (const e of pool.entries) {
    if (e.id && !itemIdSet.has(e.id) && !e.id.startsWith('chick') && !e.id.startsWith('chicken') && !e.id.startsWith('slime')) {
      bad(`${code} 引用了不存在的物品 id：${e.id}（${e.libCode} ${e.name}）`);
      broken++;
    }
  }
}
if (!broken) ok('全部池条目都能解析到物品/生物 id');

// ────────────────────────────────────────────── 4. 产出表
head('4. 产出与掉落');
console.log(`  ${OUTPUTS.length} 条映射`);
const srcNames = new Set(Object.values(ITEMS).map((i) => i.name));
const CREATURE_NAMES = new Set(['小鸡', '鸡', '史莱姆']);
const NOT_AN_ITEM = /价值|效果|生命|枯萎|随机|金币|储存/;
for (const o of OUTPUTS) {
  const p = o.product || '';
  const isItem = srcNames.has(p) || p.split(/\s*\/\s*/).every((x) => srcNames.has(x));
  if (!isItem && !CREATURE_NAMES.has(p) && !NOT_AN_ITEM.test(p)) {
    warn(`${o.code} 产出物「${p}」在物品总表里找不到同名条目`);
  }
}
ok('产出表引用检查完成');

// ────────────────────────────────────────────── 5. 代码侧数据覆盖
head('5. 代码侧数据表覆盖（对照物品库）');
async function tryImport(path) {
  try { return await import(path); } catch (e) { bad(`import ${path} 失败：${e.message}`); return null; }
}

const libFacilities = Object.values(ITEMS).filter((i) => i.tier2 === '设施').map((i) => i.id);
const libResources = Object.values(ITEMS).filter((i) => i.tier2 === '资源').map((i) => i.id);
const libSkills = Object.values(ITEMS).filter((i) => i.tier2 === '技能').map((i) => i.id);
const libVehicles = Object.values(ITEMS).filter((i) => i.tier1 === '载具').map((i) => i.id);
const libTerrains = Object.values(ITEMS).filter((i) => i.tier1 === '地形').map((i) => i.id);

const facMod = await tryImport('../src/data/facilities.js');
const resMod = await tryImport('../src/data/resources.js');
const terMod = await tryImport('../src/data/terrains.js');
const vehMod = await tryImport('../src/data/vehicles.js');
const chrMod = await tryImport('../src/data/characters.js');

function coverage(label, libIds, codeIds) {
  if (!codeIds) return;
  const missing = libIds.filter((x) => !codeIds.has(x));
  const extra = [...codeIds].filter((x) => !libIds.includes(x));
  const pct = ((libIds.length - missing.length) / libIds.length * 100).toFixed(0);
  console.log(`  ${label}：库 ${libIds.length} / 代码 ${codeIds.size}（覆盖 ${pct}%）`);
  if (missing.length) warn(`${label} 缺 ${missing.length} 个：${missing.join('、')}`);
  if (extra.length) warn(`${label} 多出库中没有的：${extra.join('、')}`);
}

if (facMod?.ALL_FACILITIES) {
  const codeIds = new Set(facMod.ALL_FACILITIES.map((f) => f.id).filter((id) => id.startsWith('facility_')));
  coverage('设施', libFacilities, codeIds);
}
if (resMod?.ALL_RESOURCE_IDS) coverage('资源', libResources, new Set(resMod.ALL_RESOURCE_IDS));
if (terMod?.ALL_TERRAIN_IDS) coverage('地形', libTerrains, new Set(terMod.ALL_TERRAIN_IDS));
if (vehMod?.ALL_VEHICLE_IDS) {
  // vehicles.js 用 vehicle_* 前缀，物品库用 item_*；按去掉前缀的语义名对齐
  const codeIds = new Set([...vehMod.ALL_VEHICLE_IDS].map((v) => 'item_' + v.replace(/^vehicle_/, '')));
  coverage('载具', libVehicles, codeIds);
}
if (chrMod?.ALL_SKILL_IDS) coverage('技能', libSkills, new Set(chrMod.ALL_SKILL_IDS));

// ────────────────────────────────────────────── 6. 词条字典 vs Hook
head('6. 词条字典 vs HookDispatcher');
// 词条（中文）→ hook 类型（英文）的显式对照；新增触发时点时两边都要加
const TERM_TO_HOOK = {
  经过时: 'onPass',
  进入时: 'onEnter',
  受祝福时: 'onBlessed',
  每一日开始时: 'onDailyStart',
  每日开始时: 'onDailyStart',
  每一日结束时: 'onDailyEnd',
  生物增加时: 'onCreatureAdded',
  使用技能时: 'onUseSkill',
  移动后: 'onMoveEnd',
  睡觉时: 'onSleep',
  替换时: 'onReplace',
  放置时: 'onPlace',
  闪避时: 'onDodge',
  合成或加工时: 'onCraft',
  使用时: 'onUseItem',
  角色回复生命值时: 'onHeal',
  连携技: null, // 实时窗口，不走 hook
};
try {
  const hooks = await import('../src/core/HookDispatcher.js');
  const known = new Set(hooks.HOOK_TYPES || []);
  const triggerTerms = GLOSSARY.filter((g) => g.type === '触发时点').map((g) => g.term);
  const missing = [];
  for (const term of triggerTerms) {
    if (!(term in TERM_TO_HOOK)) { missing.push(`${term}（未登记对照）`); continue; }
    const hook = TERM_TO_HOOK[term];
    if (hook && !known.has(hook)) missing.push(`${term} → ${hook}`);
  }
  console.log(`  词条字典触发时点 ${triggerTerms.length} 个，代码 HOOK_TYPES ${known.size} 个`);
  if (missing.length) warn(`缺 ${missing.length} 个 hook 类型：${missing.join('、')}`);
  else ok('触发时点均有对应 hook');
} catch (e) {
  warn('未能读取 HookDispatcher：' + e.message);
}

// ────────────────────────────────────────────── 汇总
head('汇总');
console.log(`  硬错误 ${HARD.length} 条 / 警告 ${WARN.length} 条`);
if (HARD.length) {
  console.log('\n  硬错误：');
  HARD.forEach((m, i) => console.log(`   ${i + 1}. ${m}`));
}
process.exit(HARD.length || (STRICT && WARN.length) ? 1 : 0);
