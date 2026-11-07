// tools/smoke-faction.mjs
// 阵营合法性冒烟（设计文档 §九 阵营合法性与目标选择）
// 覆盖：
//   1) factionOf / isHostileTo 关系矩阵（party → hostile；friendly 不打人；hostile → party）
//   2) 默认索敌第一层就是阵营过滤：最近的友善生物不会被选中
//   3) tile / circle 流水线同样不命中友善生物
//   4) 我方角色共用一个实体：不进快照、不会被自己的技能打死
//   5) 自身技能（鼓舞 / 屏息瞄准）在没有敌人时也能触发（self 目标修复）
//   6) 8 条连携技逐条不命中友善生物
//   7) 定时条件扫描（炽燃 / 弱点击破）不因友善生物身上的状态入队
//   8) 【不分敌我】当前技能库 0 条；ignoreFaction 通路可放行（未来词条）
//   9) 感恩节的晚餐（friendlyAsEnemyToday）既有例外保留
//  10) 生物数据表没有任何攻击型技能（当前无生物攻击技能生效）
// 用法：node tools/smoke-faction.mjs

globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
};

import { createInitialState } from '../src/state/gameState.js';
import { SKILLS } from '../src/data/characters.js';
import { CREATURES } from '../src/data/creatures.js';
import { FACTION, factionOf, isHostileTo } from '../src/data/factions.js';
import { creatureTileRefs } from '../src/core/Geometry.js';
import { SkillSystem } from '../src/systems/SkillSystem.js';
import { LinkSkillSystem } from '../src/systems/LinkSkillSystem.js';
import {
  createSettlement,
  enemyPool,
  selectNearestEnemies,
  selectSkillTargets,
  circleTargetsOf,
  tileTargetsOf,
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
  gs.flags = {};
  gs.team.groups[0].roles = ['yumo', 'xiayang', 'luyouyou'];
  return gs;
}

function addCreature(gs, id, x, y, { hp = 1000, category = 'danger', radius = 0.25, buffs = [] } = {}) {
  const c = {
    id, kind: 'chicken', hp, maxHp: hp, category, radius,
    activeBuffs: buffs.map(b => ({ id: b })), pos: { x, y },
  };
  gs.creatures.push(c);
  for (const ref of creatureTileRefs(gs, c)) {
    const t = gs.map.fence[ref.row * gs.map.fenceRowCols + ref.col];
    if (t) t.creatures.push(id);
  }
  return c;
}

function placeSkill(gs, tileIdx, skillId) {
  gs.map.outerTiles[tileIdx].contentId = skillId;
}

// ────────────────────────────────────────────────────────────
head('1. 阵营关系矩阵');
{
  const gs = mkGS();
  check(gs.player.faction === FACTION.PARTY && factionOf(gs.player) === FACTION.PARTY,
    '我方共用实体 gs.player 显式标记为 party', gs.player.faction);
  check(factionOf({ category: 'friendly' }) === FACTION.FRIENDLY, '友善生物 → friendly');
  check(factionOf({ category: 'danger' }) === FACTION.HOSTILE, '危险生物 → hostile');
  check(factionOf({ category: 'extreme' }) === FACTION.HOSTILE, '高危生物 → hostile');
  check(factionOf({}) === FACTION.HOSTILE, '未声明分类的生物默认按敌对（漏过滤更危险）');

  check(isHostileTo('party', 'hostile') === true, '我方 → 危险 / 高危：可攻击');
  check(isHostileTo('party', 'friendly') === false, '我方 → 友善：不可攻击');
  check(isHostileTo('party', 'party') === false, '我方 → 我方：不可攻击（不会打自己人）');
  check(isHostileTo('hostile', 'party') === true, '危险 / 高危 → 我方：可攻击');
  check(isHostileTo('hostile', 'friendly') === false, '危险 / 高危 → 友善：不可攻击');
  check(isHostileTo('friendly', 'party') === false && isHostileTo('friendly', 'hostile') === false,
    '友善生物不攻击任何人（不主动攻击、不追人）');
}

// ────────────────────────────────────────────────────────────
head('2. 默认索敌：阵营过滤先于距离');
{
  const gs = mkGS();
  const friendly = addCreature(gs, 'chick1', 1.5, 1.5, { category: 'friendly' });
  const danger = addCreature(gs, 'slime1', 2.5, 1.5, { category: 'danger' });
  const snapshot = createSettlement(gs, {}).snapshot;

  const pool = enemyPool(snapshot);
  check(pool.length === 1 && pool[0].id === danger.id,
    'enemyPool 默认池只有危险生物（友善被排除）', pool.map(e => e.id));

  const nearest = selectNearestEnemies(snapshot, { x: 1.5, y: 1.5 }, { count: 1 });
  check(nearest.length === 1 && nearest[0].id === danger.id,
    '最近的友善生物不会被"最近敌人"误选（先过滤再排序）', nearest.map(e => e.id));

  const declared = selectSkillTargets(snapshot, SKILLS.skill_yumo_slash, { x: 1.5, y: 1.5 });
  check(declared.length === 1 && declared[0].id === danger.id,
    '主动技能 selectSkillTargets 只返回危险生物', declared.map(e => e.id));

  check(friendly.hp === 1000, '友善生物未被选中（血量不变）');
}

// ────────────────────────────────────────────────────────────
head('3. tile / circle 流水线不命中友善生物');
{
  const gs = mkGS();
  const friendly = addCreature(gs, 'chick1', 2.5, 2.6, { category: 'friendly' });
  const danger = addCreature(gs, 'slime1', 2.5, 2.0, { category: 'danger' });
  placeSkill(gs, 0, 'skill_xiayang_blast_carnival');

  // 爆炸狂欢：tile 型，锚点 = 主目标中心，半径 1 米 —— 友善生物几何上在圈内
  SkillSystem.triggerSkillByHook('onEnter', { gs, tileIdx: 0 });
  check(friendly.hp === 1000, '圆形范围覆盖到友善生物也不命中（阵营白名单求交）', friendly.hp);
  check(danger.hp < 1000, '危险生物正常受到伤害', danger.hp);

  const snapshot = createSettlement(gs, {}).snapshot;
  const circleHits = circleTargetsOf(createSettlement(gs, {}), SKILLS.skill_xiayang_blast_carnival, { x: 2.5, y: 2.0 });
  check(!circleHits.some(e => e.id === friendly.id) && circleHits.some(e => e.id === danger.id),
    'circleTargetsOf 只返回阵营合法目标', circleHits.map(e => e.id));
  check(snapshot.creatures.length === 2, '快照仍包含全部生物（过滤发生在目标池，不篡改几何）');
}

// ────────────────────────────────────────────────────────────
head('4. 我方角色共用一个实体：不进快照、不会被自己的技能打死');
{
  const gs = mkGS();
  addCreature(gs, 'slime1', 0.6, 0.6, { category: 'danger' });
  const snapshot = createSettlement(gs, {}).snapshot;
  check(snapshot.creatures.every(e => e.id !== 'player'), '快照只含生物，不含我方共用实体');

  placeSkill(gs, 0, 'skill_xiayang_blast_carnival'); // 玩家在 0 号格
  SkillSystem.triggerSkillByHook('onEnter', { gs, tileIdx: 0 });
  check(gs.player.hp === 100, '我方站在技能格上也不会被自己的技能打死', gs.player.hp);
}

// ────────────────────────────────────────────────────────────
head('5. 自身技能：没有敌人也能触发（self 目标修复）');
{
  const gs = mkGS();
  placeSkill(gs, 0, 'skill_xiayang_inspire_lv1');
  SkillSystem.triggerSkillByHook('onEnter', { gs, tileIdx: 0 });
  check(gs.player.atk === 25, '鼓舞 onEnter 无敌人也触发（攻击力 10 → 25）', gs.player.atk);

  const gs2 = mkGS();
  placeSkill(gs2, 1, 'skill_luyouyou_breathe_aim');
  SkillSystem.triggerSkillByHook('onEnter', { gs: gs2, tileIdx: 1 });
  check(gs2.team.luyouyouNextCritBonus === 1, '屏息瞄准无敌人也触发（下次暴击 +100%）',
    gs2.team.luyouyouNextCritBonus);

  const gs3 = mkGS();
  placeSkill(gs3, 0, 'skill_yumo_slash');
  SkillSystem.triggerSkillByHook('onEnter', { gs: gs3, tileIdx: 0 });
  check(!gs3.skillCooldowns.skill_skill_yumo_slash, '敌方技能无合法目标仍不触发（不空放冷却）');
}

// ────────────────────────────────────────────────────────────
head('6. 8 条连携技逐条不命中友善生物');
{
  const cases = [
    ['skill_link_yumo_drain', {}],
    ['skill_link_xiayang_scorch', { buffsBoth: 'burn' }],
    ['skill_link_xiayang_annihilate', { targetCreatureId: 'chick1' }],
    ['skill_link_luyouyou_weak_point', { buffsBoth: 'charge' }],
    ['skill_link_luyouyou_storm_eye', {}],
    ['skill_link_luyouyou_hunt', { targetCreatureId: 'chick1' }],
    ['skill_link_luyouyou_rise_wind', { targetCreatureId: 'chick1' }],
    ['skill_link_shift', {}],
  ];
  for (const [skillId, opts] of cases) {
    const gs = mkGS();
    const friendly = addCreature(gs, 'chick1', 1.5, 1.5, {
      category: 'friendly', buffs: opts.buffsBoth ? [opts.buffsBoth] : [],
    });
    const danger = addCreature(gs, 'slime1', 2.5, 1.5, {
      category: 'danger', buffs: opts.buffsBoth ? [opts.buffsBoth] : [],
    });
    const ctx = { tileIdx: 0, instanceKey: `0|${skillId}` };
    if (opts.targetCreatureId) ctx.targetCreatureId = opts.targetCreatureId;
    if (skillId === 'skill_link_yumo_drain') ctx.element = 'fire';

    LinkSkillSystem.resolveLinkSkill(gs, SKILLS[skillId], ctx);
    const skill = SKILLS[skillId];
    if (skillId === 'skill_link_yumo_drain') {
      check(friendly.hp === 1000 && danger.hp === 1000, `${skill.name}：无伤害，双方血量不变`);
    } else {
      check(friendly.hp === 1000, `${skill.name}：友善生物不掉血`, friendly.hp);
      check(danger.hp < 1000, `${skill.name}：危险生物正常受伤`, danger.hp);
    }
  }
}

// ────────────────────────────────────────────────────────────
head('7. 定时条件扫描：友善生物身上的状态不入队');
{
  const gs = mkGS();
  placeSkill(gs, 2, 'skill_link_xiayang_scorch');
  addCreature(gs, 'chick1', 1.5, 1.5, { category: 'friendly', buffs: ['burn'] });
  LinkSkillSystem.periodicConditionScan(gs);
  check(gs.linkSkillQueue.length === 0, '只有友善生物燃烧 → 炽燃不入队');

  addCreature(gs, 'slime1', 2.5, 1.5, { category: 'danger', buffs: ['burn'] });
  LinkSkillSystem.periodicConditionScan(gs);
  check(gs.linkSkillQueue.some(e => e.key === '2|skill_link_xiayang_scorch'),
    '危险生物燃烧 → 炽燃正常入队');

  const gs2 = mkGS();
  placeSkill(gs2, 3, 'skill_link_luyouyou_weak_point');
  addCreature(gs2, 'chick2', 1.5, 1.5, { category: 'friendly', buffs: ['charge'] });
  LinkSkillSystem.periodicConditionScan(gs2);
  check(gs2.linkSkillQueue.length === 0, '只有友善生物蓄力 → 弱点击破不入队');
}

// ────────────────────────────────────────────────────────────
head('8. 【不分敌我】词条：当前 0 条，通路可放行');
{
  const gs = mkGS();
  addCreature(gs, 'chick1', 1.5, 1.5, { category: 'friendly' });
  const snapshot = createSettlement(gs, {}).snapshot;

  const count = Object.values(SKILLS).filter(s => s.ignoreFaction === true).length;
  check(count === 0, '当前技能库【不分敌我】技能数 = 0', count);
  check(enemyPool(snapshot).length === 0, '默认池不含友善生物');
  check(enemyPool(snapshot, { ignoreFaction: true }).length === 1,
    'ignoreFaction = true 时放行友善生物（未来词条通路）');
}

// ────────────────────────────────────────────────────────────
head('9. 感恩节的晚餐：友善生物当日视同敌人（既有例外保留）');
{
  const gs = mkGS();
  addCreature(gs, 'chick1', 1.5, 1.5, { category: 'friendly' });
  gs.flags.friendlyAsEnemyToday = true;
  const snapshot = createSettlement(gs, {}).snapshot;
  check(snapshot.creatures.length === 1 && enemyPool(snapshot, {
    friendlyAsEnemyToday: createSettlement(gs, {}).friendlyAsEnemyToday,
  }).length === 1, 'friendlyAsEnemyToday 当日友善生物进入合法目标池');
}

// ────────────────────────────────────────────────────────────
head('10. 生物攻击型技能核对：当前没有任何生物攻击型技能生效');
{
  const defs = Object.values(CREATURES);
  check(defs.every(d => !Array.isArray(d.skills) && !d.attackSkill && !d.attack),
    '生物数据表没有 skills / attackSkill / attack 字段（无攻击型技能）');
  check(defs.filter(d => d.category === 'friendly').every(d => d.atk === 0),
    '友善生物攻击力全部为 0（不攻击）');

  const gs = mkGS();
  addCreature(gs, 'slime1', 1.5, 1.5, { category: 'danger' });
  const snapshot = createSettlement(gs, {}).snapshot;
  check(enemyPool(snapshot, { attackerFaction: FACTION.HOSTILE }).length === 0,
    '以危险生物为攻击方时目标池为空（我方不在生物快照内；无生物攻击结算入口）');
}

console.log(`\n──────────────────────────────────────────`);
console.log(`阵营合法性冒烟：${pass} 通过 / ${fail} 失败（共 ${pass + fail} 条）`);
if (fail > 0) process.exitCode = 1;
