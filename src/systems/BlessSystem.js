// src/systems/BlessSystem.js
// Phase 2A 祈福系统：
//   bless(gs) → stamina -= 2、gold -= 1 → 随机找 1 格（排除玩家当前格和空内容格）
//              → 挂 blessed 状态到 tile.states[]
//              → fire HookDispatcher.fire('onBlessed', { tileIdx })
//              → emit GE.BLESS_DONE + GE.TOAST_SHOW
//
// blessed 状态存储唯一真相源：tile.states[]（tile 级）
// 设计文档 §3 提过的全局 blessingQueue 已在 2A 阶段放弃。
// DaySystem.startNewDay() 会遍历 outerTiles[].states.filter(s=>s.type==='blessed') 统一 -1 天

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { HookDispatcher } from '../core/HookDispatcher.js';
import { Random } from '../core/Random.js';
import { devLog } from '../core/Logger.js';

/** 祈福消耗：2 行动力 + 1 金币 */
export const BLESS_STAMINA_COST = 2;
export const BLESS_GOLD_COST = 1;

/**
 * 执行祈福
 * @param {object} gs 全局状态（会被直接修改）
 * @returns {{ targetIdx: number|null, ok: boolean, reason?: string }}
 */
export function bless(gs) {
  // 1. 扣 stamina
  if (gs.player.stamina < BLESS_STAMINA_COST) {
    EventBus.emit(GE.TOAST_SHOW, { text: '🧘 行动力不足（需 2）', duration: 2000 });
    devLog.info('[Bless] stamina not enough');
    return { targetIdx: null, ok: false, reason: 'stamina' };
  }
  if (gs.player.gold < BLESS_GOLD_COST) {
    EventBus.emit(GE.TOAST_SHOW, { text: '🧘 金币不足（需 1）', duration: 2000 });
    devLog.info('[Bless] gold not enough');
    return { targetIdx: null, ok: false, reason: 'gold' };
  }

  gs.player.stamina -= BLESS_STAMINA_COST;
  EventBus.emit(GE.STAMINA_CHANGE, {
    newValue: gs.player.stamina,
    delta: -BLESS_STAMINA_COST,
    maxStamina: gs.player.maxStamina,
  });

  gs.player.gold -= BLESS_GOLD_COST;
  EventBus.emit(GE.GOLD_CHANGE, { newValue: gs.player.gold, delta: -BLESS_GOLD_COST });

  // 2. 找候选格：排除玩家当前格 & contentId !== null（必须是已有设施/资源的格）
  const candidates = gs.map.outerTiles.filter(t =>
    t.idx !== gs.player.x && t.contentId !== null,
  );
  if (candidates.length === 0) {
    EventBus.emit(GE.TOAST_SHOW, { text: '🧘 没有可祝福的地块', duration: 2000 });
    devLog.info('[Bless] no candidate tiles');
    return { targetIdx: null, ok: false, reason: 'noTiles' };
  }

  const target = Random.pick(candidates);
  devLog.info('[Bless] picked tile', target.idx, 'content:', target.contentId);

  // 3. 挂 blessed 状态（tile 级）
  if (!target.states) target.states = [];
  target.states.push({
    type: 'blessed',
    remainingDays: 1,
    source: 'bless',
  });

  // 4. fire onBlessed hook（让 wheat / rice / tulip / strawberry / pea / tent / henhouse / slimehouse
  //    等各自执行【受祝福时】词条效果）
  HookDispatcher.fire('onBlessed', { gs, tileIdx: target.idx });

  // 5. 广播事件
  EventBus.emit(GE.BLESS_DONE, {
    tileIdx: target.idx,
    contentId: target.contentId,
    staminaCost: BLESS_STAMINA_COST,
    goldCost: BLESS_GOLD_COST,
  });
  EventBus.emit(GE.TOAST_SHOW, { text: `✨ 祝福降临 ${target.contentId}`, duration: 2000 });
  EventBus.emit(GE.TILE_UPDATED, { tileIdx: target.idx });

  return { targetIdx: target.idx, ok: true };
}

export const BlessSystem = {
  bless,
  BLESS_STAMINA_COST,
  BLESS_GOLD_COST,
};
