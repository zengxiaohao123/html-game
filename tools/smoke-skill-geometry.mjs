// tools/smoke-skill-geometry.mjs
// 阶段 3 冒烟 —— 技能结算接入几何层 + EffectBatch + PendingDeathQueue
// 依据：C:\Users\10436\game\docs\空间碰撞与时序方案.md §2.8 / §3.2 / §3.5 / §3.6 / §12.3
// 覆盖：
//   1) tile 流水线：行/列技能命中跨两格的生物只受一次伤害
//   2) 两格同时命中同一生物：伤害不叠加（EffectBatch 键保证）
//   3) 相邻两格各一只生物：两只都命中
//   4) circle 型范围 = 圆-圆重叠（半径按米，不枚举地块）；row/column/rowColumn/line 仍按地块集合
//   5) target 流水线：最近敌人选择；距离并列按栅栏格下标升序
//   6) 方位判定用生物中心点 x（不是格索引）
//   7) 结算中途死亡：后续分组不再结算、掉落只结算一次、二次 flush 不重复
//   8) SkillSystem 真实触发接线（行/列 + 击杀延迟）
//   9) LinkSkillSystem 真实结算接线（最近索敌 / 燃烧集合 / 元素清空）
//  10) 回合 tick 燃烧致死走死亡队列（遍历期间不删对象）
//  11) judgeMode 全覆盖 20 条、取值合法（target 15 / tile 5），缺失/非法直接抛错
// 用法：node tools/smoke-skill-geometry.mjs

globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
};

import { createInitialState } from '../src/state/gameState.js';
import { SKILLS } from '../src/data/characters.js';
import { CombatSystem } from '../src/systems/CombatSystem.js';
import { CreatureSystem } from '../src/systems/CreatureSystem.js';
import { PendingDeathQueue } from '../src/systems/PendingDeathQueue.js';
import { SkillSystem } from '../src/systems/SkillSystem.js';
import { LinkSkillSystem } from '../src/systems/LinkSkillSystem.js';
import { TurnSystem } from '../src/systems/TurnSystem.js';
import { creatureTileRefs, tileCenter } from '../src/core/Geometry.js';
import {
  judgeModeOf,
  validateSkillJudgeModes,
  createSettlement,
  commitSettlement,
  selectNearestEnemies,
  selectSkillTargets,
  orderByDistance,
  isSourceLeftOfTarget,
  circleTargetsOf,
  lineTileRefs,
  rowColumnTileRefs,
  tileTargetsOf,
  registerDamage,
} from '../src/systems/SkillResolve.js';

let pass = 0, fail = 0;
function check(cond, msg, extra) {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else {
    fail++;
    console.log(`  ❌ ${msg}${extra !== undefined ? `  ← ${JSON.stringify(extra)}` : ''}`);
  }
}
function head(t) { console.log(`\n═══ ${t} ═══`); }

/** 5×5 外圈 + 3×3 栅栏（栅栏内 4 格偏移，坐标口径见 Geometry.js） */
function mkGS({ size = 5, rowCols = 3 } = {}) {
  const gs = createInitialState();
  gs.map.size = size;
  gs.map.fenceRowCols = rowCols;
  gs.map.fence = [];
  for (let r = 0; r < rowCols; r++) {
    for (let c = 0; c < rowCols; c++) {
      gs.map.fence.push({
        row: r, col: c, terrain: 'terrain_none', terrainAmount: 0, creatures: [], items: [],
      });
    }
  }
  const total = 4 * (size - 1);
  gs.map.outerTiles = new Array(total).fill(null).map(() => ({ contentId: null, content: null }));
  gs.creatures = [];
  gs.player.atk = 10;
  gs.player.x = 0;
  gs.skillCooldowns = {};
  return gs;
}

function addCreature(gs, id, x, y, { hp = 100, category = 'danger', radius = 0.25 } = {}) {
  const c = { id, kind: 'chicken', hp, maxHp: hp, category, radius, activeBuffs: [], pos: { x, y } };
  gs.creatures.push(c);
  for (const ref of creatureTileRefs(gs, c)) {
    const t = gs.map.fence[ref.row * gs.map.fenceRowCols + ref.col];
    if (t) t.creatures.push(id);
  }
  return c;
}

/** 确定性伤害：atk × 倍率（规避暴击 / 闪避随机） */
function fakeResolver(calls) {
  return (opts) => {
    const dmg = Math.round((opts.atk || 0) * (opts.skill?.damageMultiplier || 0));
    calls.push({ id: opts.defender.id, dmg, multiplier: opts.skill?.damageMultiplier });
    opts.defender.hp = Math.max(0, opts.defender.hp - dmg);
    return { finalDamage: dmg, dodged: false, immune: false, isCrit: false };
  };
}

// ────────────────────────────────────────────────────────────
head('1. tile 流水线：合纵连横（行+列）跨两格生物只结算一次');

{
  const gs = mkGS();
  const straddler = addCreature(gs, 'creature_10', 3.0, 2.5); // 同时压 (1,1) 与 (1,2)
  const sameRow = addCreature(gs, 'creature_11', 2.5, 2.5);   // 仅 (1,1)
  const otherRow = addCreature(gs, 'creature_12', 2.5, 1.5);  // (0,1)，不在 row 1

  const calls = [];
  const settlement = createSettlement(gs, {
    skillId: 'skill_zongheng', instanceKey: 'tile:14', resolveDamage: fakeResolver(calls),
  });
  const tiles = rowColumnTileRefs(gs, 14); // 外圈 (0,2) → 栅栏 row 1
  check(tiles.length === 3, '外圈格 14（左中）→ 栅栏 row 1 的 3 格', tiles.length);
  check(creatureTileRefs(gs, straddler).length === 2, '构造：跨两格生物确实压住 2 格');

  const targets = tileTargetsOf(settlement, SKILLS.skill_zongheng, tiles);
  check(targets.length === 2, '地块集合取到 2 名目标（跨格生物只出现一次）', targets.map(t => t.id));
  const applied = registerDamage(settlement, targets, { multiplier: 1, element: 'physical', key: 'skill_zongheng' });
  check(applied.length === 2, '登记 2 个伤害意图');

  const { summary, deaths } = commitSettlement(settlement);
  check(summary.damages.length === 2, 'commit 后只有 2 组伤害（跨两格不重复）', summary.damages.length);
  check(calls.filter(c => c.id === straddler.id).length === 1, '跨两格生物只被结算 1 次',
    calls.filter(c => c.id === straddler.id).length);
  check(straddler.hp === 90, '跨两格生物受到 1 次 10 点伤害（100 → 90）', straddler.hp);
  check(sameRow.hp === 90, '同排另一只也命中（100 → 90）', sameRow.hp);
  check(otherRow.hp === 100, '其他排生物未被命中', otherRow.hp);
  check(deaths.empty === true, '无人死亡时 flush 安全返回 empty', deaths.empty);
}

head('2. 两格同时命中同一生物：登记两次也不叠加');

{
  const gs = mkGS();
  const a = addCreature(gs, 'creature_20', 3.0, 2.5); // 压 (1,1)+(1,2)
  const calls = [];
  const settlement = createSettlement(gs, { resolveDamage: fakeResolver(calls) });
  const zone = SKILLS.skill_zongheng;

  const left = tileTargetsOf(settlement, zone, [{ kind: 'fence', row: 1, col: 1 }]);
  const right = tileTargetsOf(settlement, zone, [{ kind: 'fence', row: 1, col: 2 }]);
  check(left.length === 1 && right.length === 1, '两格各查一次都能看到该生物');

  registerDamage(settlement, left, { multiplier: 1, element: 'physical', key: 'zone' });
  registerDamage(settlement, right, { multiplier: 1, element: 'physical', key: 'zone' });
  check(settlement.batch.size === 1, '同实例 + 同 key + 同目标 → 合并为 1 个意图', settlement.batch.size);

  commitSettlement(settlement);
  check(calls.length === 1, '实际只应用 1 次伤害', calls.length);
  check(a.hp === 90, '伤害不叠加（100 → 90）', a.hp);
}

head('3. 相邻两格各一只生物：两只都命中');

{
  const gs = mkGS();
  const a = addCreature(gs, 'creature_30', 2.5, 2.5); // (1,1)
  const b = addCreature(gs, 'creature_31', 3.5, 2.5); // (1,2)
  const calls = [];
  const settlement = createSettlement(gs, { resolveDamage: fakeResolver(calls) });
  const targets = tileTargetsOf(settlement, SKILLS.skill_zongheng, rowColumnTileRefs(gs, 14));
  check(targets.length === 2, 'row 1 上两只相邻生物都在集合内', targets.map(t => t.id));
  registerDamage(settlement, targets, { multiplier: 1, element: 'physical', key: 'row' });
  commitSettlement(settlement);
  check(a.hp === 90 && b.hp === 90, '两只都各受一次伤害', { a: a.hp, b: b.hp });
  check(calls.length === 2, '共 2 次结算', calls.length);
}

head('4. circle 型范围：圆-圆重叠（半径按米，不枚举地块）');

{
  const gs = mkGS();
  const anchor = { x: 2.5, y: 2.5 }; // 锚点 = 生物连续中心（位于 (1,1) 格心）
  // 斜对角格 (2,2)、碰撞圆伸进半径圆 → 命中：dist = √(0.85²+0.85²) ≈ 1.202 ≤ 1 + 0.25
  const diagNear = addCreature(gs, 'creature_20', 3.35, 3.35, { radius: 0.25 });
  // 斜对角格远端、圆完全不接触 → 不命中：dist = √2 ≈ 1.414 > 1.25
  const diagFar = addCreature(gs, 'creature_21', 3.5, 3.5, { radius: 0.25 });
  // 同格邻位 → 命中
  const sameTile = addCreature(gs, 'creature_22', 2.9, 2.5, { radius: 0.25 });
  // 边界取等：dist = 1.25 = 半径 1 + 生物半径 0.25 → 命中（与"重叠"一致）
  const boundaryIn = addCreature(gs, 'creature_23', 3.75, 2.5, { radius: 0.25 });
  // 边界外：dist = 1.3 > 1.25 → 不命中
  const boundaryOut = addCreature(gs, 'creature_24', 3.8, 2.5, { radius: 0.25 });

  const settlement = createSettlement(gs, {});
  const hits = circleTargetsOf(settlement, SKILLS.skill_xiayang_blast_carnival, anchor);
  check(hits.length === 3
    && hits.some(e => e.id === diagNear.id)
    && hits.some(e => e.id === sameTile.id)
    && hits.some(e => e.id === boundaryIn.id),
  '圆心距 ≤ 半径 + 生物半径：斜对角近端 / 同格 / 边界取等都命中', hits.map(h => h.id));
  check(!hits.some(e => e.id === diagFar.id), '斜对角远端、圆完全不接触 → 不命中');
  check(!hits.some(e => e.id === boundaryOut.id), '圆心距恰超阈值 → 不命中');

  const calls = [];
  const s2 = createSettlement(gs, { resolveDamage: fakeResolver(calls) });
  const twice = circleTargetsOf(s2, SKILLS.skill_xiayang_blast_carnival, anchor);
  registerDamage(s2, twice, { multiplier: 1.5, element: 'fire', key: 'blast-a' });
  registerDamage(s2, twice, { multiplier: 1.5, element: 'fire', key: 'blast-a' }); // 同 key 重复登记
  const { summary } = commitSettlement(s2);
  check(summary.damages.length === 3, '同一生物同时压多格 / 重复登记只结算一次', summary.damages.length);
  check(calls.length === 3, '命中数量 3（不因多格重复结算）', calls.length);
  check(calls.every(c => c.dmg === 15), '爆炸狂欢伤害倍率 1.5（atk 10 → 15）', calls.map(c => c.dmg));

  check(lineTileRefs(gs, { x: 1.5, y: 2.5 }, { x: 3.5, y: 2.5 }, 0.5).length === 3,
    'row / column / line 仍按地块集合（线带半宽 0.5 米 → 中线 3 格）');
  check(SKILLS.skill_xiayang_blast_carnival.areaRadius === 1, '爆炸狂欢 areaRadius 数值未改（1 米）');
  check(SKILLS.skill_xiayang_blast_carnival.damageMultiplier === 1.5, '爆炸狂欢伤害倍率未改（150%）');
  check(SKILLS.skill_xiayang_blast_carnival.extraEffect === undefined, 'aoe_radius 死配置已删除');
  check(SKILLS.skill_xiayang_blast_carnival.onBlessedRefreshCooldown === true, '受祝福刷新冷却标志保留');
  check(SKILLS.skill_xiayang_blast_carnival.description.includes('半径 1 米'),
    '玩家可见描述为「半径 1 米」');
  check(SKILLS.skill_xiayang_blast_carnival.description.includes('半径 1 格') === false,
    '玩家可见描述不再出现「半径 1 格」');
}

head('5. target 流水线：最近敌人 + 并列次级排序');

{
  const gs = mkGS();
  const near = addCreature(gs, 'creature_40', 2.6, 2.5);
  const far = addCreature(gs, 'creature_41', 4.5, 4.5);
  const settlement = createSettlement(gs, {});
  const picked = selectNearestEnemies(settlement.snapshot, { x: 2.5, y: 2.5 }, { count: 1 });
  check(picked.length === 1 && picked[0].id === near.id, '最近存活敌人被选中', picked.map(p => p.id));

  const two = selectNearestEnemies(settlement.snapshot, { x: 2.5, y: 2.5 }, { count: 2 });
  check(two.length === 2 && two[0].id === near.id, 'count=2 按距离升序返回', two.map(p => p.id));

  // 并列：两只与锚点等距，栅栏格下标小者优先（row0 col1 = 1 < row2 col1 = 7）
  const gs2 = mkGS();
  const lowIdx = addCreature(gs2, 'creature_42', 2.5, 1.5);
  const highIdx = addCreature(gs2, 'creature_43', 2.5, 3.5);
  const s2 = createSettlement(gs2, {});
  const tie = selectNearestEnemies(s2.snapshot, { x: 2.5, y: 2.5 }, { count: 1 });
  check(tie[0].id === lowIdx.id, '距离并列时按栅栏格下标升序（不是数组顺序）', tie.map(t => t.id));

  const ordered = orderByDistance(s2.snapshot.creatures, { x: 2.5, y: 2.5 }, s2.snapshot);
  check(ordered[0].id === lowIdx.id && ordered[1].id === highIdx.id, 'orderByDistance 稳定排序',
    ordered.map(o => o.id));

  // 技能默认索敌：拼命对 2 名最近
  const gs3 = mkGS();
  const n1 = addCreature(gs3, 'creature_44', 2.5, 2.5, { category: 'danger' });
  const n2 = addCreature(gs3, 'creature_45', 3.5, 2.5, { category: 'extreme' });
  const friendly = addCreature(gs3, 'creature_46', 1.5, 1.5, { category: 'friendly' });
  const s3 = createSettlement(gs3, {});
  const picked3 = selectSkillTargets(s3.snapshot, SKILLS.skill_yumo_desperate, { x: 1.5, y: 2.5 });
  check(picked3.length === 2 && !picked3.some(p => p.id === friendly.id),
    '拼命（danger_extreme）排除友善生物并取 2 名', picked3.map(p => p.id));
  check(picked3[0].id === friendly.id ? false : true, '友善生物不在目标集合中');
  check(n1.hp === 100 && n2.hp === 100 && friendly.hp === 100, '选目标阶段不改动 HP');
}

head('6. 方位判定：用生物中心点 x，不用格索引');

{
  const gs = mkGS();
  const right = addCreature(gs, 'creature_50', 2.9, 2.5); // 同一格 (1,1)，中心偏右
  const left = addCreature(gs, 'creature_51', 2.3, 2.5);  // 同一格 (1,1)，中心偏左
  check(creatureTileRefs(gs, right)[0].row === creatureTileRefs(gs, left)[0].row, '构造：两者同一行');
  check(creatureTileRefs(gs, right)[0].col === creatureTileRefs(gs, left)[0].col, '构造：两者同一格（格索引相同）');
  check(isSourceLeftOfTarget(left, right) === true, '左侧来源：中心 x 更小 → true（格索引判不出）');
  check(isSourceLeftOfTarget(right, left) === false, '右侧来源 → false');
  // 快照条目同样按中心点判定
  const s = createSettlement(gs, {});
  const l = s.snapshot.creatures.find(c => c.id === left.id);
  const r = s.snapshot.creatures.find(c => c.id === right.id);
  check(isSourceLeftOfTarget(l, r) === true, '快照条目同样按中心点 x 判定');
}

head('7. 死亡延迟：中途死亡不进后续分组结算、掉落只结算一次');

{
  const gs = mkGS();
  const dying = addCreature(gs, 'creature_60', 2.5, 2.5, { hp: 5 });
  const other = addCreature(gs, 'creature_61', 3.0, 2.5, { hp: 100 });
  let drops = 0;
  const deathQueue = new PendingDeathQueue(gs, {
    grantKillDrops: () => { drops += 1; },
    fireDefeatedHook: () => {},
    onTalentDefeated: () => {},
  });
  const calls = [];
  const settlement = createSettlement(gs, { deathQueue, resolveDamage: fakeResolver(calls) });

  registerDamage(settlement, [dying], { multiplier: 1, element: 'physical', key: 'group-1' });
  registerDamage(settlement, [dying], { multiplier: 1, element: 'physical', key: 'group-2' });
  registerDamage(settlement, [other], { multiplier: 1, element: 'physical', key: 'group-1' });
  check(settlement.batch.size === 3, '3 组意图（同目标不同 key 独立登记）', settlement.batch.size);

  const { summary, deaths } = commitSettlement(settlement);
  check(summary.damages.length === 3, '摘要保留 3 组登记');
  check(calls.filter(c => c.id === dying.id).length === 1, 'group-2 被跳过：已死目标不再结算',
    calls.filter(c => c.id === dying.id).length);
  check(dying.dead === true && dying.hp === 0, '中途死亡目标被标记 dead 且 hp 归零');
  check(other.hp === 90, '同批次其他目标正常结算', other.hp);
  check(deaths.defeated.length === 1 && deaths.defeated[0].id === dying.id, '批次末 flush 恰好 1 只死亡',
    deaths.defeated);
  check(gs.creatures.length === 1 && gs.creatures[0].id === other.id, '死亡实例在 flush 后才从 gs.creatures 移除');
  check(gs.map.fence[1 * 3 + 1].creatures.includes(dying.id) === false, '栅栏格缓存同步移除');
  check(drops === 1, '击杀掉落只结算 1 次', drops);

  deathQueue.flush();
  check(drops === 1, '重复 flush 不再掉落（已移除实例只跳过）', drops);

  // 已死实例在后续登记的伤害组中直接跳过
  const calls2 = [];
  const s2 = createSettlement(gs, { resolveDamage: fakeResolver(calls2) });
  const skipped = registerDamage(s2, [{ id: dying.id }], { multiplier: 1, element: 'physical' });
  check(skipped.length === 0, '已移除实例不再被登记', skipped.length);
}

head('8. SkillSystem 真实触发接线（合纵连横 + 击杀延迟 + 跨格去重）');

{
  const gs = mkGS();
  gs.map.outerTiles[14] = { contentId: 'skill_zongheng' };
  const straddler = addCreature(gs, 'creature_70', 3.0, 2.5, { hp: 100 });
  const victim = addCreature(gs, 'creature_71', 2.5, 2.5, { hp: 5 });
  let drops = 0;
  const origCalc = CombatSystem.calculateDamage;
  const origGrant = CreatureSystem.grantKillDrops;
  CombatSystem.calculateDamage = fakeResolver([]);
  CreatureSystem.grantKillDrops = () => { drops += 1; };
  try {
    SkillSystem.triggerSkillByHook('onEnter', { gs, tileIdx: 14 });
    check(straddler.hp === 90, '跨两格生物只受一次伤害（100 → 90）', straddler.hp);
    check(victim.dead === true, 'HP 归零目标被标记死亡（批次末统一处理）');
    check(gs.creatures.length === 1 && gs.creatures[0].id === straddler.id, '击杀后从 gs.creatures 移除',
      gs.creatures.map(c => c.id));
    check(drops === 1, '真实触发路径掉落只结算 1 次', drops);
    check(gs.skillCooldowns.skill_zongheng === undefined, 'cooldown 0 的技能不写冷却');
  } finally {
    CombatSystem.calculateDamage = origCalc;
    CreatureSystem.grantKillDrops = origGrant;
  }
}

head('9. LinkSkillSystem 真实结算接线');

{
  const gs = mkGS();
  const near = addCreature(gs, 'creature_80', 1.5, 1.5, { hp: 100 });
  const far = addCreature(gs, 'creature_81', 4.5, 4.5, { hp: 100 });
  const origCalc = CombatSystem.calculateDamage;
  const origBuff = CombatSystem.applyBuff;
  const buffs = [];
  CombatSystem.calculateDamage = fakeResolver([]);
  CombatSystem.applyBuff = (o) => { buffs.push(o); };
  try {
    // 弱点击破：无蓄力 → 最近 1 名（near），远者不受影响
    LinkSkillSystem.resolveLinkSkill(gs, SKILLS.skill_link_luyouyou_weak_point, { tileIdx: 14 });
    check(near.hp === 93, '弱点击破（70%）命中最近敌人（100 → 93）', near.hp);
    check(far.hp === 100, '远者未被命中', far.hp);
    check(buffs.some(b => b.buffId === 'weakened' && b.target.id === near.id),
      '虚弱 buff 经批次登记应用到同一目标', buffs.map(b => b.buffId + ':' + b.target.id));
  } finally {
    CombatSystem.calculateDamage = origCalc;
    CombatSystem.applyBuff = origBuff;
  }
}

{
  const gs = mkGS();
  const unburned = addCreature(gs, 'creature_82', 1.5, 1.5, { hp: 100 });
  const burned = addCreature(gs, 'creature_83', 4.5, 4.5, { hp: 100, category: 'extreme' });
  burned.activeBuffs = [{ id: 'burn', remainingTurns: 1, params: {} }];
  const origCalc = CombatSystem.calculateDamage;
  CombatSystem.calculateDamage = fakeResolver([]);
  try {
    const res = LinkSkillSystem.resolveLinkSkill(gs, SKILLS.skill_link_xiayang_scorch, { tileIdx: 14 });
    check(res.hitCount === 1, '炽燃：燃烧集合内命中 1 名（不回退打非燃烧怪）', res.hitCount);
    check(burned.hp === 93, '被燃烧者受伤（70% → 93）', burned.hp);
    check(unburned.hp === 100, '未燃烧的最近敌人未被命中', unburned.hp);
    check(res.deaths.length === 0, '无人死亡');
  } finally {
    CombatSystem.calculateDamage = origCalc;
  }
}

{
  const gs = mkGS();
  const only = addCreature(gs, 'creature_84', 1.5, 1.5, { hp: 100 });
  const origCalc = CombatSystem.calculateDamage;
  CombatSystem.calculateDamage = fakeResolver([]);
  try {
    const res = LinkSkillSystem.resolveLinkSkill(gs, SKILLS.skill_link_luyouyou_storm_eye, { tileIdx: 14 });
    check(only.hp === 92, '风暴眼线带命中唯一目标（80% → 92）', only.hp);
    check(res.judgeMode === 'tile', '风暴眼按 tile 型（线带）结算', res.judgeMode);
  } finally {
    CombatSystem.calculateDamage = origCalc;
  }
}

head('10. 回合 tick 燃烧致死：遍历期间不删对象、掉落一次');

{
  const gs = mkGS();
  const doomed = addCreature(gs, 'creature_90', 2.5, 2.5, { hp: 1 });
  const survivor = addCreature(gs, 'creature_91', 2.5, 3.5, { hp: 100 });
  gs.player.stamina = 10;
  let drops = 0;
  const origTick = CombatSystem.tickBuffsOnTarget;
  const origGrant = CreatureSystem.grantKillDrops;
  CombatSystem.tickBuffsOnTarget = (c) => { if (c.id === doomed.id) c.hp = 0; };
  CreatureSystem.grantKillDrops = () => { drops += 1; };
  try {
    TurnSystem.advanceTurn(gs, 1);
    check(gs.creatures.length === 1 && !gs.creatures.some(c => c.id === doomed.id),
      '燃烧致死实例在 tick 末统一移除', gs.creatures.map(c => c.id));
    check(survivor.hp === 100, '同回合其他生物未被误删');
    check(drops === 1, '燃烧致死掉落只结算 1 次', drops);
    TurnSystem.advanceTurn(gs, 1);
    check(drops === 1, '再次推进回合不重复掉落', drops);
  } finally {
    CombatSystem.tickBuffsOnTarget = origTick;
    CreatureSystem.grantKillDrops = origGrant;
  }
}

head('11. judgeMode 覆盖与合法性');

{
  const report = validateSkillJudgeModes();
  check(report.total === 20, '技能总数 20', report.total);
  check(report.tile === 5, 'tile 型 5 条（开拓/爆炸狂欢/合纵连横/焚灭/风暴眼）', report.tile);
  check(report.target === 15, 'target 型 15 条', report.target);
  check(report.issues.length === 0, '无缺失 / 非法 judgeMode', report.issues);

  const illegal = [
    { id: 'x1', judgeMode: 'aoe', damageMultiplier: 1 },
    { id: 'x2', damageMultiplier: 1 },
    { id: 'x3', judgeMode: 'tile', anchor: 'nope', areaShape: 'circle', areaRadius: 1 },
    { id: 'x4', judgeMode: 'tile', anchor: 'target', areaShape: 'circle' },
  ];
  for (const s of illegal) {
    let threw = false;
    try { judgeModeOf(s); } catch { threw = true; }
    check(threw, `非法定义直接抛错：${s.id}`, s);
  }

  const tileIds = Object.values(SKILLS).filter(s => s.judgeMode === 'tile').map(s => s.id).sort();
  const expectTile = [
    'skill_link_luyouyou_storm_eye',
    'skill_link_xiayang_annihilate',
    'skill_xiayang_blast_carnival',
    'skill_yumo_pioneer',
    'skill_zongheng',
  ].sort();
  check(JSON.stringify(tileIds) === JSON.stringify(expectTile), 'tile 型名单与文档 §2.8 一致', tileIds);
}

console.log(`\n────────────────────────`);
console.log(`通过 ${pass} 条，失败 ${fail} 条`);
if (fail > 0) process.exit(1);
