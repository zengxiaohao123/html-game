// src/systems/BlessSystem.js
// 祈福「按下即结算」，动画只是演出（2026-11-08 修正时序）：
//   blessStart(gs)
//     → 扣 stamina(-2) + gold(-1)
//     → 锁定玩家 gs.uiState.blessing=true（动画期间禁止再次祈福）
//     → 候选格 = 外圈**全部 8 格**（包括玩家所在格 / 空格 / 家 / 任意 contentId）
//     → Random.pick 选 targetIdx
//     → 【立即结算】挂 blessed / fire onBlessed / 精灵效果 / 回合推进（含强制睡觉）
//     → emit GE.BLESS_DONE + GE.TOAST_SHOW + GE.TILE_UPDATED
//     → emit GE.BLESS_START（只带表现数据，供 BlessAnimation 顺时针轮播）
//
//   settleBless(gs, targetIdx, ctx)（内部函数，按下瞬间执行）
//     → tile.states 里先查是否已有 blessed
//       · 已有：remainingDays = Math.max(old, 1)（取更长的那个，不叠加）
//       · 没有：push {type:'blessed', remainingDays:1, source:'bless'}
//     → fire HookDispatcher.fire('onBlessed') 让各设施自己处理（wheat 立即 ×3，rice push rice_bless(remainingDays:5)，等等）
//     → hook 返回后，扫 states 里除 blessed 外、名字以 _bless 结尾且带 remainingDays 的 state
//       → 把 blessed.remainingDays 更新成 Math.max(blessed.remainingDays, maxHookDays)
//     → 精灵效果 / 每日计数 / 回合推进
//
//   blessFinish(gs)（动画结束时调用）
//     → 只解锁 blessing=false + emit GE.BLESS_FINISH，不再做任何结算
//
//   对外 bless(gs)：立即结算并解锁（无动画兼容路径，测试/旧调用用）
//
// blessed 状态存储唯一真相源：tile.states[]
// DaySystem.startNewDay() 遍历 outerTiles[].states.filter(s=>s.type==='blessed') 统一 remainingDays -= 1，清理 <= 0

import { EventBus } from '../core/EventBus.js';
import { HealSystem } from './HealSystem.js';
import { GE } from '../core/GameEvents.js';
import { HookDispatcher } from '../core/HookDispatcher.js';
import { Random } from '../core/Random.js';
import { Distance } from '../core/Distance.js';
import { triggerSkillByHook } from './SkillSystem.js';
import { devLog } from '../core/Logger.js';
import { MIN_STAMINA } from '../utils/constants.js';
import { StaminaSystem } from './StaminaSystem.js';
import { TurnSystem } from './TurnSystem.js';
import { SleepSystem } from './SleepSystem.js';
import { addGold, getGold } from './GoldSystem.js';

/** 祈福消耗：2 行动力 + 1 金币 */
export const BLESS_STAMINA_COST = 2;
export const BLESS_GOLD_COST = 1;

/**
 * 第一步：祈福开始（扣消耗 + 选目标 + emit BLESS_START）
 * candidates[].x/y 为「逻辑坐标」的地块中心（1 格 = 1 单位），
 * 由 UI（BlessAnimation）按当前每格像素换算，禁止在逻辑层写死像素。
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

  // 祈福是玩家主动操作：允许把行动力扣成负数，只有已到下限（-3，无空间再扣）时才拒绝
  const minStamina = Number.isFinite(gs.player.minStamina) ? gs.player.minStamina : MIN_STAMINA;
  if (gs.player.stamina <= minStamina) {
    EventBus.emit(GE.TOAST_SHOW, { text: `🧘 行动力已到下限（下限 ${minStamina}）`, duration: 2000 });
    devLog.info('[Bless] stamina at min');
    return { ok: false, targetIdx: null, candidates: [], reason: 'stamina' };
  }
  if (getGold(gs) < goldCost) {
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

  // 扣消耗（锁定）：允许透支为负，但不低于下限（超出下限的部分夹掉）
  StaminaSystem.spendStaminaActive(gs, staminaCost, { reason: 'bless' });
  addGold(gs, -goldCost, 'bless');

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
      const { x, y } = Distance.outerIdxToXY(gs.map, t.idx);
      return {
        idx: t.idx,
        // 逻辑坐标（格中心）；像素换算由 UI 层按当前每格像素完成（外圈可扩展）
        x: x + 0.5,
        y: y + 0.5,
        contentId: t.contentId,
      };
    });

  devLog.info('[Bless] start — targetIdx=', targetIdx, 'content:', targetTile.contentId,
    '(玩家格=', targetIdx === gs.player.x, ', 空格=', targetTile.contentId === null, ')');

  // 按下即结算：抽取结果 / 收益代价 / 行动力扣减 / 回合推进全部在此完成
  settleBless(gs, targetIdx, { staminaCost, goldCost, spirit });

  // 动画只是演出：BLESS_START 仅携带表现所需数据，动画期间不再改变任何游戏状态
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
 * 祈福结算（内部）：在按下瞬间执行，动画不再调用
 * @param {object} gs
 * @param {number} targetIdx
 * @param {{staminaCost:number, goldCost:number, spirit:string|null}} ctx
 */
function settleBless(gs, targetIdx, { staminaCost, goldCost, spirit }) {
  const tile = gs.map.outerTiles[targetIdx];
  if (!tile) {
    devLog.warn('[Bless] settle — invalid targetIdx', targetIdx);
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

  // ── 2b. 技能地块的【受祝福时】：与 onEnter/onPass 共用 SkillSystem 的同一结算流水线
  //     （同一份 snapshot / 判定 / 批次 / 死亡延迟；技能卡本身不是设施，不会再被 fire 触发一次）
  triggerSkillByHook('onBlessed', { gs, tileIdx: targetIdx });

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
  // momo 减半已在 blessStart 处理；这里处理晴风和芋圆的祈福后效果（spirit 由按下瞬间的上下文传入）

  // 更新每日祈福计数器（momo 的首次判断依赖这个，晴风/芋圆累加也需要）
  if (!gs.team.dailyBlessCount) gs.team.dailyBlessCount = 0;
  gs.team.dailyBlessCount += 1;

  if (spirit === 'qingfeng') {
    // 晴风：HP +6（不超 maxHp），攻击力 +8%（每层按叠后算，保留 1 位小数；UI 显示 floor）
    // 文档 §12.2："使本日内角色攻击力 +8%" 严格按叠后算（不是加之前的 atk 算）
    // 走统一回血入口，保证【角色回复生命值时】被触发（艾草田地依赖）
    const actualHpDelta = HealSystem.healPlayer(gs, 6, { source: 'bless_qingfeng' });
    const prevAtk = gs.player.atk;
    // 保留 1 位小数，不立即取整；UI 显示时 floor
    gs.player.atk = Math.round(gs.player.atk * 1.08 * 10) / 10;
    const atkDelta = gs.player.atk - prevAtk;
    // §12.8 晴风加成仅限本日内 —— 记录本日累计增量，DaySystem 跨天一次性回滚（B-1）
    gs.team.qingfengAtkApplied = Math.round(((gs.team.qingfengAtkApplied || 0) + atkDelta) * 10) / 10;
    EventBus.emit(GE.ATK_CHANGE, { newValue: gs.player.atk, reason: 'bless_qingfeng' });
    if (!gs.team.dailyQingfengAtkBonus) gs.team.dailyQingfengAtkBonus = 0;
    gs.team.dailyQingfengAtkBonus += 1;
    EventBus.emit(GE.TOAST_SHOW, { text: `🌬️ 晴风：HP +${actualHpDelta}，攻击力 +${Math.floor(atkDelta)}（共 ${gs.team.dailyQingfengAtkBonus} 层）`, duration: 2000 });
    devLog.info('[Bless] qingfeng effect: hp+', actualHpDelta, 'atk+', atkDelta.toFixed(1), 'total stacks=', gs.team.dailyQingfengAtkBonus);
  } else if (spirit === 'yuyuan') {
    // 芋圆：下次移动不消耗行动力（不可叠加，仅限本日内）
    gs.player.nextMoveNoStamina = true;
    EventBus.emit(GE.TOAST_SHOW, { text: '🟣 芋圆：下次移动免行动力', duration: 2000 });
    devLog.info('[Bless] yuyuan effect: nextMoveNoStamina = true');
  }
  // momo 的减半已在 blessStart 中处理，结算无额外效果

  // 广播结算事件（此时游戏状态已完全落定；动画期间只会读取表现数据）
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

  devLog.info('[Bless] settle — done, targetIdx=', targetIdx, 'blessed.remainingDays=', curBlessed?.remainingDays);

  // §5.2：推进回合的行为只有三种——移动 / 祈福 / 睡觉。祈福结算完成后推进 1 回合。
  // 若行动力过低（<= MIN_STAMINA）触发强制睡觉（§5.3），强制睡觉本身也是一次睡觉，同样推进回合。
  const turnResult = TurnSystem.advanceTurn(gs, 0);
  if (turnResult.forcedSleep) {
    SleepSystem.sleep(gs, /* isAuto = */ true);
  }
}

/**
 * 动画结束：只解锁祈福状态，不再结算（结算已在 blessStart 按下瞬间完成）
 * @returns {boolean} 是否真的解锁了一次进行中的祈福
 */
export function blessFinish(gs) {
  if (!gs?.uiState?.blessing) return false;
  gs.uiState.blessing = false;
  EventBus.emit(GE.BLESS_FINISH, {});
  devLog.info('[Bless] finish — animation ended, state untouched');
  return true;
}

/**
 * 兼容旧调用：bless(gs) —— 立即结算并解锁（无动画路径）
 */
export function bless(gs) {
  const step1 = blessStart(gs);
  if (!step1.ok) return step1;
  blessFinish(gs);
  return step1;
}

export const BlessSystem = {
  bless,
  blessStart,
  blessFinish,
  BLESS_STAMINA_COST,
  BLESS_GOLD_COST,
};
