// src/systems/BlessSystem.js
// Phase 2B 改成两步式，支持抽奖动画：
//   第一步 blessStart(gs)
//     → 扣 stamina(-2) + gold(-1)
//     → 锁定玩家（gs.uiState.blessing = true，防止重复祈福）
//     → 从候选格（排除玩家格 & 必须 contentId!==null）里随机挑 targetIdx
//     → emit GE.BLESS_START（带 candidates + targetIdx + 各自的 tile 坐标信息供 UI 用）
//     → 返回 { ok: boolean, targetIdx, candidates, reason? }
//
//   第二步 blessCommit(gs, targetIdx)
//     → 在 target tile.states[] push {type:'blessed', remainingDays:1}
//     → HookDispatcher.fire('onBlessed') 让各设施自己处理效果
//     → emit GE.BLESS_DONE + GE.TOAST_SHOW("✨ 祝福降临 ${contentId}")
//     → 解锁 gs.uiState.blessing = false
//
//   对外保留 bless(gs) 兼容旧调用（infoPanel 按钮 → blessStart → 直接 commit，无动画路径）
//   但 UI 层（BlessAnimation.js）应显式走 blessStart + blessCommit 两步。
//
// blessed 状态存储唯一真相源：tile.states[]
// DaySystem.startNewDay() 里遍历 outerTiles[].states.filter(s=>s.type==='blessed') 统一 -1 天

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { HookDispatcher } from '../core/HookDispatcher.js';
import { Random } from '../core/Random.js';
import { Distance } from '../core/Distance.js';
import { devLog } from '../core/Logger.js';

/** 祈福消耗：2 行动力 + 1 金币 */
export const BLESS_STAMINA_COST = 2;
export const BLESS_GOLD_COST = 1;

const TILE_SIZE = 80;

/**
 * 第一步：祈福开始（扣消耗 + 选目标 + emit BLESS_START）
 * UI 层播抽奖动画 → 动画完成后调 blessCommit()
 * @returns {{ ok: boolean, targetIdx: number|null, candidates: Array<{idx:number,x:number,y:number,contentId:string}>, reason?:string }}
 */
export function blessStart(gs) {
  // 重入保护（动画期间禁止再次祈福）
  if (gs.uiState?.blessing) {
    devLog.info('[Bless] blessing already in progress, ignore');
    return { ok: false, targetIdx: null, candidates: [], reason: 'inProgress' };
  }

  if (gs.player.stamina < BLESS_STAMINA_COST) {
    EventBus.emit(GE.TOAST_SHOW, { text: '🧘 行动力不足（需 2）', duration: 2000 });
    devLog.info('[Bless] stamina not enough');
    return { ok: false, targetIdx: null, candidates: [], reason: 'stamina' };
  }
  if (gs.player.gold < BLESS_GOLD_COST) {
    EventBus.emit(GE.TOAST_SHOW, { text: '🧘 金币不足（需 1）', duration: 2000 });
    devLog.info('[Bless] gold not enough');
    return { ok: false, targetIdx: null, candidates: [], reason: 'gold' };
  }

  // 候选格（排除玩家当前格 + 必须是已有内容格）
  const candidates = gs.map.outerTiles.filter(t =>
    t.idx !== gs.player.x && t.contentId !== null,
  );
  if (candidates.length === 0) {
    EventBus.emit(GE.TOAST_SHOW, { text: '🧘 没有可祝福的地块', duration: 2000 });
    devLog.info('[Bless] no candidate tiles');
    return { ok: false, targetIdx: null, candidates: [], reason: 'noTiles' };
  }

  // 扣消耗（锁定）
  gs.player.stamina -= BLESS_STAMINA_COST;
  EventBus.emit(GE.STAMINA_CHANGE, {
    newValue: gs.player.stamina,
    delta: -BLESS_STAMINA_COST,
    maxStamina: gs.player.maxStamina,
  });
  gs.player.gold -= BLESS_GOLD_COST;
  EventBus.emit(GE.GOLD_CHANGE, { newValue: gs.player.gold, delta: -BLESS_GOLD_COST });

  // 锁 blessing 状态
  if (!gs.uiState) gs.uiState = {};
  gs.uiState.blessing = true;

  // 选目标
  const targetTile = Random.pick(candidates);
  const targetIdx = targetTile.idx;

  // 把候选格坐标也打包好给 UI（BlessAnimation.js 用来画动画）
  const packedCandidates = candidates.map(t => {
    const { x, y } = Distance.outerIdxToXY(gs.map.size, t.idx);
    return {
      idx: t.idx,
      x: x * TILE_SIZE + TILE_SIZE / 2,   // 相对 map-container 的中心像素
      y: y * TILE_SIZE + TILE_SIZE / 2,
      contentId: t.contentId,
    };
  });

  devLog.info('[Bless] start — picked tile', targetIdx, 'content:', targetTile.contentId);

  // 广播 BLESS_START（UI 订阅后播抽奖动画）
  EventBus.emit(GE.BLESS_START, {
    targetIdx,
    targetContentId: targetTile.contentId,
    candidates: packedCandidates,
    staminaCost: BLESS_STAMINA_COST,
    goldCost: BLESS_GOLD_COST,
  });

  return { ok: true, targetIdx, candidates: packedCandidates };
}

/**
 * 第二步：祈福提交（挂状态 + fire hook + emit BLESS_DONE）
 * UI 抽奖动画播完后必须调这个，否则状态永远锁在 blessing=true
 */
export function blessCommit(gs, targetIdx) {
  const tile = gs.map.outerTiles[targetIdx];
  if (!tile) {
    devLog.warn('[Bless] commit — invalid targetIdx', targetIdx);
    return;
  }

  // 挂 blessed 状态（tile 级）
  if (!tile.states) tile.states = [];
  tile.states.push({
    type: 'blessed',
    remainingDays: 1,
    source: 'bless',
  });

  // fire onBlessed hook（让 wheat / rice / tulip / strawberry / pea / tent / henhouse / slimehouse
  // 等各自执行【受祝福时】词条效果）
  HookDispatcher.fire('onBlessed', { gs, tileIdx: targetIdx });

  const contentId = tile.contentId;

  // 解锁
  if (gs.uiState) gs.uiState.blessing = false;

  // 广播事件
  EventBus.emit(GE.BLESS_DONE, {
    tileIdx: targetIdx,
    contentId,
    staminaCost: BLESS_STAMINA_COST,
    goldCost: BLESS_GOLD_COST,
  });
  EventBus.emit(GE.TOAST_SHOW, { text: `✨ 祝福降临 ${contentId}`, duration: 2200 });
  EventBus.emit(GE.TILE_UPDATED, { tileIdx: targetIdx });

  devLog.info('[Bless] commit — done, targetIdx=', targetIdx);
}

/**
 * 兼容旧调用：bless(gs) —— 立即执行两步，不播动画
 * InfoPanel Tab3 按钮可以继续用这个简化路径，
 * 但空格键 / 点击 momo 等 UI 层应该自己调 blessStart + 动画 + blessCommit
 */
export function bless(gs) {
  const step1 = blessStart(gs);
  if (!step1.ok) return step1;
  // 立即 commit（等于没有抽奖动画）
  blessCommit(gs, step1.targetIdx);
  return step1;
}

export const BlessSystem = {
  bless,
  blessStart,
  blessCommit,
  BLESS_STAMINA_COST,
  BLESS_GOLD_COST,
};
