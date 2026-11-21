// src/data/facilities.js
// 设施（FAC-009 ~ FAC-012）与资源类地块内容（RES-001 ~ RES-006）定义。
//
// 田块（FAC-001 ~ FAC-008、FAC-013 ~ FAC-025）已全部迁到 src/data/fields/：
//   一田块一文件，见 fields/index.js 的 FIELD_DEFS。
//   本文件只保留设施与资源，不再混放田块定义。
//
// 每种对象：{ id, name, emoji, register() }
// register() 里通过 HookDispatcher.register(hookType, cb) 把【】词条挂到分发器
// 回调 params 形状：{ gs, tileIdx, tileRef }（外圈格 tileIdx 为数字、tileRef 同值；
//   生效小径栅栏格 tileIdx 为 null、tileRef 为 fence ref）
//
// 核心约定：
//   - 判断"当前格是我这种设施"必须用 getTile(gs, tileRef ?? tileIdx).contentId === this.id
//     绝对不能用 tileIdx === 硬编码数字
//   - 每日循环必须遍历 contentEntries(gs)（外圈 + 生效小径格），不要只遍历 outerTiles
//   - 每日限次：用 tile.dailyFlags['<id>_<hookType>'] === true 存布尔
//     DaySystem.startNewDay() 已统一把 dailyFlags 全部重置为 {}

import { HookDispatcher } from '../core/HookDispatcher.js';
import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { Assets } from '../core/Assets.js';
import { devLog } from '../core/Logger.js';
import { VehicleSystem } from '../systems/VehicleSystem.js';
import { getTile, contentEntries, isFenceRef, fenceIdxOf, playerRef } from '../core/TileAccess.js';
import { CreatureSystem } from '../systems/CreatureSystem.js';
import { Random } from '../core/Random.js';
import { CREATURES, SLIME_KINDS } from './creatures.js';
import { SKILLS } from './characters.js';
import { ITEMS, POOLS } from './items.js';
import { ITEM_TO_VEHICLE, VEHICLES } from './vehicles.js';
import { addGold } from '../systems/GoldSystem.js';
import { drawFromPool } from '../systems/RandomPool.js';
import { drawEventDef, markEventEntered, markEventRevealed } from './eventPool.js';
import { getEventDef } from './events.js';
import { drawReward, grantReward } from './rewardPool.js';
import { ShopSystem } from '../systems/ShopSystem.js';
import { StaminaSystem } from '../systems/StaminaSystem.js';
import { FIELD_DEFS } from './fields/index.js';
import { buildEventStory } from './stories.js';

// ── 小工具：地块 ref 口径（外圈数字 idx / 生效小径栅栏 ref）──
const refOf = (tileIdx, tileRef) => (tileRef === undefined || tileRef === null ? tileIdx : tileRef);

// ── 小工具：判断是否为"我的设施"格（外圈 + 生效小径格） ──
const isMine = (gs, refOrIdx, id) => getTile(gs, refOrIdx)?.contentId === id;

// ── 小工具：事件载荷（外圈保持旧字段；栅栏格追加 tileRef / fenceIdx） ──
function tilePayloadOf(gs, ref) {
  return isFenceRef(ref)
    ? { tileIdx: null, tileRef: ref, fenceIdx: fenceIdxOf(gs, ref) }
    : { tileIdx: ref, tileRef: ref };
}

// ── 每日限次 flag key ──
const flagKey = (id, hook) => `${id}_${hook}`;

// ════════════════════════════════════════════════════════════════
// 1. FacilityHome  🏠  —— 家
// ════════════════════════════════════════════════════════════════
const FacilityHome = {
  id: 'facility_home',
  name: '家',
  emoji: Assets.facilities.facility_home,
  value: 0,
  description: ITEMS.facility_home.description,

  register() {
    // 经过时：获得 1 金币（每天限 1 次）
    HookDispatcher.register('onPass', ({ gs, tileIdx, tileRef }) => {
      const ref = refOf(tileIdx, tileRef);
      const tile = getTile(gs, ref);
      if (!tile || tile.contentId !== this.id) return;
      const key = flagKey(this.id, 'onPass');
      if (tile.dailyFlags[key]) return;
      tile.dailyFlags[key] = true;
      addGold(gs, 1, 'facility_home:onPass');
      EventBus.emit(GE.TOAST_SHOW, { text: '🏠 经过家 +1 🪙', duration: 1500 });
    }, this);

    // 进入时：获得 1 金币（每天限 1 次）
    HookDispatcher.register('onEnter', ({ gs, tileIdx, tileRef }) => {
      const ref = refOf(tileIdx, tileRef);
      const tile = getTile(gs, ref);
      if (!tile || tile.contentId !== this.id) return;
      const key = flagKey(this.id, 'onEnter');
      if (tile.dailyFlags[key]) return;
      tile.dailyFlags[key] = true;
      addGold(gs, 1, 'facility_home:onEnter');
      EventBus.emit(GE.TOAST_SHOW, { text: '🏠 进入家 +1 🪙', duration: 1500 });
    }, this);

    // 受祝福时：获得 1 金币（不限次）
    HookDispatcher.register('onBlessed', ({ gs, tileIdx, tileRef }) => {
      if (!isMine(gs, refOf(tileIdx, tileRef), this.id)) return;
      addGold(gs, 1, 'facility_home:onBlessed');
      EventBus.emit(GE.TOAST_SHOW, { text: '✨ 家受祝福 +1 🪙', duration: 1500 });
    }, this);

    // 睡觉时：回满行动力（SleepSystem 主逻辑已在执行前判断，这里留钩子供扩展）
    HookDispatcher.register('onSleep', ({ gs }) => {
      const cur = getTile(gs, playerRef(gs));
      if (!cur || cur.contentId !== this.id) return;
      if (gs.player.stamina < gs.player.maxStamina) {
        const extra = 0; // Phase 2A 暂无额外
        if (extra > 0) {
          StaminaSystem.gainStaminaFlat(gs, extra, { reason: 'facility_home' });
        }
      }
    }, this);
  },
};

// ════════════════════════════════════════════════════════════════
// 2. FacilityTent  ⛺  —— 帐篷
// 【睡觉时】改为回满行动力
// 【受祝福时】下 1 次使用该帐篷睡觉时 +3 行动力
// ════════════════════════════════════════════════════════════════
const FacilityTent = {
  id: 'facility_tent',
  name: '帐篷',
  emoji: Assets.facilities.facility_tent,
  value: 5,
  description: ITEMS.facility_tent.description,

  register() {
    // onSleep：帐篷睡觉时回满（此处处理"受祝福时额外 +3"——
    // 用独立的 tent_bless state，避免 DaySystem 先清除 1 天 blessed 导致丢失）
    // +3 属于「允许超出上限的额外增加」，必须在回满之后结算且可超上限：
    //   这里只把奖励累加到 gs.pendingSleepStaminaBonus，由 SleepSystem 统一走 StaminaSystem 结算。
    HookDispatcher.register('onSleep', ({ gs }) => {
      const cur = getTile(gs, playerRef(gs));
      if (!cur || cur.contentId !== this.id) return;
      const tentBless = cur.states?.find(s => s.type === 'tent_bless');
      if (tentBless && tentBless.bonus && tentBless.bonus > 0) {
        const bonus = tentBless.bonus;
        gs.pendingSleepStaminaBonus = (gs.pendingSleepStaminaBonus || 0) + bonus;
        // 一次睡觉消耗一次 bonus（每睡一次减 3，可叠加次数如 +6 → 睡两次）
        tentBless.bonus -= 3;
        if (tentBless.bonus <= 0) {
          cur.states = cur.states.filter(s => s !== tentBless);
        }
        devLog.info('[tent] tent_bless bonus → pendingSleepStaminaBonus, remaining =', tentBless.bonus);
      }
    }, this);

    // onBlessed：push 独立的 tent_bless state（与 1 天 blessed state 分离）
    HookDispatcher.register('onBlessed', ({ gs, tileIdx, tileRef }) => {
      const ref = refOf(tileIdx, tileRef);
      if (!isMine(gs, ref, this.id)) return;
      const tile = getTile(gs, ref);
      let tentBless = tile.states.find(s => s.type === 'tent_bless');
      if (!tentBless) {
        tentBless = { type: 'tent_bless', bonus: 0 };
        tile.states.push(tentBless);
      }
      tentBless.bonus += 3;
      EventBus.emit(GE.TOAST_SHOW, { text: `✨ 帐篷受祝福 → 下次睡 +3 🔷`, duration: 2000 });
      devLog.info('[tent] onBlessed tent_bless.bonus += 3, now =', tentBless.bonus);
    }, this);
  },
};

// ════════════════════════════════════════════════════════════════
// 3. FacilityHenhouse  🐔  —— 鸡舍
// 【进入时】生成 1 只小鸡（每日限 1 次，每个鸡舍至多 4 只）
// 【进入时】取走储存的鸡蛋（至多 10）
// 【受祝福时】属于该鸡舍的随机 1 只小鸡立刻长大
// ════════════════════════════════════════════════════════════════
const FacilityHenhouse = {
  id: 'facility_henhouse',
  name: '鸡舍',
  emoji: Assets.facilities.facility_henhouse,
  value: 6,
  description: ITEMS.facility_henhouse.description,

  register() {
    // 进入时：每日限 1 次生成小鸡（取走鸡蛋已改为 InfoPanel 手动滑动条 §16.4）
    HookDispatcher.register('onEnter', ({ gs, tileIdx, tileRef }) => {
      const ref = refOf(tileIdx, tileRef);
      if (!isMine(gs, ref, this.id)) return;
      const tile = getTile(gs, ref);

      // 生成小鸡（每日限 1 次；每个鸡舍至多 4 只）
      const spawnKey = flagKey(this.id, 'spawn');
      if (!tile.dailyFlags[spawnKey]) {
        // FAC-009「每舍至多 4 只」：按本鸡舍实例计数（sourceTileIdx 归属），
        // 不是按类型全局计数——多个鸡舍各自独立拥有 4 只额度
        const sameHenhouse = gs.creatures.filter(
          c => CreatureSystem.creatureOwnedByTile(gs, c, tile)
        ).length;
        if (sameHenhouse < 4) {
          tile.dailyFlags[spawnKey] = true;
          CreatureSystem.spawnCreature(gs, 'chick', {
            facilityId: this.id,
            sourceTileIdx: isFenceRef(ref) ? null : ref,
            sourceTileRef: ref,
          });
        } else {
          EventBus.emit(GE.TOAST_SHOW, { text: '鸡舍已满 4 只，先收获吧～', duration: 1500 });
        }
      }

      // §13.4 / BIO-002 L 列：来自鸡舍的生物，玩家每次进入鸡舍心情 +1（每日限 1 次）；
      // 其他方式心情固定 0（不在换日结算里无条件结算）
      for (const c of gs.creatures) {
        if (!c || c.hp <= 0 || !CreatureSystem.creatureOwnedByTile(gs, c, tile)) continue;
        if (c.lastHenhouseMoodDay === gs.day) continue;
        c.lastHenhouseMoodDay = gs.day;
        c.mood = Math.min(5, (c.mood || 0) + 1);
      }

      EventBus.emit(GE.TILE_UPDATED, tilePayloadOf(gs, ref));
    }, this);

    // 受祝福时：属于该鸡舍的随机 1 只小鸡立刻长大
    HookDispatcher.register('onBlessed', ({ gs, tileIdx, tileRef }) => {
      const ref = refOf(tileIdx, tileRef);
      if (!isMine(gs, ref, this.id)) return;
      const tile = getTile(gs, ref);
      // 「属于该鸡舍」= 归属本鸡舍实例（稳定 uid，扩建后仍有效）
      const chicks = gs.creatures.filter(
        c => CreatureSystem.creatureOwnedByTile(gs, c, tile) && c.kind === 'chick'
      );
      if (chicks.length > 0) {
        const pick = Random.pick(chicks);
        pick.kind = 'chicken';
        pick.stage = 'adult';
        pick.hp = 100;
        pick.maxHp = 100;
        pick.atk = 0;
        pick.growth = 0;
        pick.growthMax = 0;
        pick.mood = 0;
        EventBus.emit(GE.TOAST_SHOW, { text: `✨ 祝福：有小鸡立刻长大成 🐔`, duration: 1800 });
        devLog.info('[henhouse] onBlessed grew chick → chicken:', pick.id);
      } else {
        EventBus.emit(GE.TOAST_SHOW, { text: '✨ 祝福：没有小鸡可长大', duration: 1500 });
      }
    }, this);
  },
};

// ════════════════════════════════════════════════════════════════
// 4. FacilitySlimehouse  🟢  —— 史莱姆屋
// 【每日开始时】生成 1 只史莱姆（种类随机）
// 【受祝福时】接下来 3 天每日开始时效果触发 2 次
// ════════════════════════════════════════════════════════════════
const FacilitySlimehouse = {
  id: 'facility_slimehouse',
  name: '史莱姆屋',
  emoji: Assets.facilities.facility_slimehouse,
  value: 6,
  description: ITEMS.facility_slimehouse.description,

  register() {
    // onDailyStart：生成史莱姆（祝福 3 天内 ×2）
    HookDispatcher.register('onDailyStart', ({ gs }) => {
      for (const { ref, tile: t } of contentEntries(gs)) {
        if (t.contentId !== this.id) continue;
        let times = 1;
        // 受祝福 3 天每日 ×2（独立的 slime_bless state，与 1 天 blessed 分离）
        const slimeBlessStates = (t.states || []).filter(s => s.type === 'slime_bless');
        for (const bs of slimeBlessStates) {
          if (bs.remainingDays && bs.remainingDays > 0) {
            times = 2;
            bs.remainingDays -= 1;
          }
        }
        // 清理已过期的
        t.states = (t.states || []).filter(s =>
          !(s.type === 'slime_bless' && s.remainingDays !== undefined && s.remainingDays <= 0),
        );

        for (let i = 0; i < times; i++) {
          const kind = Random.pick(SLIME_KINDS);
          if (kind) {
            // sourceTileIdx / sourceTileRef = 本设施实例所在格，作为开关门/容量的归属键
            CreatureSystem.spawnCreature(gs, kind, {
              facilityId: this.id,
              sourceTileIdx: isFenceRef(ref) ? null : ref,
              sourceTileRef: ref,
            });
          }
        }
      }
    }, this);

    // onBlessed：push 独立 slime_bless state，remainingDays = 3
    HookDispatcher.register('onBlessed', ({ gs, tileIdx, tileRef }) => {
      const ref = refOf(tileIdx, tileRef);
      if (!isMine(gs, ref, this.id)) return;
      const tile = getTile(gs, ref);
      let sb = tile.states.find(s => s.type === 'slime_bless');
      if (!sb) {
        sb = { type: 'slime_bless', remainingDays: 3 };
        tile.states.push(sb);
      } else {
        sb.remainingDays += 3; // 可叠加
      }
      EventBus.emit(GE.TOAST_SHOW, { text: `✨ 史莱姆屋受祝福 → 未来 ${sb.remainingDays} 天每次 ×2`, duration: 2200 });
      devLog.info('[slimehouse] onBlessed slime_bless remainingDays =', sb.remainingDays);
    }, this);
  },
};

// ════════════════════════════════════════════════════════════════
// ——— 资源类地块内容（6 种，共用同一套 HookDispatcher 注册方式）——
// ════════════════════════════════════════════════════════════════

// ── RES-001 事件点 ──
// 【进入时】遇到随机事件（每日限一次）；【受祝福时】显示今日此事件具体内容。
// 不观测不抽取，只在「进入事件格」或「该格受祝福」时才真正抽取（懒抽取）。
// 抽中后把本格本日固定为该事件（eventTodayId），受祝福与进入复用同一条目。
// 进入事件只展示正文，不在此处结算；结算效果由玩家确认选项后
// StoryUI → applyEventEffects 执行，同一选项只执行一次。受祝福预览不结算。
function resolveEventTile(gs, ref, blessed) {
  const tile = getTile(gs, ref);
  if (!tile) return;
  const st = (tile.contentState ||= {});
  const legacyIdx = isFenceRef(ref) ? null : ref;

  // 本格今日已固定的事件（受祝福揭露 / 进入时抽中）优先复用
  let entry = getEventDef(st.eventTodayId);
  if (!entry) {
    entry = drawEventDef(gs);
    if (!entry) return;
    st.eventTodayId = entry.id;
  }

  if (blessed) {
    // 受祝福：只揭露「今日此事件具体内容」，不结算；
    // 该信息只写入地块内容，由信息区「地块内容」展示，不发屏幕中间的冒泡提醒。
    st.eventPreviewId = entry.id;
    st.eventPreviewName = entry.name;
    markEventRevealed(gs, entry);
  } else {
    // 进入：本日固定事件直接使用；进入即记录占用（一次性事件就此消耗）
    markEventEntered(gs, entry);
    st.eventPreviewId = null;
    // 允许事件按本次进入生成运行时数据（如摊位商品与实付价），不污染共享定义
    const runtimeDef = typeof entry.prepare === 'function'
      ? entry.prepare(gs, { tileIdx: legacyIdx, tileRef: ref })
      : entry;
    const script = buildEventStory(runtimeDef);
    if (!script) return;
    // 真正进入事件点时打开剧情区 + 选项区（节点表由条目数据生成，UI 不写死文案）
    // 进入即不结算：数值/物品/地形等变化一律由玩家确认的选项 effects 决定。
    EventBus.emit(GE.STORY_SHOW, {
      script,
      ctx: { tileIdx: legacyIdx, tileRef: ref, eventId: entry.id, option: null },
    });
  }
  HookDispatcher.fire('onEventResolve', {
    gs, tileIdx: legacyIdx, tileRef: ref, type: 'event', eventId: entry.id, blessed,
  });
}

const ResourceEvent = {
  id: 'resource_event',
  name: '事件点',
  emoji: Assets.resources.resource_event,
  value: 5,
  description: ITEMS.resource_event.description,
  register() {
    HookDispatcher.register('onEnter', ({ gs, tileIdx, tileRef }) => {
      const ref = refOf(tileIdx, tileRef);
      if (!isMine(gs, ref, this.id)) return;
      const tile = getTile(gs, ref);
      const key = flagKey(this.id, 'onEnter');
      if (tile.dailyFlags[key]) return;
      tile.dailyFlags[key] = true;
      resolveEventTile(gs, ref, false);
    }, this);

    HookDispatcher.register('onBlessed', ({ gs, tileIdx, tileRef }) => {
      const ref = refOf(tileIdx, tileRef);
      if (!isMine(gs, ref, this.id)) return;
      const tile = getTile(gs, ref);
      tile.contentState = tile.contentState || {};
      tile.contentState.eventBlessed = true; // 事件池录入后用于「显示今日具体内容」
      resolveEventTile(gs, ref, true);
    }, this);
  },
};

// ── RES-002 奖励点 ──
// 【进入时】获得随机奖励（每日限一次）；【受祝福时】下次进入高价值奖励概率提升。
function resolveRewardTile(gs, ref) {
  const tile = getTile(gs, ref);
  if (!tile) return;
  const st = tile.contentState = tile.contentState || {};
  const blessed = !!st.rewardBlessPending;
  if (blessed) st.rewardBlessPending = false; // 消耗「下次进入高价值奖励概率提升」
  const entry = drawReward(blessed); // 受祝福 → 高价值条目权重提升
  if (!entry) return;
  const summary = grantReward(gs, entry);
  HookDispatcher.fire('onEventResolve', {
    gs,
    tileIdx: isFenceRef(ref) ? null : ref,
    tileRef: ref,
    type: 'reward',
    rewardId: entry.id,
    blessed,
  });
  EventBus.emit(GE.TOAST_SHOW, { text: `🎁 ${entry.name} → ${summary}`, duration: 2000 });
}

const ResourceReward = {
  id: 'resource_reward',
  name: '奖励点',
  emoji: Assets.resources.resource_reward,
  value: 8,
  description: ITEMS.resource_reward.description,
  register() {
    HookDispatcher.register('onEnter', ({ gs, tileIdx, tileRef }) => {
      const ref = refOf(tileIdx, tileRef);
      if (!isMine(gs, ref, this.id)) return;
      const tile = getTile(gs, ref);
      const key = flagKey(this.id, 'onEnter');
      if (tile.dailyFlags[key]) return;
      tile.dailyFlags[key] = true;
      resolveRewardTile(gs, ref);
    }, this);

    HookDispatcher.register('onBlessed', ({ gs, tileIdx, tileRef }) => {
      const ref = refOf(tileIdx, tileRef);
      if (!isMine(gs, ref, this.id)) return;
      const tile = getTile(gs, ref);
      tile.contentState = tile.contentState || {};
      tile.contentState.rewardBlessPending = true;
      EventBus.emit(GE.TOAST_SHOW, { text: '✨ 奖励点受祝福 → 下次进入高价值奖励概率提升', duration: 2000 });
    }, this);
  },
};

// ── RES-003 狩猎点 ──
// 【进入时】可狩猎，概率获得随机生物（每日限一次）
// 功能：狩猎普通生物（每日 40%~90%）/ 狩猎危险生物（每日 15%~75%）
// 备注：受祝福时当日所有选项成功率 +50%，超出 100% 按 100% 计。
const HUNT_RATES = {
  normal: { min: 0.40, max: 0.90 },
  danger: { min: 0.15, max: 0.75 },
};

/**
 * 执行一次狩猎（每日限一次，成败均消耗次数）。
 * @param {number|object} refOrIdx 外圈 idx 或栅栏 ref
 * @param {'normal'|'danger'} option 狩猎普通生物 / 狩猎危险生物
 * @returns {{ok:boolean, success?:boolean, rate?:number, kind?:string, reason?:string}}
 */
export function huntCreature(gs, refOrIdx, option) {
  const tile = getTile(gs, refOrIdx);
  if (!tile || tile.contentId !== 'resource_hunt') return { ok: false, reason: 'notHuntTile' };
  const legacyIdx = isFenceRef(refOrIdx) ? null : refOrIdx;
  const range = HUNT_RATES[option];
  if (!range) return { ok: false, reason: 'badOption' };
  const key = flagKey('resource_hunt', 'hunt');
  if (tile.dailyFlags[key]) return { ok: false, reason: 'alreadyHunted' };

  // 候选生物（生物池 POOL-02 按类别过滤）：
  //   普通生物 → 友善类（小鸡/鸡）；危险生物 → 史莱姆条目（展开为七种元素史莱姆等概率随机一种）
  const cat = option === 'normal' ? 'friendly' : 'danger';
  const candidates = (POOLS['POOL-02']?.entries || []).filter((e) => {
    if (e.id === 'slime') return cat === 'danger';
    const def = CREATURES[e.id];
    return !!def && def.category === cat;
  });
  if (!candidates.length) return { ok: false, reason: 'noPoolCandidate' };

  tile.dailyFlags[key] = true; // 每日限一次：成败都消耗

  // 成功率在区间内随机；受祝福 → +50%，超出 100% 按 100% 计（RES-003 备注）
  // 祝福按地块记账 —— huntBlessPending 记在本格，仅本格下一次狩猎消费
  let rate = range.min + Math.random() * (range.max - range.min);
  const st = (tile.contentState = tile.contentState || {});
  if (st.huntBlessPending) {
    rate = Math.min(1, rate + 0.5);
    st.huntBlessPending = false;
  }

  if (!Random.chance(rate)) {
    EventBus.emit(GE.TOAST_SHOW, { text: `🏹 狩猎失败（成功率 ${(rate * 100).toFixed(0)}%）`, duration: 2000 });
    HookDispatcher.fire('onEventResolve', {
      gs, tileIdx: legacyIdx, tileRef: refOrIdx, type: 'hunt', option, success: false,
    });
    return { ok: true, success: false, rate };
  }

  // 成功 → 获得随机生物（自动进栅栏，容量超出也允许，超载惩罚见 §13.2）
  const picked = Random.pick(candidates);
  const kind = picked.id === 'slime' ? Random.pick(SLIME_KINDS) : picked.id;

  const creature = CreatureSystem.spawnCreature(gs, kind, { facilityId: 'resource_hunt', sourceTileIdx: null });
  if (!creature) return { ok: false, reason: 'fenceFull' };
  EventBus.emit(GE.TOAST_SHOW, {
    text: `🏹 狩猎成功：${CREATURES[kind].emoji} ${CREATURES[kind].name}（成功率 ${(rate * 100).toFixed(0)}%）`,
    duration: 2200,
  });
  HookDispatcher.fire('onEventResolve', {
    gs, tileIdx: legacyIdx, tileRef: refOrIdx, type: 'hunt', option, success: true, kind,
  });
  return { ok: true, success: true, rate, kind };
}

const ResourceHunt = {
  id: 'resource_hunt',
  name: '狩猎点',
  emoji: Assets.resources.resource_hunt,
  value: 5,
  description: ITEMS.resource_hunt.description,
  register() {
    // 狩猎需玩家选择目标（普通/危险），交互入口在 InfoPanel 功能选项；进入时仅提示
    HookDispatcher.register('onEnter', ({ gs, tileIdx, tileRef }) => {
      const ref = refOf(tileIdx, tileRef);
      if (!isMine(gs, ref, this.id)) return;
      const tile = getTile(gs, ref);
      if (tile.dailyFlags[flagKey(this.id, 'hunt')]) return;
      EventBus.emit(GE.TOAST_SHOW, { text: '🏹 狩猎点：选择狩猎目标（普通/危险）', duration: 1600 });
    }, this);

    // 受祝福：下一次进入本格狩猎地块时狩猎成功率 +50%（超出 100% 按 100% 计）
    // 按地块记账（不是全局下次）——记在本狩猎格的 tile.contentState.huntBlessPending，
    //   仅本格下一次狩猎时消费；其他狩猎格不受影响。
    HookDispatcher.register('onBlessed', ({ gs, tileIdx, tileRef }) => {
      const ref = refOf(tileIdx, tileRef);
      if (!isMine(gs, ref, this.id)) return;
      const tile = getTile(gs, ref);
      tile.contentState = tile.contentState || {};
      tile.contentState.huntBlessPending = true;
      EventBus.emit(GE.TOAST_SHOW, { text: '✨ 狩猎受祝福 → 下一次进入本格狩猎地块时成功率 +50%', duration: 2000 });
    }, this);
  },
};

const ResourceShop = {
  id: 'resource_shop',
  name: '商店',
  emoji: Assets.resources.resource_shop,
  value: 1,
  description: ITEMS.resource_shop.description,
  register() {
    // 踩格不自动进入商店，由信息区「进入商店」功能选项进入
    HookDispatcher.register('onBlessed', ({ gs, tileIdx, tileRef }) => {
      const ref = refOf(tileIdx, tileRef);
      if (!isMine(gs, ref, this.id)) return;
      const shop = ShopSystem.getShop(gs, ref);
      if (shop) shop.discountPending = true;
      EventBus.emit(GE.TOAST_SHOW, { text: '✨ 商店受祝福 → 下次进入有打折商品', duration: 2000 });
    }, this);
  },
};

const ResourceBus = {
  id: 'resource_bus',
  name: '巴士站',
  emoji: Assets.resources.resource_bus,
  value: 5,
  description: ITEMS.resource_bus.description,
  register() {
    // RES-005 / OUT-17：每日限一次只标注在「行动力 +1」上；轮子每次进入都给
    HookDispatcher.register('onEnter', ({ gs, tileIdx, tileRef }) => {
      const ref = refOf(tileIdx, tileRef);
      if (!isMine(gs, ref, this.id)) return;
      const tile = getTile(gs, ref);

      // 行动力 +1（每日限一次；数值直接增加，允许超出上限，统一走 StaminaSystem 结算）
      const staminaKey = flagKey(this.id, 'onEnter_stamina');
      if (!tile.dailyFlags[staminaKey]) {
        tile.dailyFlags[staminaKey] = true;
        StaminaSystem.gainStaminaFlat(gs, 1, { reason: 'resource_bus' });
        EventBus.emit(GE.TOAST_SHOW, { text: '🚌 巴士站：行动力 +1', duration: 1500 });
      }

      // 获得 1 轮子（无每日限次）
      VehicleSystem.gainVehicle(gs, 'vehicle_wheel');
      devLog.info('[bus] onEnter stamina(daily) + wheel');
    }, this);

    // RES-005 / OUT-18：受祝福 → 获得 1 随机载具（载具池 1 = POOL-04）；载具进载具页手动装备
    HookDispatcher.register('onBlessed', ({ gs, tileIdx, tileRef }) => {
      if (!isMine(gs, refOf(tileIdx, tileRef), this.id)) return;
      const [hit] = drawFromPool('POOL-04', 1, { gs });
      const vehId = hit ? ITEM_TO_VEHICLE[hit.id] : null;
      if (!vehId) {
        devLog.warn('[bus] onBlessed 载具池 1 未抽到可映射载具:', hit?.id);
        return;
      }
      VehicleSystem.gainVehicle(gs, vehId);
      EventBus.emit(GE.TOAST_SHOW, {
        text: `✨ 巴士站受祝福：获得载具 ${VEHICLES[vehId]?.emoji || ''} ${VEHICLES[vehId]?.name || vehId}（载具页手动装备）`,
        duration: 2200,
      });
    }, this);
  },
};

// ── RES-006 魔法商店 🔮 ──
// 【进入时】可进入魔法商店；【受祝福时】下一次进入时首次刷新免费
// 每日至多放置 1 个；场上总数上限 2
const ResourceMagicShop = {
  id: 'resource_magic_shop',
  name: '魔法商店',
  emoji: Assets.resources.resource_magic_shop,
  value: 1,
  description: ITEMS.resource_magic_shop.description,

  register() {
    // §11.2 / §16.4 / §16.22：踩格不自动进入魔法商店，与普通商店同一套交互 ——
    // 由信息区「地块内容」tab 的功能选项「进入魔法商店」点击进入。
    // 「离开后本回合不可再进入」由 ShopSystem.enterShop 的 leftAtTurn 检查执行。
    HookDispatcher.register('onBlessed', ({ gs, tileIdx, tileRef }) => {
      const ref = refOf(tileIdx, tileRef);
      if (!isMine(gs, ref, this.id)) return;
      ShopSystem.grantFreeRefresh(gs, ref);
      EventBus.emit(GE.TOAST_SHOW, { text: '✨ 下次进入魔法商店，首次刷新免费', duration: 2000 });
    }, this);
  },
};

// ════════════════════════════════════════════════════════════════
// ——— 技能卡地块内容（skill_*） —— Phase 4 ———
// 技能卡作为 contentId 放进 outerTiles 后，触发由 SkillSystem.triggerSkillByHook 统一处理。
// 不再注册 HookDispatcher hook，不再消耗 tile.contentId（持续存在持续触发）。
// ════════════════════════════════════════════════════════════════

/** 技能卡元数据：仅提供 id/name/emoji 供 UI 渲染（SkillSystem 统一处理触发） */
export const SKILL_FACILITIES = Object.values(SKILLS).map((skill) => ({
  id: skill.id,
  name: skill.name,
  emoji: skill.emoji,
}));

export function registerSkillHooks() {
  // 技能触发已由 SkillSystem.triggerSkillByHook 统一处理
  // 此处不再注册 HookDispatcher hook；连携技也由 LinkSkillSystem 实时窗口处理
  console.log('[facilities] SKILL_FACILITIES metadata-only (no hooks registered, SkillSystem handles trigger)');
}

// ════════════════════════════════════════════════════════════════
// 统一注册 + 导出
// ════════════════════════════════════════════════════════════════

export const ALL_FACILITIES = [
  // 4 种设施（FAC-009 ~ FAC-012）
  FacilityHome, FacilityTent, FacilityHenhouse, FacilitySlimehouse,
  // 21 种田块（一田块一文件，见 data/fields/）
  ...FIELD_DEFS,
  // 6 种资源类地块内容（RES-001 ~ RES-006）
  ResourceEvent, ResourceReward, ResourceHunt, ResourceShop, ResourceBus, ResourceMagicShop,
];

/**
 * 统一注册所有设施/资源/田块的 hook
 * GameDirector.start() 时调用一次
 */
export function registerFacilities() {
  for (const f of ALL_FACILITIES) {
    if (typeof f.register === 'function') f.register();
  }
  registerSkillHooks();
  // 打印各 hook 已注册数量（验收用）
  const hookSummary = [
    'onEnter', 'onPass', 'onBlessed', 'onDailyStart', 'onSleep',
    'onReplace', 'onUseSkill', 'onEveryNTurn', 'onCreatureAdded',
  ].map(t => `${t}=${HookDispatcher.count(t)}`).join(' | ');
  const total = HookDispatcher.count('onEnter') + HookDispatcher.count('onPass') +
                HookDispatcher.count('onBlessed') + HookDispatcher.count('onDailyStart') +
                HookDispatcher.count('onSleep') + HookDispatcher.count('onReplace') +
                HookDispatcher.count('onUseSkill') + HookDispatcher.count('onEveryNTurn') +
                HookDispatcher.count('onCreatureAdded');
  devLog.info('Phase 4 完整 hook 注册完成  总数=' + total, '\n  ', hookSummary);
}

/**
 * 获取某 contentId 对应的设施/资源/田块对象（UI 渲染时查表用）
 */
export function getDef(contentId) {
  return ALL_FACILITIES.find(f => f.id === contentId) || null;
}
