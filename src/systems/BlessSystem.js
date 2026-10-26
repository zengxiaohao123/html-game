// src/systems/BlessSystem.js
// Phase 2B 最终版：
//   blessStart(gs)
//     → 扣 stamina(-2) + gold(-1)
//     → 锁定玩家 gs.uiState.blessing=true
//     → 候选格 = 外圈**全部 8 格**（包括玩家所在格 / 空格 / 家 / 任意 contentId）
//     → Random.pick 选 targetIdx
//     → emit GE.BLESS_START（带外圈 8 格的绝对页面坐标，供 BlessAnimation 顺时针轮播）
//
//   blessCommit(gs, targetIdx)
//     → tile.states 里先查是否已有 blessed
//       · 已有：remainingDays = Math.max(old, 1)（取更长的那个，不叠加）
//       · 没有：push {type:'blessed', remainingDays:1, source:'bless'}
//     → fire HookDispatcher.fire('onBlessed') 让各设施自己处理（wheat 立即 ×3，rice push rice_bless(remainingDays:5)，等等）
//     → hook 返回后，扫 states 里除 blessed 外、名字以 _bless 结尾且带 remainingDays 的 state
//       → 把 blessed.remainingDays 更新成 Math.max(blessed.remainingDays, maxHookDays)
//       目的：边框金色特效要跟持续型效果实际生效时长对齐
//     → emit GE.BLESS_DONE + GE.TOAST_SHOW + GE.TILE_UPDATED
//     → 解锁 blessing=false
//
//   对外 bless(gs)：立即两步（无动画，InfoPanel Tab3 按钮用这个简化路径——其实 Tab3 也已改成 blessStart + BlessAnimation 播完再 commit）
//
// blessed 状态存储唯一真相源：tile.states[]
// DaySystem.startNewDay() 遍历 outerTiles[].states.filter(s=>s.type==='blessed') 统一 remainingDays -= 1，清理 <= 0

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
 * @returns {{ ok: boolean, targetIdx: number|null, candidates: Array<{idx:number,x:number,y:number,contentId:string|null}>, reason?:string, staminaCost?:number, goldCost?:number }}
 */
export function blessStart(gs) {
  // 重入保护（动画期间禁止再次祈福）
  if (gs.uiState?.blessing) {
    devLog.info('[Bless] blessing already in progress, ignore');
    return { ok: false, targetIdx: null, candidates: [], reason: 'inProgress' };
  }

  // ── 读取当前精灵 ──
  const activeGroup = gs.team?.groups?.[gs.team?.activeGroup ?? 0];
  const spirit = activeGroup?.spirit; // 'momo' | 'qingfeng' | 'yuyuan' | null
  devLog.info('[Bless] 当前精灵 =', spirit || '(无)');

  // ── 动态计算消耗（momo 首次祈福减半 —— 设计文档 §12.2） ──
  let staminaCost = BLESS_STAMINA_COST; // 默认 2
  let goldCost = BLESS_GOLD_COST;       // 默认 1
  if (spirit === 'momo') {
    const dailyBlessCount = gs.team?.dailyBlessCount ?? 0;
    if (dailyBlessCount === 0) {
      staminaCost = Math.max(1, Math.floor(BLESS_STAMINA_COST * 0.5)); // 2*0.5=1, min 1
      goldCost    = Math.max(0, Math.floor(BLESS_GOLD_COST * 0.5));     // 1*0.5=0, min 0
      devLog.info('[Bless] momo 首次祈福减半：stamina', staminaCost, 'gold', goldCost);
    }
  }

  if (gs.player.stamina < staminaCost) {
    EventBus.emit(GE.TOAST_SHOW, { text: `🧘 行动力不足（需 ${staminaCost}）`, duration: 2000 });
    devLog.info('[Bless] stamina not enough');
    return { ok: false, targetIdx: null, candidates: [], reason: 'stamina' };
  }
  if (gs.player.gold < goldCost) {
    EventBus.emit(GE.TOAST_SHOW, { text: `🧘 金币不足（需 ${goldCost}）`, duration: 2000 });
    devLog.info('[Bless] gold not enough');
    return { ok: false, targetIdx: null, candidates: [], reason: 'gold' };
  }

  // 候选格：外圈全部 8 格（不再过滤玩家格 / 空格 / 家 / contentId）
  const candidates = gs.map.outerTiles.slice();
  if (candidates.length === 0) {
    EventBus.emit(GE.TOAST_SHOW, { text: '🧘 地图上没有可祝福的地块', duration: 2000 });
    return { ok: false, targetIdx: null, candidates: [], reason: 'noTiles' };
  }

  // 扣消耗（锁定）
  gs.player.stamina -= staminaCost;
  EventBus.emit(GE.STAMINA_CHANGE, {
    newValue: gs.player.stamina,
    delta: -staminaCost,
    maxStamina: gs.player.maxStamina,
  });
  gs.player.gold -= goldCost;
  EventBus.emit(GE.GOLD_CHANGE, { newValue: gs.player.gold, delta: -goldCost });

  // 锁 blessing 状态
  if (!gs.uiState) gs.uiState = {};
  gs.uiState.blessing = true;

  // 选目标
  const targetTile = Random.pick(candidates);
  const targetIdx = targetTile.idx;

  // 打包候选格（按 idx 升序，保证 BlessAnimation 顺时针轮播顺序一致）
  const packedCandidates = candidates
    .slice()
    .sort((a, b) => a.idx - b.idx)
    .map(t => {
      const { x, y } = Distance.outerIdxToXY(gs.map.size, t.idx);
      return {
        idx: t.idx,
        x: x * TILE_SIZE + TILE_SIZE / 2,
        y: y * TILE_SIZE + TILE_SIZE / 2,
        contentId: t.contentId,
      };
    });

  devLog.info('[Bless] start — targetIdx=', targetIdx, 'content:', targetTile.contentId,
    '(玩家格=', targetIdx === gs.player.x, ', 空格=', targetTile.contentId === null, ')');

  // 广播 BLESS_START（BlessAnimation 订阅后顺时针轮播）
  EventBus.emit(GE.BLESS_START, {
    targetIdx,
    targetContentId: targetTile.contentId,
    candidates: packedCandidates,
    staminaCost,
    goldCost,
    spirit,
  });

  return { ok: true, targetIdx, candidates: packedCandidates, staminaCost, goldCost };
}

/**
 * 第二步：祈福提交
 * @param {object} gs
 * @param {number} targetIdx
 */
export function blessCommit(gs, targetIdx) {
  const tile = gs.map.outerTiles[targetIdx];
  if (!tile) {
    devLog.warn('[Bless] commit — invalid targetIdx', targetIdx);
    if (gs.uiState) gs.uiState.blessing = false;
    return;
  }

  // ── 1. push / 更新 blessed state（不叠加，取 max remainingDays） ──
  if (!tile.states) tile.states = [];
  const existingBlessed = tile.states.find(s => s.type === 'blessed');
  if (existingBlessed) {
    // 已存在：取 max，不叠加
    existingBlessed.remainingDays = Math.max(existingBlessed.remainingDays ?? 1, 1);
    devLog.info('[Bless] commit — merge into existing blessed, remainingDays=', existingBlessed.remainingDays);
  } else {
    tile.states.push({
      type: 'blessed',
      remainingDays: 1,
      source: 'bless',
    });
    devLog.info('[Bless] commit — push new blessed state');
  }

  // ── 2. fire onBlessed hook（各设施处理自己的立即型 / 持续型效果） ──
  HookDispatcher.fire('onBlessed', { gs, tileIdx: targetIdx });

  // ── 3. hook 扫完后，用持续型 state 的 remainingDays 对齐 blessed.remainingDays ──
  //    比如 rice 会 push rice_bless(remainingDays:5)，border 金色特效也要持续 5 天
  const curBlessed = tile.states.find(s => s.type === 'blessed');
  if (curBlessed) {
    let maxHookDays = curBlessed.remainingDays; // 默认就是 1（立即型）
    for (const s of tile.states) {
      // 扫所有 hook 自己 push 的持续型 state：名字以 _bless 结尾，且有 remainingDays 数字
      if (s === curBlessed) continue;
      if (typeof s.type === 'string' && s.type.endsWith('_bless') && typeof s.remainingDays === 'number' && s.remainingDays > maxHookDays) {
        maxHookDays = s.remainingDays;
      }
    }
    if (maxHookDays > curBlessed.remainingDays) {
      devLog.info('[Bless] commit — align blessed.remainingDays', curBlessed.remainingDays, '→', maxHookDays);
      curBlessed.remainingDays = maxHookDays;
    }
  }

  // ── 4. 精灵效果（设计文档 §12.2） ──
  // momo 减半已在 blessStart 处理；这里处理晴风和芋圆的祈福后效果
  const activeGroup = gs.team?.groups?.[gs.team?.activeGroup ?? 0];
  const spirit = activeGroup?.spirit;

  // 更新每日祈福计数器（momo 的首次判断依赖这个，晴风/芋圆累加也需要）
  if (!gs.team.dailyBlessCount) gs.team.dailyBlessCount = 0;
  gs.team.dailyBlessCount += 1;

  if (spirit === 'qingfeng') {
    // 晴风：HP +6（不超 maxHp），攻击力 +8%（每层按叠后算：atk = floor(atk * 1.08)）
    // 文档 §12.2："使本日内角色攻击力 +8%" 严格按叠后算（不是加之前的 atk 算）
    const hpDelta = 6;
    const prevHp = gs.player.hp;
    gs.player.hp = Math.min(gs.player.maxHp, gs.player.hp + hpDelta);
    const actualHpDelta = gs.player.hp - prevHp;
    if (actualHpDelta > 0) {
      EventBus.emit(GE.HP_CHANGE, { newValue: gs.player.hp, delta: actualHpDelta, reason: 'bless_qingfeng' });
    }
    const prevAtk = gs.player.atk;
    gs.player.atk = Math.floor(gs.player.atk * 1.08);
    const atkDelta = gs.player.atk - prevAtk;
    EventBus.emit(GE.ATK_CHANGE, { newValue: gs.player.atk, reason: 'bless_qingfeng' });
    if (!gs.team.dailyQingfengAtkBonus) gs.team.dailyQingfengAtkBonus = 0;
    gs.team.dailyQingfengAtkBonus += 1;
    EventBus.emit(GE.TOAST_SHOW, { text: `🌬️ 晴风：HP +${actualHpDelta}，攻击力 +${gs.player.atk - prevAtk}（共 ${gs.team.dailyQingfengAtkBonus} 层）`, duration: 2000 });
    devLog.info('[Bless] qingfeng effect: hp+', actualHpDelta, 'atk+', gs.player.atk - prevAtk, 'total stacks=', gs.team.dailyQingfengAtkBonus);
  } else if (spirit === 'yuyuan') {
    // 芋圆：下次移动不消耗行动力（不可叠加，仅限本日内）
    gs.player.nextMoveNoStamina = true;
    EventBus.emit(GE.TOAST_SHOW, { text: '🟣 芋圆：下次移动免行动力', duration: 2000 });
    devLog.info('[Bless] yuyuan effect: nextMoveNoStamina = true');
  }
  // momo 的减半已在 blessStart 中处理，commit 无额外效果

  // 解锁
  if (gs.uiState) gs.uiState.blessing = false;

  // 广播事件
  const contentId = tile.contentId;
  EventBus.emit(GE.BLESS_DONE, {
    tileIdx: targetIdx,
    contentId,
    staminaCost: BLESS_STAMINA_COST,
    goldCost: BLESS_GOLD_COST,
    spirit,
  });

  // 对空格也显示 Toast（说明"空地被祝福"，虽然没有实际效果）
  if (!contentId) {
    EventBus.emit(GE.TOAST_SHOW, { text: `✨ 空地 ${targetIdx} 被祝福（无实际效果）`, duration: 2200 });
  } else if (targetIdx === gs.player.x) {
    EventBus.emit(GE.TOAST_SHOW, { text: `✨ 你脚下的 ${contentId} 被祝福`, duration: 2200 });
  } else {
    EventBus.emit(GE.TOAST_SHOW, { text: `✨ 祝福降临 ${contentId}`, duration: 2200 });
  }

  EventBus.emit(GE.TILE_UPDATED, { tileIdx: targetIdx });

  devLog.info('[Bless] commit — done, targetIdx=', targetIdx, 'blessed.remainingDays=', curBlessed?.remainingDays);
}

/**
 * 兼容旧调用：bless(gs) —— 立即执行两步（无动画）
 */
export function bless(gs) {
  const step1 = blessStart(gs);
  if (!step1.ok) return step1;
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
