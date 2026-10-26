// src/systems/CreatureSystem.js
// Phase 3 —— 生物系统
//   spawnCreature(kind)    —— 生成 1 只，放入 fence 空位；处理容量；emit
//   tickAllCreatures(gs)  —— 每 2 秒随机方向走 1 格（requestAnimationFrame / 定时）
//   feedCreature(gs, creatureId) —— 投喂逻辑（简化）
//   dailyTick(gs)         —— DaySystem.startNewDay 末尾调用：饥饿检测、成长、心情、产蛋、容量警告
//   startRealtimeLoop(gs) / stopRealtimeLoop() —— requestAnimationFrame 驱动 tick
//
// 容量 & 超载惩罚：
//   友善超载 → 2 天后 友善类收益归 0（wheat/rice/strawberry/pea/henhouse 产蛋）
//   危险超载 → 2 天后 每日开始 扣玩家真实伤害 10%

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { devLog } from '../core/Logger.js';
import { Random } from '../core/Random.js';
import { getCreatureDef, SLIME_KINDS } from '../data/creatures.js';
import { InventorySystem } from './InventorySystem.js';
import { CombatSystem } from './CombatSystem.js';

// ── 生物计数器（每次 spawn 都给唯一 id） ──
let _nextCreatureId = 1;
export function resetCreatureIdCounter() { _nextCreatureId = 1; }

// ── 实时 tick 计时 ──
// 每 2 秒所有生物走 1 格
const TICK_INTERVAL_MS = 2000;
let _realtimeTimerId = null;
let _lastTickMs = 0;
let _tickRafId = null;

/**
 * 生成 1 只生物
 * @param {object} gs
 * @param {string} kind          creatures.js 里定义的 kind：'chick' / 'slime_fire' 等
 * @param {object} [opts]
 * @param {string} [opts.facilityId] 来源设施（facility_henhouse / facility_slimehouse），用于每日心情 +1
 * @returns {object|null} 新生物对象；无空位或 kind 未知 → null
 */
export function spawnCreature(gs, kind, opts = {}) {
  const def = getCreatureDef(kind);
  if (!def) {
    devLog.warn('[CreatureSystem.spawnCreature] unknown kind:', kind);
    return null;
  }

  // 找 fence 空位
  const empty = findEmptyFenceTile(gs);
  if (!empty) {
    devLog.warn('[CreatureSystem.spawnCreature] fence is full, cannot spawn', kind);
    EventBus.emit(GE.TOAST_SHOW, { text: '⚠️ 栅栏已满，无法生成生物', duration: 2000 });
    return null;
  }

  // 构造实例
  const creature = {
    id: 'creature_' + (_nextCreatureId++),
    kind: def.kind,
    row: empty.row,
    col: empty.col,
    hp: def.hp,
    maxHp: def.hp,
    atk: def.atk,
    element: def.element,
    elementImmune: def.elementImmune,
    category: def.category,
    growth: 0,
    growthMax: def.growthMax || 0,
    mood: def.mood || 0,
    stage: def.stage || 'chick',
    facilityId: opts.facilityId || null,
    lastMoveTs: Date.now(),
    activeBuffs: [],
  };

  // 加入 gs
  gs.creatures.push(creature);
  empty.creatures = empty.creatures || [];
  empty.creatures.push(creature.id);

  // 更新容量计数（超出也允许生成，warn 由 dailyTick 报）
  EventBus.emit(GE.CREATURE_SPAWNED, { creature });
  EventBus.emit(GE.CAPACITY_CHANGE, { category: def.category, newCount: countByCategory(gs, def.category) });
  EventBus.emit(GE.TOAST_SHOW, { text: `${def.emoji} 生成 ${def.name}`, duration: 1500 });
  devLog.info('[CreatureSystem.spawnCreature]', kind, creature.id);
  return creature;
}

function findEmptyFenceTile(gs) {
  const fence = gs.map.fence;
  const candidates = fence.filter(t => !t.creatures || t.creatures.length === 0);
  if (candidates.length === 0) return null;
  return Random.pick(candidates);
}

function countByCategory(gs, category) {
  return gs.creatures.filter(c => c.category === category).length;
}

/**
 * 实时移动 tick：每 2 秒换方向走 1 格
 * 用 setInterval 驱动（比 requestAnimationFrame 简单，一样准）
 * 扩展 fence 后会自动走邻居格；初始 1×1 fence 就停住
 */
function tickAllCreaturesOnce(gs) {
  const rowCols = gs.map.fenceRowCols;
  if (rowCols <= 1) return; // 1×1 栅栏没邻居，不移动

  for (const c of gs.creatures) {
    if (!c || c.hp <= 0) continue;
    if (c.lastMoveTs && Date.now() - c.lastMoveTs < (c.moveEverySec || 2) * 1000) continue;

    const dir = Random.pick(['up', 'down', 'left', 'right']);
    const [dr, dc] = {
      up:    [-1, 0],
      down:  [ 1, 0],
      left:  [ 0,-1],
      right: [ 0, 1],
    }[dir];
    const nr = c.row + dr;
    const nc = c.col + dc;
    if (nr < 0 || nr >= rowCols || nc < 0 || nc >= rowCols) continue;

    // 挪栅格引用
    const oldTile = gs.map.fence.find(t => t.row === c.row && t.col === c.col);
    const newTile = gs.map.fence.find(t => t.row === nr && t.col === nc);
    if (!newTile) continue;

    // 更新 old tile
    if (oldTile && oldTile.creatures) {
      oldTile.creatures = oldTile.creatures.filter(id => id !== c.id);
    }
    // 应用新位置
    c.row = nr;
    c.col = nc;
    newTile.creatures = newTile.creatures || [];
    newTile.creatures.push(c.id);
    c.lastMoveTs = Date.now();

    // 经过草地形时消耗 1 草元素量（简化）
    if (newTile.terrain === 'grass' && (newTile.terrainAmount ?? 0) > 0) {
      newTile.terrainAmount -= 1;
      if (newTile.terrainAmount <= 0) {
        newTile.terrain = 'none';
        EventBus.emit(GE.TILE_UPDATED);
      }
    }
  }

  EventBus.emit(GE.TILE_UPDATED);
}

/**
 * 启动实时循环（setInterval 每 1 秒检查）
 * 必须传入 getter 函数：() => gs（避免关闭后 GS 被换了）
 */
export function startRealtimeLoop(getterFn) {
  if (_realtimeTimerId != null) return;
  _realtimeTimerId = setInterval(() => {
    const gs = getterFn && getterFn();
    if (gs) tickAllCreaturesOnce(gs);
  }, 1000);   // 每秒检查一次，moveEverySec 内部再过滤
  devLog.info('[CreatureSystem] realtime loop started');
}

export function stopRealtimeLoop() {
  if (_realtimeTimerId != null) {
    clearInterval(_realtimeTimerId);
    _realtimeTimerId = null;
    devLog.info('[CreatureSystem] realtime loop stopped');
  }
  if (_tickRafId != null) {
    cancelAnimationFrame(_tickRafId);
    _tickRafId = null;
  }
}

/**
 * 投喂单只生物（简化版）
 */
export function feedCreature(gs, creatureId, amount = 1) {
  const c = gs.creatures.find(cc => cc.id === creatureId);
  if (!c) return false;
  c.mood += amount;
  return true;
}

/**
 * DaySystem.startNewDay 末尾调用
 * 职责：
 *   1) 检查所有生物饥饿/成长/心情
 *   2) 小鸡→鸡 成长
 *   3) 鸡产蛋
 *   4) 容量超载警告期 & 惩罚
 *   5) 史莱姆粘液喷吐 5%
 */
export function dailyTick(gs) {
  devLog.info('[CreatureSystem.dailyTick] day=', gs.day);

  // ── 1) 生物日常 ──
  for (const c of gs.creatures) {
    if (!c || c.hp <= 0) continue;

    // 心情：若 facility 来源（鸡舍），且玩家今天进入过 → mood +1
    // 简化：直接 mood +1（设计文档 "玩家每次进入鸡舍心情 +1 每日限 1 次" —— Phase 3 简化）
    if (c.facilityId === 'facility_henhouse') {
      c.mood = Math.min(5, (c.mood || 0) + 1);
    }

    // 成长值（小鸡）
    if (c.stage === 'chick' && c.growthMax > 0) {
      // 简化：已投喂（假设默认投喂）成长 +10，饥饿 -5 —— 先都 +10
      c.growth += 10 + (c.mood || 0);
      if (c.growth >= c.growthMax) {
        growUpChick(gs, c);
      }
    }

    // 鸡产蛋
    if (c.kind === 'chicken') {
      InventorySystem.addItem(gs, 'item_egg', 1);
      devLog.info('[CreatureSystem] chicken lays egg');
    }

    // 史莱姆粘液喷吐（5%）
    if (c.category === 'danger' && Random.chance(0.05)) {
      devLog.info('[CreatureSystem] slime spit mucus 5%');
      // Phase 3 简化：只给提示（粘液 debuff 需要 onEnter 时机，玩家不进 fence 所以先只打 log）
    }

    // 清空上一回合 buff（tick 时已扣回合数）—— 在 CombatSystem.tickBuffsOnTarget 做了
  }

  // ── 2) 容量超载警告 & 惩罚 ──
  updateCapacityAndPunish(gs);

  // ── 3) 广播容量变化事件 ──
  EventBus.emit(GE.CAPACITY_CHANGE, {
    friendly: countByCategory(gs, 'friendly'),
    danger: countByCategory(gs, 'danger'),
    extreme: countByCategory(gs, 'extreme'),
  });
}

function growUpChick(gs, chick) {
  devLog.info('[CreatureSystem] chick grows up to chicken:', chick.id);
  EventBus.emit(GE.TOAST_SHOW, { text: `${chick.emoji || '🐣'} 长大成 🐔`, duration: 1500 });
  chick.kind = 'chicken';
  chick.stage = 'adult';
  chick.hp = 100;
  chick.maxHp = 100;
  chick.atk = 0;
  chick.growthMax = 0;
  chick.growth = 0;
  chick.mood = 0;
  chick.element = null;
  chick.elementImmune = null;
  chick.emoji = '🐔';
}

function updateCapacityAndPunish(gs) {
  const cap = gs.capacity || (gs.capacity = {});
  cap.friendly = cap.friendly ?? 4;
  cap.danger = cap.danger ?? 4;
  cap.extreme = cap.extreme ?? 0;
  cap.friendlyOverdue = cap.friendlyOverdue ?? 0;
  cap.dangerOverdue = cap.dangerOverdue ?? 0;
  cap.extremeOverdue = cap.extremeOverdue ?? 0;

  const friendlyCount = countByCategory(gs, 'friendly');
  const dangerCount = countByCategory(gs, 'danger');
  const extremeCount = countByCategory(gs, 'extreme');

  // 友善
  if (friendlyCount > cap.friendly) {
    cap.friendlyOverdue += 1;
    if (cap.friendlyOverdue > 2) {
      devLog.warn('[CreatureSystem] friendly OVERLOAD punishment triggered');
      // 友善类收益归 0 —— 我们不直接改 facility 产出，而是挂 gs.capacity.friendlyOverloaded=true
      // 让 wheat/rice/strawberry/pea/henhouse 在 onDailyStart 里检查这个 flag（Phase 3 DaySystem 要改）
      cap.friendlyOverloaded = true;
    }
  } else {
    cap.friendlyOverdue = 0;
    cap.friendlyOverloaded = false;
  }

  // 危险
  if (dangerCount > cap.danger) {
    cap.dangerOverdue += 1;
    if (cap.dangerOverdue > 2) {
      devLog.warn('[CreatureSystem] danger OVERLOAD punishment triggered');
      cap.dangerOverloaded = true;
      // 扣玩家真实伤害 10%
      const loss = Math.max(1, Math.floor((gs.player.maxHp || gs.player.hp) * 0.10));
      CombatSystem.applyTrueDamageToPlayer(gs.player, loss, { reason: 'danger_overload' });
      EventBus.emit(GE.TOAST_SHOW, { text: `⚠️ 危险生物超载！每日扣 ${loss} ❤️`, duration: 2500 });
    }
  } else {
    cap.dangerOverdue = 0;
    cap.dangerOverloaded = false;
  }

  // 极度危险（预留，Phase 3 没生成）
  if (extremeCount > cap.extreme) {
    cap.extremeOverdue += 1;
    if (cap.extremeOverdue > 2) {
      cap.extremeOverloaded = true;
      const loss = Math.max(1, Math.floor((gs.player.maxHp || gs.player.hp) * 0.10));
      CombatSystem.applyTrueDamageToPlayer(gs.player, loss, { reason: 'extreme_overload' });
    }
  } else {
    cap.extremeOverdue = 0;
    cap.extremeOverloaded = false;
  }

  EventBus.emit(GE.CAPACITY_CHANGE, {
    friendly: friendlyCount, danger: dangerCount, extreme: extremeCount,
    friendlyOverloaded: cap.friendlyOverloaded, dangerOverloaded: cap.dangerOverloaded,
  });
}

export const CreatureSystem = {
  spawnCreature,
  tickAllCreatures: tickAllCreaturesOnce,
  dailyTick,
  feedCreature,
  startRealtimeLoop,
  stopRealtimeLoop,
  resetCreatureIdCounter,
};
