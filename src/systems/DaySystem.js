// src/systems/DaySystem.js
// 每日开始系统：day++、turn=0、触发 onDailyStart hook、重置每日计数器、处理 blessed 状态、出货箱结算
//  stamina 回复逻辑由 SleepSystem 在上层处理（家回满 / 帐篷回满 / 其他回一半）
//
// Phase 3 扩展：
//   - 末尾 CreatureSystem.dailyTick(gs)  生物饥饿/成长/心情/产蛋/容量
//   - 友善超载 → 当天产出归 0（在此统一做，让 wheat/rice/strawberry/pea/henhouse hook 跳过）

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { HookDispatcher } from '../core/HookDispatcher.js';
import { devLog } from '../core/Logger.js';
import { InventorySystem } from './InventorySystem.js';
import { CreatureSystem } from './CreatureSystem.js';
import { CombatSystem } from './CombatSystem.js';
import { TalentSystem } from './TalentSystem.js';
import { LinkSkillSystem } from './LinkSkillSystem.js';
import { Storage } from '../state/storage.js';
import { StaminaSystem } from './StaminaSystem.js';
import { VehicleSystem } from './VehicleSystem.js';
import { CalendarSystem } from './CalendarSystem.js';
import { ShopSystem } from './ShopSystem.js';
import { UseItemSystem } from './UseItemSystem.js';

/**
 * 开始新的一天
 * @param {object} gs 全局状态（会被直接修改）
 */
export function startNewDay(gs) {
  // 0. 【每一日结束时】结算（上一日收尾：穗粒满给小麦田 +1 等，必须在 day++ 之前）
  HookDispatcher.fire('onDailyEnd', { gs });

  // 0.1 行动力溢出清除（拓荒者、帐篷祝福 +3 等允许临时超出上限，次日开始时清零，不保留到第二天）
  //     注意顺序（§5.1）：先在本步把行动力夹到上限，再由睡眠结算基础恢复，最后叠加可超上限的额外行动力。
  if (gs.player.stamina > gs.player.maxStamina) {
    StaminaSystem.settleStamina(gs, gs.player.maxStamina - gs.player.stamina, { reason: 'overflow_clear' });
  }

  gs.day += 1;
  gs.turn = 0;

  // 0.2 日历推进（v0.5 §6.1）：周 = 7 天 / 月 = 28 天 / 一年 4 个月
  const cal = CalendarSystem.tickDay(gs);
  devLog.info('[DaySystem] 新的一天！', CalendarSystem.formatCalendar(gs),
    cal.newWeek ? '（新的一周）' : '', cal.newMonth ? '（新月份）' : '', cal.newYear ? '（新年）' : '');

  // 1. 重置所有每日计数器为 0
  gs.dailyCounters = {};
  // 商店"每日至多放置 1 个"计数
  gs.buildDailyPlaced = {};
  // momo 图腾"优先本日未进入过的地块"
  gs.player.visitedTodayIdx = [];

  // 2. 清除所有每日限次标记（每格的 dailyFlags）
  for (const tile of gs.map.outerTiles) {
    tile.dailyFlags = {};
  }
  for (const fenceTile of gs.map.fence) {
    if (fenceTile.dailyFlags) fenceTile.dailyFlags = {};
  }

  // 3. blessed 状态 -1 天，0 天移除
  for (const tile of gs.map.outerTiles) {
    tile.states = (tile.states || []).filter(s => {
      if (s.type === 'blessed') {
        s.remainingDays -= 1;
        if (s.remainingDays <= 0) {
          devLog.info('[DaySystem] blessed state expired on tile', tile.idx);
          return false;
        }
      }
      return true;
    });
  }

  // 4. Phase 3：生物系统 dailyTick（饥饿/成长/心情/产蛋/容量超载惩罚 —— 先跑，让 capacity 状态就绪）
  CreatureSystem.dailyTick(gs);

  // 5. 出货箱自动换成金币（InventorySystem.loadFromOutbox 按 items[].value 合计）
  InventorySystem.loadFromOutbox(gs);

  // 6. 触发所有 onDailyStart hook（设施产出、生物刷新等 —— 此时 capacity.friendlyOverloaded 已就绪，wheat 等可据此归 0）
  HookDispatcher.fire('onDailyStart', { gs });

  // 6.1 放置型消耗道具的每日结算（陷阱 10% / 资源地块 30% 得随机物品）
  UseItemSystem.onDailyStart(gs);

  // 6.2 清理"仅限本日"的标记（感恩节的晚餐：我方把友善生物视为敌人）
  if (gs.flags) gs.flags.friendlyAsEnemyToday = false;

  // 7. Phase 3：玩家身上 buff 衰减（burn 每回合流失 3% 这里是每日 —— 实际 burn 按回合 tick；
  //     这里每日只处理心力交瘁的剩余天数）
  const exhausted = gs.activeBuffs.find(b => b.id === 'exhausted');
  if (exhausted && exhausted.remainingTurns !== undefined && exhausted.remainingTurns > 0) {
    exhausted.remainingTurns -= 1;
    if (exhausted.remainingTurns <= 0) {
      gs.activeBuffs = gs.activeBuffs.filter(b => b !== exhausted);
      devLog.info('[DaySystem] exhausted buff expired');
    }
  }

  // 7.1 §15：按天持续的 buff（如啤酒【暴躁】remainingDays）每日开始 -1，归零移除
  gs.activeBuffs = gs.activeBuffs.filter(b => {
    if (typeof b.remainingDays === 'number') {
      b.remainingDays -= 1;
      if (b.remainingDays <= 0) {
        devLog.info('[DaySystem] day-counted buff expired:', b.id);
        return false;
      }
    }
    return true;
  });

  // 8. 精灵每日字段重置（§12.2：momo 首次祈福计数、晴风攻击加成层数、芋圆免移动标志）
  if (gs.team) {
    gs.team.dailyBlessCount = 0;
    gs.team.dailyQingfengAtkBonus = 0;
    // B-1：§12.8 晴风攻击加成仅限本日内 → 跨天一次性回滚累计增量（不再永久残留）
    if (gs.team.qingfengAtkApplied && gs.player) {
      gs.player.atk = Math.round((gs.player.atk - gs.team.qingfengAtkApplied) * 10) / 10;
      EventBus.emit(GE.ATK_CHANGE, { newValue: gs.player.atk, reason: 'qingfeng_daily_reset' });
      devLog.info('[DaySystem] 晴风攻击加成跨天回滚 -', gs.team.qingfengAtkApplied, '→ atk', gs.player.atk);
      gs.team.qingfengAtkApplied = 0;
    }
    // A-3 鼓舞（SKL-A-004）：「本日攻击力 +15（可叠加）」仅限本日内 → 跨天回滚
    if (gs.team.dailyInspireAtkApplied && gs.player) {
      gs.player.atk -= gs.team.dailyInspireAtkApplied;
      EventBus.emit(GE.ATK_CHANGE, { newValue: gs.player.atk, reason: 'skill_inspire_daily_reset' });
      devLog.info('[DaySystem] 鼓舞攻击加成跨天回滚 -', gs.team.dailyInspireAtkApplied, '→ atk', gs.player.atk);
      gs.team.dailyInspireAtkApplied = 0;
    }
    // 众愿（SKL-A-007）：「本日内」火伤 +20% / 其余 -10% 跨天清除
    gs.team.allWishesActive = false;
    // 移形（SKL-L-008）：今日累计移动距离跨天清零
    gs.team.dailyDistanceMoved = 0;
    // §12.1：编队每日修改次数清零（每日至多改 3 次）
    gs.team.dailyModifyCount = 0;
  }
  if (gs.player && gs.player.nextMoveNoStamina) {
    gs.player.nextMoveNoStamina = false; // 芋圆效果仅限本日内
  }

  // 8.5 Agent 3：连携技重置
  LinkSkillSystem.resetAll(gs);

  // 8.6 Agent 3：天赋 onDayStart（巧手随机物品 + 比翼 buff 天数 + 涅槃冷却）
  TalentSystem.onDayStart(gs);
  TalentSystem.onDayStartCooldownTick(gs);

  // 8.7 Agent 3：载具 巧遇 每天限次重置
  VehicleSystem.onDayStart(gs);

  // 8.75 v0.5：每周一商店自动刷新（免费，不占手动次数）
  if (cal.newWeek) {
    ShopSystem.weeklyRefreshAll(gs);
  }

  // 8.8 Agent 3：自动存档 slot 1
  Storage.autoSave(gs);

  // 9. 广播 DAY_START 事件
  EventBus.emit(GE.DAY_START, { day: gs.day, calendar: gs.calendar, ...cal });
  EventBus.emit(GE.TILE_UPDATED); // 地图整体刷新
  EventBus.emit(GE.STAT_CHANGE);  // 所有 UI 数值刷新
}

export const DaySystem = {
  startNewDay,
};
