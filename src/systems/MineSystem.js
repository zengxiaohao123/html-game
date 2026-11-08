// src/systems/MineSystem.js
// 【土豆地雷】场上实体（魔导书《土豆地雷 · 土豆》）
//
// 口径（写入设计文档 §20.3）：
//   · 位置：埋设在栅栏内的任意一点（随机点，圆心距栅栏边 ≥ 碰撞半径）；
//     以 (x, y) 连续坐标 + radius 参与既有「圆-圆重叠」几何体系，不新建第二套碰撞；
//   · 计时：埋下时 turnsLeft = 5，每次【每回合开始时】减 1；归 0 后探出头（surfaced），
//     探出前不可被踩爆；
//   · 触发：任意**敌对**生物（圆）与地雷（圆）重叠即爆炸；我方角色 / 友善生物踩上去不触发，
//     也不吃爆炸伤害（阵营判定统一走 data/factions.js，不另建一套）；
//   · 爆炸范围：以地雷圆心为心、半径 1 米（= 1 格）的圆，与生物圆重叠的**敌对**生物全部命中；
//   · 伤害：薯道难 → 土豆储存总数量；否则 → 埋雷来源田块当前储存数量；火元素、固定数值，
//     不走暴击 / 闪避 / 天赋加成（保证「伤害量 = 土豆数量」字面成立），但尊重元素免疫；
//     受击方【易伤】照常生效（受击方属性，与攻击者无关；同名取最高，最后统一 floor）；
//   · 晕眩：命中者附加【晕眩】1 回合（内部 remainingTurns=2，跨过一次回合结算后解除）；
//   · 触发后地雷消耗；场上至多同时存在 5 个。

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { devLog } from '../core/Logger.js';
import { fenceRect, circleCenterDistance } from '../core/Geometry.js';
import { FACTION, factionOf, isHostileTo } from '../data/factions.js';
import { CombatSystem } from './CombatSystem.js';
import { PendingDeathQueue } from './PendingDeathQueue.js';
import { PotatoSystem } from './PotatoSystem.js';

export const MAX_MINES = 5;
export const MINE_SURFACE_TURNS = 5;
export const MINE_RADIUS = 0.35;      // 米（碰撞与视觉半径）
export const MINE_BLAST_RADIUS = 1;   // 米（「小范围」= 半径 1 格）

/** 是否敌对生物（危险 / 高危）；友善生物与我方实体一律不算 */
const isEnemy = (c) => !!c && isHostileTo(FACTION.PARTY, factionOf(c));

export function countMines(gs) {
  return Array.isArray(gs?.mines) ? gs.mines.length : 0;
}

/** 存档迁移 / 运行期兜底：补全地雷实体字段（不改变已有数值） */
export function ensureMines(gs) {
  if (!Array.isArray(gs.mines)) gs.mines = [];
  if (typeof gs.minesNextId !== 'number' || !Number.isFinite(gs.minesNextId)) {
    gs.minesNextId = 1;
  }
  for (const m of gs.mines) {
    if (!m || typeof m !== 'object') continue;
    if (typeof m.radius !== 'number' || m.radius <= 0) m.radius = MINE_RADIUS;
    if (typeof m.x !== 'number' || !Number.isFinite(m.x)) m.x = 1.5;
    if (typeof m.y !== 'number' || !Number.isFinite(m.y)) m.y = 1.5;
    if (typeof m.turnsLeft !== 'number' || !Number.isFinite(m.turnsLeft)) m.turnsLeft = MINE_SURFACE_TURNS;
    if (typeof m.surfaced !== 'boolean') m.surfaced = m.turnsLeft <= 0;
    if (typeof m.sourceTileIdx !== 'number') m.sourceTileIdx = null;
    if (!m.id) m.id = `mine_${gs.minesNextId++}`;
  }
}

function randomPointInFence(gs, radius) {
  const rect = fenceRect(gs);
  const mx = Math.min(Math.max((rect.x1 - rect.x0) / 2, 0), radius);
  const my = Math.min(Math.max((rect.y1 - rect.y0) / 2, 0), radius);
  const x = rect.x0 + mx + Math.random() * Math.max(0, rect.x1 - rect.x0 - 2 * mx);
  const y = rect.y0 + my + Math.random() * Math.max(0, rect.y1 - rect.y0 - 2 * my);
  return { x, y };
}

/**
 * 在栅栏内埋下 1 个地雷
 * @param {object} gs
 * @param {number|null} sourceTileIdx 埋雷来源土豆田块
 * @returns {object|null} 新地雷；场上已满 5 个时返回 null
 */
export function plantMine(gs, sourceTileIdx) {
  ensureMines(gs);
  if (countMines(gs) >= MAX_MINES) return null;
  const pos = randomPointInFence(gs, MINE_RADIUS);
  const mine = {
    id: `mine_${gs.minesNextId++}`,
    sourceTileIdx: typeof sourceTileIdx === 'number' ? sourceTileIdx : null,
    x: pos.x,
    y: pos.y,
    radius: MINE_RADIUS,
    blastRadius: MINE_BLAST_RADIUS,
    turnsLeft: MINE_SURFACE_TURNS,
    surfaced: false,
  };
  gs.mines.push(mine);
  devLog.info('[MineSystem] 埋下地雷', mine.id, '来源格', sourceTileIdx, 'x/y', mine.x.toFixed(2), mine.y.toFixed(2));
  return mine;
}

/** 【每回合开始时】：倒计时，归 0 后探出头 */
export function tickMines(gs) {
  if (!Array.isArray(gs?.mines) || gs.mines.length === 0) return [];
  const surfacedNow = [];
  for (const m of gs.mines) {
    if (m.turnsLeft > 0) m.turnsLeft -= 1;
    if (m.turnsLeft <= 0) {
      m.turnsLeft = 0;
      if (!m.surfaced) {
        m.surfaced = true;
        surfacedNow.push(m);
      }
    }
  }
  if (surfacedNow.length > 0) {
    EventBus.emit(GE.TOAST_SHOW, { text: `💣 ${surfacedNow.length} 个土豆地雷探出头来`, duration: 1800 });
  }
  return surfacedNow;
}

/**
 * 实时步进：探出头的雷与敌人重叠即爆炸（由 RealtimeClock.onStep 调用）
 * @returns {number} 本步爆炸数量
 */
export function stepMineCollisions(gs) {
  if (!Array.isArray(gs?.mines) || gs.mines.length === 0) return 0;
  const enemies = (gs.creatures || []).filter(
    (c) => c && c.hp > 0 && !c.housed && isEnemy(c) && c.pos,
  );
  if (enemies.length === 0) return 0;

  let exploded = 0;
  for (const mine of [...gs.mines]) {
    if (!mine.surfaced) continue;
    const hit = enemies.some(
      (c) => circleCenterDistance(c.pos, { x: mine.x, y: mine.y }) <= (c.radius || 0.25) + mine.radius,
    );
    if (!hit) continue;
    explodeMine(gs, mine);
    exploded += 1;
    // 同一时刻只结算一次爆炸；其余雷在下一逻辑步继续判定
    break;
  }
  return exploded;
}

/** 爆炸：范围伤害 + 【晕眩】1 回合，然后消耗地雷 */
export function explodeMine(gs, mine) {
  const center = { x: mine.x, y: mine.y };
  const blast = typeof mine.blastRadius === 'number' ? mine.blastRadius : MINE_BLAST_RADIUS;
  const baseDamage = PotatoSystem.potatoMineDamage(gs, mine.sourceTileIdx);

  const enemies = (gs.creatures || []).filter(
    (c) => c && c.hp > 0 && !c.housed && isEnemy(c) && c.pos,
  );
  const affected = enemies.filter(
    (c) => circleCenterDistance(c.pos, center) <= (c.radius || 0.25) + blast,
  );

  const deaths = new PendingDeathQueue(gs);
  let maxApplied = 0;
  for (const c of affected) {
    const immune = CombatSystem.elementImmuneCheck(c, 'fire');
    // 易伤是受击方属性：地雷伤害同样生效；同名取最高，最后统一 floor
    const damage = Math.floor(baseDamage * CombatSystem.vulnerableMultiplier(c));
    if (!immune && damage > 0) {
      const before = c.hp;
      c.hp = Math.max(0, c.hp - damage);
      if (before - c.hp > maxApplied) maxApplied = before - c.hp;
      EventBus.emit(GE.DAMAGE_DEALT, {
        targetRef: { type: 'creature', creatureId: c.id },
        damage: before - c.hp,
        element: 'fire',
        isReal: false,
      });
    } else if (immune) {
      EventBus.emit(GE.TOAST_SHOW, { text: `🔥 ${c.name || c.kind} 免疫火元素伤害`, duration: 1500 });
    }

    // 晕眩与伤害独立：即使免疫火伤也会被震晕
    CombatSystem.applyBuff({
      buffId: 'stunned',
      target: c,
      duration: 2,
      params: { displayTurns: 1 },
    });

    if (c.hp <= 0) deaths.markDead(c);
  }
  deaths.flush();

  gs.mines = (gs.mines || []).filter((m) => m && m.id !== mine.id);

  EventBus.emit(GE.TOAST_SHOW, {
    text: affected.length > 0
      ? `💥 土豆地雷爆炸！${affected.length} 个敌人受到 ${maxApplied} 点火焰伤害并【晕眩】1 回合`
      : `💥 土豆地雷爆炸！（范围内没有敌人）`,
    duration: 2200,
  });
  devLog.info('[MineSystem] 爆炸', mine.id, '基础伤害', baseDamage, '命中', affected.length);
  return { damage: baseDamage, maxApplied, hit: affected.map((c) => c.id) };
}

export const MineSystem = {
  MAX_MINES,
  MINE_SURFACE_TURNS,
  MINE_RADIUS,
  MINE_BLAST_RADIUS,
  countMines,
  ensureMines,
  plantMine,
  tickMines,
  stepMineCollisions,
  explodeMine,
};

export default MineSystem;
