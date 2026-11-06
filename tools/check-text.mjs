// tools/check-text.mjs
// 玩家可见文案逐字校验：data/*.js 的 description 必须与物品库 / 设计文档原文逐字一致。
// 同时校验：备注（note）0 外露、显性词条（traits）0 混入正文、语义分行生效，
// 以及 InfoPanel 不另抄一份写死描述（必须取数据层 + pre-line 渲染）。

import { readFileSync } from 'node:fs';
import { ITEMS } from '../src/data/items.js';
import { SKILLS, SPIRITS } from '../src/data/characters.js';
import { TALENTS } from '../src/data/talents.js';
import { BUFFS } from '../src/data/buffs.js';
import { VEHICLES } from '../src/data/vehicles.js';
import { POTIONS } from '../src/data/potions.js';
import { GRIMOIRES } from '../src/data/grimoires.js';
import { COLLECTIBLES } from '../src/data/collectibles.js';
import { TERRAINS } from '../src/data/terrains.js';
import { CREATURES } from '../src/data/creatures.js';

const NL = '\n';

// 设计文档 §12.7–§12.9 天赋原文（备注已剥离到 note）
const TALENT_EXPECT = {
  yumo_heyixiangwo: '【天赋】物理伤害加成 +50%。每造成一种元素伤害后，本日内物理伤害 -20%，该元素伤害 +20%',
  xiayangFearless_lv1: '【天赋】我方角色造成的物理伤害 +5，火元素伤害 +5',
  xiayangEnergetic: '【天赋】睡觉时回复的生命值翻倍，额外回复 2 点行动力',
  xiayangCurious: '【天赋】危险生物与极度危险生物被击败时，30% 概率额外获得 1 次奖励，50% 概率额外获得金币 ×1',
  xiayangWant: '【天赋】可使用载具【巧遇】：移动至任意一格，每天限 1 次',
  xiayangReborn: '【天赋】角色受到致命伤害时不倒下，回复 50% 生命值且攻击力 +25%。冷却 3 天',
  luyouyouSkilled_lv1: `【天赋】【每一日开始时】40% 概率获得 1 个随机物品${NL}【天赋】【合成或加工时】25% 概率返还 1 个原材料`,
  luyouyouCooking: '【天赋】食物提供更好回复效果且价值更高。角色最大生命值 +20',
  luyouyouDancing_lv1: `【天赋】【移动后】回复 6 点生命值${NL}【天赋】角色闪避率 +32%${NL}【天赋】【闪避时】为主角回复 12 点生命值`,
  luyouyouWindBreath_lv1: `【天赋】我方角色造成的风元素伤害 +20${NL}【天赋】陆悠悠所有技能暴击率 +30%，暴击时本次技能伤害类型改为风元素伤害`,
  luyouyouTwin: '【天赋】陆悠悠攻击暴击后，其余我方角色下一次攻击暴击率 +100%，不可叠加',
};

// 设计文档 §15 Debuff / 状态词条原文 + 物品库【暴躁】
const BUFF_EXPECT = {
  exhausted: `行动力 <0 时获得，持续 1 天。${NL}睡觉时固定回复行动力上限一半（不溢出；若当前为负则先变 0 再回复），所有睡觉增益失效`,
  slime: '玩家进入该格时，生命 -5、行动力 -1，然后移除。',
  burn: '每个回合开始时，该单位流失 3% 生命值（可致死）。',
  weakened: `造成的伤害减少对应百分比。${NL}同名效果取最高，持续时间独立。`,
  vulnerable: `受到的伤害增加对应百分比。${NL}同名效果取最高，持续时间独立。`,
  charge: '敌人专属状态，具体在敌人技能介绍中说明。',
  grumpy: '角色攻击力 +25%，持续 1 天，不可叠加。',
};

// 设计文档 §12.2 精灵原文
const SPIRIT_EXPECT = {
  momo: '每一日的首次祈福所需的行动力和金币各 -50%（至少 -1，最低减至 0）。',
  qingfeng: '每次祈福后为角色回复 6 点生命值，并使本日内角色攻击力 +8%。',
  yuyuan: '每次祈福后，本日内的下一次移动不消耗行动力。',
};

// 设计文档 §13.3 生物原文
const CHICK = `生命值 50，攻击力 0，抗性均为 0。成长值初始 0，心情值初始 0。${NL}每一日开始时消耗对应鸡舍内的稻草 ×1 或小麦 ×1，变为【已投喂】；或在栅栏内自由移动经过草地形时消耗 1 草元素量，下一日开始无需消耗即【已投喂】。两者都不满足则【饥饿】。${NL}已投喂：成长值 +（10 + 心情值）。饥饿：心情 -1，成长值 +5。${NL}来自鸡舍：玩家每次进入鸡舍心情 +1（每日限 1 次）；其他方式心情固定 0。${NL}成长值满 → 变为鸡。通常不受攻击，被击败掉生肉 ×1。`;
const CHICKEN = `生命值 100，攻击力 0，心情值初始 0。${NL}投喂机制同小鸡。${NL}已投喂：产 1 个鸡蛋，并有（心情值 ×10%）概率产优质鸡蛋（心情负视为 0%）。饥饿：心情 -1。${NL}来自鸡舍：进鸡舍心情 +1（每日限 1 次）；其他方式心情固定 0。${NL}通常不受攻击，被击败掉生肉 ×3。`;
const SLIME = `生命值 40，攻击力 10，抗性 0。${NL}【元素免疫】7 种类型，免疫自身对应元素伤害。${NL}【粘液喷吐】每一日开始时 5% 概率对随机 1 格施加【粘液】debuff。危险生物容量超负荷时改为 15%。${NL}被击败掉落史莱姆凝胶 ×1。`;

const errors = [];
let checked = 0;

function check(label, actual, expected) {
  checked++;
  if (actual !== expected) {
    errors.push(`[逐字不一致] ${label}\n  期望: ${JSON.stringify(expected)}\n  实际: ${JSON.stringify(actual)}`);
  }
}

// ── 1. 物品（93 条，生成器已与 xlsx 逐字断言，这里再做备注/词条外露检查）──
for (const it of Object.values(ITEMS)) {
  checked++;
  if (!it.description) errors.push(`[空描述] ${it.id}`);
  if (it.notes && it.description.includes(it.notes)) errors.push(`[备注外露] ${it.id}`);
  for (const tag of it.traits || []) {
    if (it.description.includes(`【${tag}】`)) errors.push(`[显性词条混入正文] ${it.id} ${tag}`);
  }
}

// ── 2. 技能 / 载具 / 消耗道具 / 魔导书 / 收藏品 / 地形：必须引用物品库原文 ──
const refChecks = [
  ...Object.values(SKILLS).map((x) => [`技能 ${x.name}`, x.description, ITEMS[x.id]?.description]),
  ...Object.values(VEHICLES).map((x) => [`载具 ${x.name}`, x.description, ITEMS[x.id.replace('vehicle_', 'item_')]?.description]),
  ...Object.values(POTIONS).map((x) => [`道具 ${x.name}`, x.description, ITEMS[x.itemId]?.description]),
  ...Object.values(GRIMOIRES).map((x) => [`魔导书 ${x.name}`, x.description, ITEMS[x.itemId]?.description]),
  ...Object.values(COLLECTIBLES).map((x) => [`收藏品 ${x.name}`, x.description, ITEMS[x.itemId]?.description]),
  ...Object.values(TERRAINS).map((x) => [`地形 ${x.name}`, x.description, ITEMS[x.id]?.description]),
];
for (const [label, actual, expected] of refChecks) check(label, actual, expected);

// ── 3. 天赋 / buff / 精灵 / 生物：与设计文档原文逐字比对 ──
for (const t of Object.values(TALENTS)) check(`天赋 ${t.name}`, t.description, TALENT_EXPECT[t.id]);
for (const b of Object.values(BUFFS)) check(`状态 ${b.name}`, b.description, BUFF_EXPECT[b.id]);
for (const s of Object.values(SPIRITS)) check(`精灵 ${s.name}`, s.description, SPIRIT_EXPECT[s.id]);
for (const c of Object.values(CREATURES)) {
  const expected = c.kind === 'chick' ? CHICK : c.kind === 'chicken' ? CHICKEN : SLIME;
  check(`生物 ${c.name}`, c.description, expected);
}

// ── 4. 备注 0 外露：手写数据的 note 不得出现在 description ──
for (const [group, obj] of [['天赋', TALENTS], ['精灵', SPIRITS]]) {
  for (const x of Object.values(obj)) {
    if (x.note && x.description.includes(x.note)) errors.push(`[备注外露] ${group} ${x.name}`);
  }
}

// ── 5. 语义分行：多条效果必须含真实换行 ──
const multiline = [
  ['物品 家', ITEMS.facility_home.description],
  ['物品 小麦田地', ITEMS.facility_wheat.description],
  ['物品 水稻田块', ITEMS.facility_rice.description],
  ['天赋 巧手・等级 1', TALENTS.luyouyouSkilled_lv1.description],
  ['天赋 蹁跹・等级 1', TALENTS.luyouyouDancing_lv1.description],
  ['状态 心力交瘁', BUFFS.exhausted.description],
];
for (const [label, text] of multiline) {
  checked++;
  if (!text.includes(NL)) errors.push(`[未分行] ${label}`);
}

// ── 6. InfoPanel 不得另抄写死描述：地形/技能/状态/精灵必须取数据层，且按 \n 渲染 ──
const infoSrc = readFileSync(new URL('../src/ui/InfoPanel.js', import.meta.url), 'utf8');
const infoForbidden = [
  'TERRAIN_DESCRIPTIONS',
  '无地形：可在此放置设施 / 资源 / 技能',
  '草地：10 草元素量，生物可啃食，部分设施产出加成',
  '水面：10 水元素量，不阻碍移动，相邻稻田 +2 稻草',
  '冰面：10 冰元素量，徒步进入会被迫向前滑行（载具不受影响）',
];
for (const s of infoForbidden) {
  checked++;
  if (infoSrc.includes(s)) errors.push(`[InfoPanel 写死文案] ${s}`);
}
const infoNeeds = [
  ["from '../data/terrains.js'", 'InfoPanel 未从 terrains.js 取地形数据'],
  ["from '../data/items.js'", 'InfoPanel 未从 items.js 取词条/显性词条'],
  ["ITEMS[contentId]?.traits", 'InfoPanel 未接显性词条徽章'],
];
for (const [needle, msg] of infoNeeds) {
  checked++;
  if (!infoSrc.includes(needle)) errors.push(`[InfoPanel 数据源缺失] ${msg}`);
}
checked++;
const preLineCount = (infoSrc.match(/whiteSpace: 'pre-line'/g) || []).length;
if (preLineCount < 4) errors.push(`[InfoPanel 未分行] pre-line 仅 ${preLineCount} 处`);
checked++;
const splitCount = (infoSrc.match(/\.split\('\\n'\)/g) || []).length;
if (splitCount < 2) errors.push(`[InfoPanel 未分行] 描述未按 \\n 拆分（仅 ${splitCount} 处）`);

// ── 输出 ──
if (errors.length) {
  console.error(`✗ 文案校验失败：${errors.length} 项\n`);
  for (const e of errors) console.error(e);
  process.exit(1);
}
console.log(`✓ 玩家可见文案逐字校验通过：${checked} 项 100% 一致，备注 0 外露，显性词条 0 混入正文，语义分行正常`);
