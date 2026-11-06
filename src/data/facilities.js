// src/data/facilities.js
// Phase 2A 完整版设施定义：10 种设施 + 5 种资源类地块内容（共 15 种）
// 每种对象：{ id, name, emoji, register() }
// register() 里通过 HookDispatcher.register(hookType, cb) 把【】词条挂到分发器
// 回调 params 形状：{ gs, tileIdx }   （BlessSystem/BuildSystem/onSleep 等场景可能额外带字段）
//
// 核心约定：
//   - 判断"当前格是我这种设施"必须用 gs.map.outerTiles[tileIdx].contentId === this.id
//     绝对不能用 tileIdx === 硬编码数字（Phase 1 home 原来的 tileIdx===6 必须改！）
//   - 每日限次：用 tile.dailyFlags['facility_<id>_<hookType>'] === true 存布尔
//     DaySystem.startNewDay() 已统一把 dailyFlags 全部重置为 {}
//   - henhouse/slimehouse 的核心效果（生成生物）因 CreatureSystem 是 Phase 3 才创建，
//     这里只写 Toast 占位，Phase 3 agent 接手替换为真正的 CreatureSystem 调用

import { HookDispatcher } from '../core/HookDispatcher.js';
import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { Assets } from '../core/Assets.js';
import { devLog } from '../core/Logger.js';
import { InventorySystem } from '../systems/InventorySystem.js';
import { VehicleSystem } from '../systems/VehicleSystem.js';
import { Distance } from '../core/Distance.js';
import { CreatureSystem } from '../systems/CreatureSystem.js';
import { CombatSystem } from '../systems/CombatSystem.js';
import { Random } from '../core/Random.js';
import { CREATURES, SLIME_KINDS, getCreatureDef } from './creatures.js';
import { SKILLS } from './characters.js';
import { normalizeTerrain } from './terrains.js';
import { ITEMS, POOLS } from './items.js';
import { ITEM_TO_VEHICLE, VEHICLES } from './vehicles.js';
import { drawFromPool } from '../systems/RandomPool.js';
import {
  EVENT_POOL_PLACEHOLDER,
  drawPlaceholderEvent,
  applyPlaceholderEventEffect,
  drawPlaceholderReward,
  grantPlaceholderReward,
} from './placeholderPools.js';
import { HealSystem } from '../systems/HealSystem.js';
import { ShopSystem } from '../systems/ShopSystem.js';
import { StaminaSystem } from '../systems/StaminaSystem.js';
import { syncPumpkin, hasGrimoire, hasConnectedRice } from '../systems/PassiveItemSystem.js';

// ── 小工具：判断是否为"我的设施"格 ──
const isMine = (gs, tileIdx, id) => gs.map.outerTiles[tileIdx]?.contentId === id;

// ── 每日限次 flag key ──
const flagKey = (id, hook) => `${id}_${hook}`;

// ── 小工具：相邻水面检查（用于稻田每日产出 +2）──
function hasAdjacentWater(gs, tileIdx) {
  const neighbors = Distance.outerNeighbors(gs.map.size, tileIdx);
  for (const nIdx of neighbors) {
    if (nIdx === null || nIdx === undefined) continue;
    const nTile = gs.map.outerTiles[nIdx];
    if (nTile && normalizeTerrain(nTile.terrain) === 'terrain_water') return true;
  }
  return false;
}

// ════════════════════════════════════════════════════════════════
// 1. FacilityHome  🏠  —— 家（Phase 1 极简版已写，这里 refactor 为 contentId 判定 + 新增 hook）
// ════════════════════════════════════════════════════════════════
const FacilityHome = {
  id: 'facility_home',
  name: '家',
  emoji: Assets.facilities.facility_home,
  value: 0,
  description: ITEMS.facility_home.description,

  register() {
    // 经过时：获得 1 金币（每天限 1 次）
    HookDispatcher.register('onPass', ({ gs, tileIdx }) => {
      if (!isMine(gs, tileIdx, this.id)) return;
      const key = flagKey(this.id, 'onPass');
      if (gs.map.outerTiles[tileIdx].dailyFlags[key]) return;
      gs.map.outerTiles[tileIdx].dailyFlags[key] = true;
      gs.player.gold += 1;
      EventBus.emit(GE.GOLD_CHANGE, { newValue: gs.player.gold, delta: 1 });
      EventBus.emit(GE.TOAST_SHOW, { text: '🏠 经过家 +1 🪙', duration: 1500 });
    }, this);

    // 进入时：获得 1 金币（每天限 1 次）
    HookDispatcher.register('onEnter', ({ gs, tileIdx }) => {
      if (!isMine(gs, tileIdx, this.id)) return;
      const key = flagKey(this.id, 'onEnter');
      if (gs.map.outerTiles[tileIdx].dailyFlags[key]) return;
      gs.map.outerTiles[tileIdx].dailyFlags[key] = true;
      gs.player.gold += 1;
      EventBus.emit(GE.GOLD_CHANGE, { newValue: gs.player.gold, delta: 1 });
      EventBus.emit(GE.TOAST_SHOW, { text: '🏠 进入家 +1 🪙', duration: 1500 });
    }, this);

    // 受祝福时：获得 1 金币（不限次）
    HookDispatcher.register('onBlessed', ({ gs, tileIdx }) => {
      if (!isMine(gs, tileIdx, this.id)) return;
      gs.player.gold += 1;
      EventBus.emit(GE.GOLD_CHANGE, { newValue: gs.player.gold, delta: 1 });
      EventBus.emit(GE.TOAST_SHOW, { text: '✨ 家受祝福 +1 🪙', duration: 1500 });
    }, this);

    // 睡觉时：回满行动力（由 SleepSystem 主动 fire，此处只覆盖非 home/tent 睡的默认值 —— 实际上
    // SleepSystem 会检查当前 tile.contentId，若 home/tent 它自己就回满了；这里留钩子供扩展）
    HookDispatcher.register('onSleep', ({ gs }) => {
      const cur = gs.map.outerTiles[gs.player.x];
      if (!cur || cur.contentId !== this.id) return;
      // SleepSystem 主逻辑已在执行前判断，但 hook 仍触发以支持"被祝福时额外回满 +3"等扩展
      if (gs.player.stamina < gs.player.maxStamina) {
        const extra = 0; // Phase 2A 暂无额外
        if (extra > 0) {
          StaminaSystem.settleStamina(gs, extra, { reason: 'facility_home' });
        }
      }
    }, this);
  },
};

// ════════════════════════════════════════════════════════════════
// 2. FacilityTent  ⛺  —— 帐篷
// 【睡觉时】改为回满行动力
// 【受祝福时】下 1 次使用该帐篷睡觉时 +3 行动力
// v0.5：已删除【替换时】词条 —— 被替换时旧内容与其它设施一样直接消失。
// ════════════════════════════════════════════════════════════════
const FacilityTent = {
  id: 'facility_tent',
  name: '帐篷',
  emoji: Assets.facilities.facility_tent,
  value: 5,
  description: ITEMS.facility_tent.description,

  register() {
    // onSleep：帐篷睡觉时回满（SleepSystem 主逻辑已在执行前判断，此处处理"受祝福时额外 +3"——
    // 用独立的 tent_bless state（与 1 天 blessed state 分离，避免 DaySystem 先清除导致丢失）
    // 2026-11-03 裁决：+3 属于「允许超出上限的额外增加」，必须在回满之后结算且可超上限。
    //   因此这里不直接改 stamina，只把奖励累加到 gs.pendingSleepStaminaBonus，
    //   由 SleepSystem 在「回满」结算之后统一走 StaminaSystem 结算。
    HookDispatcher.register('onSleep', ({ gs }) => {
      const cur = gs.map.outerTiles[gs.player.x];
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
    HookDispatcher.register('onBlessed', ({ gs, tileIdx }) => {
      if (!isMine(gs, tileIdx, this.id)) return;
      const tile = gs.map.outerTiles[tileIdx];
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
// 3. FacilityWheat  🌾  —— 麦田
// 【每一日开始时】获得小麦 ×2（草地额外 ×1）
// 【受祝福时】获得小麦 ×3
// ════════════════════════════════════════════════════════════════
const FacilityWheat = {
  id: 'facility_wheat',
  name: '小麦田块',
  emoji: Assets.facilities.facility_wheat,
  value: 3,
  description: ITEMS.facility_wheat.description,

  register() {
    // onDailyStart：找所有麦田格，每格 ×2（草地 +1），总计加背包
    // 注意：不要检查 tile.states.some(s=>s.type==='blessed') —— DaySystem 会先清除 1 天 blessed
    // 再 fire onDailyStart。小麦的【受祝福时】效果由 wheat.onBlessed hook 立即触发（×3），
    // 不跨日，所以这里只需处理每日基础产出即可。
    HookDispatcher.register('onDailyStart', ({ gs }) => {
      // §13.2：友善超载惩罚「友善类收益归 0」明确排除小麦/水稻 —— 小麦产出不受惩罚影响
      const tiles = gs.map.outerTiles.filter(t => t.contentId === this.id);
      let total = 0;
      for (const t of tiles) {
        let qty = 2;
        if (normalizeTerrain(t.terrain) === 'terrain_grass') qty += 1;
        total += qty;
      }
      if (total > 0) {
        InventorySystem.addItem(gs, 'item_wheat', total);
        EventBus.emit(GE.TOAST_SHOW, { text: `🌾 每日 +${total} 小麦`, duration: 2000 });
        devLog.info('[wheat] onDailyStart total =', total);
      }
    }, this);

    // onBlessed：祝福发生时立即再触发一次（立即 ×3 产出）
    HookDispatcher.register('onBlessed', ({ gs, tileIdx }) => {
      if (!isMine(gs, tileIdx, this.id)) return;
      const tile = gs.map.outerTiles[tileIdx];
      let qty = 3;
      if (normalizeTerrain(tile.terrain) === 'terrain_grass') qty += 1;
      InventorySystem.addItem(gs, 'item_wheat', qty);
      EventBus.emit(GE.TOAST_SHOW, { text: `🌾 祝福 ×3 +${qty} 小麦`, duration: 2000 });
      devLog.info('[wheat] onBlessed instant +', qty);
    }, this);
  },
};

// ════════════════════════════════════════════════════════════════
// 4. FacilityRice  🌱  —— 稻田
// 【每一日开始时】稻草 ×1（草地 +1，相邻水面 +2）
// 【受祝福时】接下来 5 日每日开始时额外 +1
// Phase 2A 简化：祝福效果通过 tile.states 里存 riceBlessDaysRemaining + dailyBonus 字段实现
// ════════════════════════════════════════════════════════════════
const FacilityRice = {
  id: 'facility_rice',
  name: '水稻田块',
  emoji: Assets.facilities.facility_rice,
  value: 3,
  description: ITEMS.facility_rice.description,

  register() {
    // onDailyStart
    HookDispatcher.register('onDailyStart', ({ gs }) => {
      // §13.2：友善超载惩罚「友善类收益归 0」明确排除小麦/水稻 —— 水稻产出不受惩罚影响
      // B-20：庆丰收翻倍必须按"当日"相连状态即时求值 —— PassiveItemSystem 的 onDailyStart
      //   hook 注册晚于设施（main.js 顺序），只读 gs.flags.riceDouble 会拿到昨天的值。
      if (!gs.flags) gs.flags = {};
      if (hasGrimoire(gs, 'grimoire_harvest_cereal')) {
        gs.flags.riceDouble = hasConnectedRice(gs, 3);
      } else {
        gs.flags.riceDouble = false;
      }
      const tiles = gs.map.outerTiles.filter(t => t.contentId === this.id);
      let totalBase = 0;
      let totalBonusFromBless = 0;

      for (const t of tiles) {
        let qty = 1;
        if (normalizeTerrain(t.terrain) === 'terrain_grass') qty += 1;
        if (hasAdjacentWater(gs, t.idx)) qty += 2;
        // 魔导书【庆丰收】：≥3 个水稻田块相连时，这些水稻田块产出翻倍
        if (gs.flags?.riceDouble) qty *= 2;
        totalBase += qty;

        // 受祝福 5 日额外 +1（独立的 rice_bless state，与 1 天 blessed state 分离）
        const riceBlessStates = (t.states || []).filter(s => s.type === 'rice_bless');
        for (const bs of riceBlessStates) {
          if (bs.remainingDays && bs.remainingDays > 0) {
            totalBonusFromBless += 1;
            bs.remainingDays -= 1;
          }
        }
        // 清理已过期的
        t.states = (t.states || []).filter(s =>
          !(s.type === 'rice_bless' && s.remainingDays !== undefined && s.remainingDays <= 0),
        );
      }

      const total = totalBase + totalBonusFromBless;
      if (total > 0) {
        InventorySystem.addItem(gs, 'item_rice_straw', total);
        const msg = `🌱 每日 +${totalBase} 稻草` + (totalBonusFromBless > 0 ? `（祝福 +${totalBonusFromBless}）` : '');
        EventBus.emit(GE.TOAST_SHOW, { text: msg, duration: 2200 });
      }
    }, this);

    // onBlessed：push 独立 rice_bless state，remainingDays = 5（与 1 天 blessed 分离）
    // Phase 2B：再被祝福时取 Math.max（不叠加）
    HookDispatcher.register('onBlessed', ({ gs, tileIdx }) => {
      if (!isMine(gs, tileIdx, this.id)) return;
      const tile = gs.map.outerTiles[tileIdx];
      let rb = tile.states.find(s => s.type === 'rice_bless');
      if (!rb) {
        rb = { type: 'rice_bless', remainingDays: 5 };
        tile.states.push(rb);
      } else {
        rb.remainingDays = Math.max(rb.remainingDays, 5); // 取最长，不叠加
      }
      EventBus.emit(GE.TOAST_SHOW, { text: `✨ 稻田受祝福 → 未来 ${rb.remainingDays} 日每日 +1 稻草`, duration: 2400 });
      devLog.info('[rice] onBlessed rice_bless remainingDays =', rb.remainingDays);
    }, this);
  },
};

// ════════════════════════════════════════════════════════════════
// 5. FacilityPotato  🥔  —— 土豆田
// 【每一日开始时】储存土豆 ×3（至多 30）—— 储存量存在 tile.contentState.potatoStored
// 【进入时】可以取走储存的土豆
// 【受祝福时】储存土豆 ×5
// ════════════════════════════════════════════════════════════════
const POTATO_MAX_STORED = 30;
const FacilityPotato = {
  id: 'facility_potato',
  name: '土豆田块',
  emoji: Assets.facilities.facility_potato,
  value: 4,
  description: ITEMS.facility_potato.description,

  register() {
    // onDailyStart：所有土豆田 +3（受祝福则 +5），上限 30
    HookDispatcher.register('onDailyStart', ({ gs }) => {
      const tiles = gs.map.outerTiles.filter(t => t.contentId === this.id);
      for (const t of tiles) {
        // 用 tile.dailyFlags 每日标记"今日已储"，避免重复
        const key = flagKey(this.id, 'onDailyStart');
        if (t.dailyFlags[key]) continue;
        t.dailyFlags[key] = true;

        const state = t.contentState || (t.contentState = {});
        let add = 3;
        const blessed = t.states?.some(s => s.type === 'blessed');
        if (blessed) add = 5;
        state.potatoStored = Math.min(POTATO_MAX_STORED, (state.potatoStored || 0) + add);
        devLog.info('[potato] tile', t.idx, 'stored →', state.potatoStored);
      }
      // A-12：田间储存变化 → 同步悲恸南瓜加成
      syncPumpkin(gs);
    }, this);

    // onEnter 自动取走已删除 —— 收获土豆改为 InfoPanel 手动滑动条触发（§16.4）
    HookDispatcher.register('onEnter', ({ gs, tileIdx }) => {
      if (!isMine(gs, tileIdx, this.id)) return;
      // 占位：InfoPanel 手动操作，此处不再自动 InventorySystem.addItem
      devLog.info('[potato] onEnter (manual harvest via InfoPanel now)');
    }, this);

    // onBlessed：储存 +5（立即触发，跳过每日 flag 检查）
    HookDispatcher.register('onBlessed', ({ gs, tileIdx }) => {
      if (!isMine(gs, tileIdx, this.id)) return;
      const tile = gs.map.outerTiles[tileIdx];
      const state = tile.contentState || (tile.contentState = {});
      state.potatoStored = Math.min(POTATO_MAX_STORED, (state.potatoStored || 0) + 5);
      EventBus.emit(GE.TOAST_SHOW, { text: `✨ 祝福储存 +5 土豆（现 ${state.potatoStored}/${POTATO_MAX_STORED}）`, duration: 2000 });
      EventBus.emit(GE.TILE_UPDATED, { tileIdx });
      syncPumpkin(gs); // A-12
    }, this);
  },
};

// ════════════════════════════════════════════════════════════════
// 6. FacilityTulip  🌷  —— 郁金香花田
// 【每一日开始时】价值随机 -4 ~ +10（存在 tile.contentState.tulipValue；对外显示 max(0, val)）
// 【受祝福时】立即触发 2 次每日效果
// Phase 2A：价值存 tile.contentState.tulipValue；取走/采摘由 Phase 2B 处理
// ════════════════════════════════════════════════════════════════
const FacilityTulip = {
  id: 'facility_tulip',
  name: '郁金香花田',
  emoji: Assets.facilities.facility_tulip,
  value: 8,
  description: ITEMS.facility_tulip.description,

  register() {
    HookDispatcher.register('onDailyStart', ({ gs }) => {
      const tiles = gs.map.outerTiles.filter(t => t.contentId === this.id);
      for (const t of tiles) {
        const key = flagKey(this.id, 'onDailyStart');
        if (t.dailyFlags[key]) continue;
        t.dailyFlags[key] = true;
        const state = t.contentState || (t.contentState = {});
        const delta = Math.floor(Math.random() * 15) - 4; // -4 ~ +10
        state.tulipValue = (state.tulipValue || 0) + delta;
        devLog.info('[tulip] tile', t.idx, 'value +', delta, '→', state.tulipValue);
      }
    }, this);

    HookDispatcher.register('onBlessed', ({ gs, tileIdx }) => {
      if (!isMine(gs, tileIdx, this.id)) return;
      const tile = gs.map.outerTiles[tileIdx];
      // 立即触发 2 次每日效果
      for (let i = 0; i < 2; i++) {
        const state = tile.contentState || (tile.contentState = {});
        const delta = Math.floor(Math.random() * 15) - 4;
        state.tulipValue = (state.tulipValue || 0) + delta;
      }
      EventBus.emit(GE.TOAST_SHOW, { text: `✨ 郁金香祝福 +2 次每日效果，当前值 ${Math.max(0, tile.contentState.tulipValue)}`, duration: 2000 });
      EventBus.emit(GE.TILE_UPDATED, { tileIdx });
    }, this);
  },
};

// ════════════════════════════════════════════════════════════════
// 7. FacilityStrawberry  🍓  —— 草莓田
// 【经过时】储存草莓 ×1（至多 5，每天限 1 次）
// 【进入时】若草莓数量已满（≥5），取走所有；不满则什么都不做
// 【受祝福时】储存随机 2 ~ 5 个（不超上限）
// ════════════════════════════════════════════════════════════════
const STRAWBERRY_MAX = 5;
const FacilityStrawberry = {
  id: 'facility_strawberry',
  name: '草莓田块',
  emoji: Assets.facilities.facility_strawberry,
  value: 5,
  description: ITEMS.facility_strawberry.description,

  register() {
    HookDispatcher.register('onPass', ({ gs, tileIdx }) => {
      if (!isMine(gs, tileIdx, this.id)) return;
      // §13.2：友善超载惩罚 → 友善类收益归 0（除小麦/水稻）
      if (gs.capacity?.friendlyOverloaded) return;
      const key = flagKey(this.id, 'onPass');
      if (gs.map.outerTiles[tileIdx].dailyFlags[key]) return;
      gs.map.outerTiles[tileIdx].dailyFlags[key] = true;
      const tile = gs.map.outerTiles[tileIdx];
      const state = tile.contentState || (tile.contentState = {});
      state.strawberryStored = Math.min(STRAWBERRY_MAX, (state.strawberryStored || 0) + 1);
      EventBus.emit(GE.TILE_UPDATED, { tileIdx });
      syncPumpkin(gs); // A-12
    }, this);

    // onEnter 自动取走已删除 —— 满时手动取走改为 InfoPanel 按钮触发（§16.4）
    HookDispatcher.register('onEnter', ({ gs, tileIdx }) => {
      if (!isMine(gs, tileIdx, this.id)) return;
      devLog.info('[strawberry] onEnter (manual full-harvest via InfoPanel now)');
    }, this);

    HookDispatcher.register('onBlessed', ({ gs, tileIdx }) => {
      if (!isMine(gs, tileIdx, this.id)) return;
      // §13.2：友善超载惩罚 → 友善类收益归 0（除小麦/水稻）
      if (gs.capacity?.friendlyOverloaded) return;
      const tile = gs.map.outerTiles[tileIdx];
      const state = tile.contentState || (tile.contentState = {});
      const rnd = Math.floor(Math.random() * 4) + 2; // 2~5
      const before = state.strawberryStored || 0;
      state.strawberryStored = Math.min(STRAWBERRY_MAX, before + rnd);
      const actuallyAdded = state.strawberryStored - before;
      EventBus.emit(GE.TOAST_SHOW, { text: `✨ 祝福储存 +${actuallyAdded} 草莓（上限 ${STRAWBERRY_MAX}）`, duration: 2000 });
      EventBus.emit(GE.TILE_UPDATED, { tileIdx });
      syncPumpkin(gs); // A-12
    }, this);
  },
};

// ════════════════════════════════════════════════════════════════
// 8. FacilityPea  🫛  —— 豌豆架
// 【使用技能时】储存豌豆 ×1（至多 10，每 2 回合限 1 次）—— 每 2 回合用 tile.dailyFlags['pea_last_trigger_turn']
// 【进入时】可以取走储存的豌豆
// 【受祝福时】自动取走储存的豌豆（不用玩家去点）
// onUseSkill 在 Phase 3 SkillSystem 会 fire，Phase 2A 此处先占位注册好
// ════════════════════════════════════════════════════════════════
const PEA_MAX = 10;
const FacilityPea = {
  id: 'facility_pea',
  name: '豌豆田块',
  emoji: Assets.facilities.facility_pea,
  value: 4,
  description: ITEMS.facility_pea.description,

  register() {
    // onUseSkill：每 2 回合限 1 次（用 gs.turn - last >= 2 判断）
    HookDispatcher.register('onUseSkill', ({ gs }) => {
      // §13.2：友善超载惩罚 → 友善类收益归 0（除小麦/水稻）
      if (gs.capacity?.friendlyOverloaded) return;
      const tiles = gs.map.outerTiles.filter(t => t.contentId === this.id);
      for (const t of tiles) {
        const state = t.contentState || (t.contentState = {});
        const lastTurn = state.peaLastSkillTurn ?? -999;
        if (gs.turn - lastTurn < 2) {
          // 距上次不足 2 回合，跳过
          continue;
        }
        state.peaLastSkillTurn = gs.turn;
        state.peaStored = Math.min(PEA_MAX, (state.peaStored || 0) + 1);
        devLog.info('[pea] tile', t.idx, '+1 pea (turn', gs.turn, '), now', state.peaStored);
        EventBus.emit(GE.TILE_UPDATED, { tileIdx: t.idx });
      }
      syncPumpkin(gs); // A-12
    }, this);

    // onEveryNTurn：占位（豌豆架每 2 回合限 1 次，但我们用 turn 差值判断，此处不必实现）
    HookDispatcher.register('onEveryNTurn', () => {
      // 豌豆架每 2 回合限 1 次 —— Phase 2A 暂不主动 fire 此 hook，SkillSystem fire onUseSkill 会做 turn 差判断
    }, this);

    // onEnter 自动取走已删除 —— 收获豌豆改为 InfoPanel 手动滑动条触发（§16.4）
    HookDispatcher.register('onEnter', ({ gs, tileIdx }) => {
      if (!isMine(gs, tileIdx, this.id)) return;
      devLog.info('[pea] onEnter (manual harvest via InfoPanel now)');
    }, this);

    // onBlessed：自动取走储存的豌豆
    HookDispatcher.register('onBlessed', ({ gs, tileIdx }) => {
      if (!isMine(gs, tileIdx, this.id)) return;
      const tile = gs.map.outerTiles[tileIdx];
      const state = tile.contentState || (tile.contentState = {});
      const stored = state.peaStored || 0;
      if (stored > 0) {
        InventorySystem.addItem(gs, 'item_pea', stored);
        state.peaStored = 0;
        EventBus.emit(GE.TOAST_SHOW, { text: `✨ 祝福自动收获 +${stored} 豌豆`, duration: 2000 });
        EventBus.emit(GE.TILE_UPDATED, { tileIdx });
        syncPumpkin(gs); // A-12：取走（储存减少）也要同步
      }
    }, this);
  },
};

// ════════════════════════════════════════════════════════════════
// 9. FacilityHenhouse  🐔  —— 鸡舍（Toast 占位，Phase 3 CreatureSystem 接手）
// 【进入时】生成 1 只小鸡（每日限 1 次，每个鸡舍至多 4 只）—— Toast 占位
// 【进入时】取走储存的鸡蛋（至多 10）—— 2A 实现储存/取走逻辑
// 【受祝福时】属于该鸡舍的随机 1 只小鸡立刻长大 —— Toast 占位
// ════════════════════════════════════════════════════════════════
const EGG_MAX = 10;
const FacilityHenhouse = {
  id: 'facility_henhouse',
  name: '鸡舍',
  emoji: Assets.facilities.facility_henhouse,
  value: 6,
  description: ITEMS.facility_henhouse.description,

  register() {
    // 进入时：每日限 1 次生成小鸡（取走鸡蛋已改为 InfoPanel 手动滑动条 §16.4）
    HookDispatcher.register('onEnter', ({ gs, tileIdx }) => {
      if (!isMine(gs, tileIdx, this.id)) return;
      const tile = gs.map.outerTiles[tileIdx];

      // 生成小鸡（每日限 1 次；每个鸡舍至多 4 只）
      const spawnKey = flagKey(this.id, 'spawn');
      if (!tile.dailyFlags[spawnKey]) {
        // FAC-009「每舍至多 4 只」：按本鸡舍实例计数（sourceTileIdx 归属），
        // 不是按类型全局计数——多个鸡舍各自独立拥有 4 只额度
        const sameHenhouse = gs.creatures.filter(c => c.sourceTileIdx === tileIdx).length;
        if (sameHenhouse < 4) {
          tile.dailyFlags[spawnKey] = true;
          CreatureSystem.spawnCreature(gs, 'chick', { facilityId: this.id, sourceTileIdx: tileIdx });
        } else {
          EventBus.emit(GE.TOAST_SHOW, { text: '鸡舍已满 4 只，先收获吧～', duration: 1500 });
        }
      }

      // §13.3 / BIO-002 L 列：来自鸡舍的生物，玩家每次进入鸡舍心情 +1（每日限 1 次）；
      // 其他方式心情固定 0（不在 dailyTick 无条件结算）
      for (const c of gs.creatures) {
        if (!c || c.hp <= 0 || c.sourceTileIdx !== tileIdx) continue;
        if (c.lastHenhouseMoodDay === gs.day) continue;
        c.lastHenhouseMoodDay = gs.day;
        c.mood = Math.min(5, (c.mood || 0) + 1);
      }

      EventBus.emit(GE.TILE_UPDATED, { tileIdx });
    }, this);

    // 受祝福时：属于该鸡舍的随机 1 只小鸡立刻长大
    HookDispatcher.register('onBlessed', ({ gs, tileIdx }) => {
      if (!isMine(gs, tileIdx, this.id)) return;
      // 「属于该鸡舍」= 来源为本鸡舍实例（sourceTileIdx 归属）
      const chicks = gs.creatures.filter(c => c.sourceTileIdx === tileIdx && c.kind === 'chick');
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
// 10. FacilitySlimehouse  🟢  —— 史莱姆屋（Toast 占位，Phase 3 CreatureSystem 接手）
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
      const tiles = gs.map.outerTiles.filter(t => t.contentId === this.id);
      for (const t of tiles) {
        const state = t.contentState || (t.contentState = {});
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
            CreatureSystem.spawnCreature(gs, kind, { facilityId: this.id });
          }
        }
      }
    }, this);

    // onBlessed：push 独立 slime_bless state，remainingDays = 3
    HookDispatcher.register('onBlessed', ({ gs, tileIdx }) => {
      if (!isMine(gs, tileIdx, this.id)) return;
      const tile = gs.map.outerTiles[tileIdx];
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
// 11. FacilityCorn  🌽  —— 玉米田地
// §10.11
// 【生物增加时】获得玉米 ×1
// 【受祝福时】获得随机 1 个生物（60% 友善 / 40% 危险 / 0% 高危）
// 注意：onCreatureAdded hook 由 CreatureSystem 在 spawnCreature 时 fire（Agent 3 实现）
// ════════════════════════════════════════════════════════════════
const FacilityCorn = {
  id: 'facility_corn',
  name: '玉米田块',
  emoji: '🌽',
  value: 4,
  description: ITEMS.facility_corn.description,

  register() {
    // onCreatureAdded：任何生物（友善/危险/高危）增加时，每块玉米田 +1 玉米
    HookDispatcher.register('onCreatureAdded', ({ gs }) => {
      const tiles = gs.map.outerTiles.filter(t => t.contentId === this.id);
      if (tiles.length === 0) return;
      let total = 0;
      for (const t of tiles) {
        total += 1;
      }
      if (total > 0) {
        InventorySystem.addItem(gs, 'item_corn', total);
        EventBus.emit(GE.TOAST_SHOW, { text: `🌽 生物增加 → +${total} 玉米`, duration: 1800 });
        devLog.info('[corn] onCreatureAdded +', total);
      }
    }, this);

    // onBlessed：获得随机 1 个生物（物品库 FAC-011 / OUT-14：按随机生物池 1 = POOL-02，
    //   抽中类型后等概率随机；池内为 小鸡/母鸡/史莱姆，史莱姆再随机元素变体）
    HookDispatcher.register('onBlessed', ({ gs, tileIdx }) => {
      if (!isMine(gs, tileIdx, this.id)) return;
      const hits = drawFromPool('POOL-02', 1);
      const picked = hits[0];
      if (!picked || !picked.id) return;
      const kind = picked.id === 'slime' ? Random.pick(SLIME_KINDS) : picked.id;
      const creature = CreatureSystem.spawnCreature(gs, kind, { facilityId: this.id, sourceTileIdx: tileIdx });
      if (creature) {
        EventBus.emit(GE.TOAST_SHOW, { text: `🌽 玉米田受祝福 → ${CREATURES[kind].emoji} ${CREATURES[kind].name} 出现`, duration: 2000 });
      } else {
        EventBus.emit(GE.TOAST_SHOW, { text: '🌽 玉米田受祝福 → 围栏已满，无法生成生物', duration: 2000 });
      }
      devLog.info('[corn] onBlessed spawn', kind);
    }, this);
  },
};

// ════════════════════════════════════════════════════════════════
// 12. FacilityCabbage  🥬  —— 卷心菜田地
// §10.12
// 【每一日开始时】获得卷心菜 ×2，然后消耗背包里的一个卷心菜投向最近敌人，造成 20 点草元素伤害
// 【受祝福时】对所有敌人分别投掷一个卷心菜（不消耗背包中的卷心菜）
// 伤害判定由 CombatSystem 实现，Phase 3 接入；Phase 2A 先 +菜 + Toast 占位
// ════════════════════════════════════════════════════════════════
const FacilityCabbage = {
  id: 'facility_cabbage',
  name: '卷心菜田块',
  emoji: '🥬',
  value: 4,
  description: ITEMS.facility_cabbage.description,

  register() {
    // A-8 / L-07：投掷实装（物品库 FAC-012 / OUT-15）
    //   每日开始：+2 卷心菜 → 消耗背包 1 个投向最近敌人（20 草元素伤害）；背包无卷心菜不投
    //   【受祝福时】：下次每日开始对所有敌人分别投掷一个（不消耗背包）
    //   注意：blessed 状态在 DaySystem.startNewDay 第 3 步就被清除（早于第 6 步 onDailyStart），
    //   所以祝福标记必须落在 contentState 上，不能依赖 states 里的 blessed。
    const throwCabbage = (gs, fromTileIdx, target) => {
      CombatSystem.applyElementalDamageToCreature(gs, target, 20, 'grass', { source: 'facility_cabbage' });
      EventBus.emit(GE.TOAST_SHOW, {
        text: `🥬 卷心菜投向 ${getCreatureDef(target.kind)?.name || '敌人'} → 20 草元素伤害`,
        duration: 1600,
      });
      devLog.info('[cabbage] throw →', target.kind, 'from tile', fromTileIdx);
    };

    HookDispatcher.register('onDailyStart', ({ gs }) => {
      const tiles = gs.map.outerTiles.filter(t => t.contentId === this.id);
      for (const t of tiles) {
        const key = flagKey(this.id, 'onDailyStart');
        if (t.dailyFlags[key]) continue;
        t.dailyFlags[key] = true;

        // 1) 先 +2 卷心菜
        InventorySystem.addItem(gs, 'item_cabbage', 2);
        EventBus.emit(GE.TOAST_SHOW, { text: `🥬 每日 +2 卷心菜`, duration: 1500 });

        const enemies = gs.creatures.filter(c => c.category !== 'friendly' && c.hp > 0);
        const blessedThrow = !!t.contentState?.cabbageAllThrowNext;
        if (blessedThrow) {
          // 祝福：对所有敌人分别投掷一个，不消耗背包
          t.contentState.cabbageAllThrowNext = false;
          if (enemies.length === 0) {
            EventBus.emit(GE.TOAST_SHOW, { text: '🥬 祝福投掷：当前没有敌人', duration: 1600 });
          } else {
            for (const c of enemies) throwCabbage(gs, t.idx, c);
          }
          continue;
        }

        // 2) 非祝福：背包里有卷心菜才投（OUT-15：没有则不投）
        if (InventorySystem.countItem(gs, 'item_cabbage') < 1) continue;
        if (enemies.length === 0) continue; // 没有敌人就不消耗
        // 最近敌人：以本块位置为基准（外圈 idx → xy；生物在 (col+1, row+1)）
        const txy = Distance.outerIdxToXY(gs.map.size, t.idx);
        let nearest = null;
        let bestD = Infinity;
        for (const c of enemies) {
          const d = Math.hypot(c.fenceCol + 1 - txy.x, c.fenceRow + 1 - txy.y);
          if (d < bestD) { bestD = d; nearest = c; }
        }
        if (!nearest) continue;
        InventorySystem.removeItem(gs, 'item_cabbage', 1);
        throwCabbage(gs, t.idx, nearest);
      }
    }, this);

    // onBlessed：标记下次每日开始时对全体敌人投掷（不消耗背包）
    HookDispatcher.register('onBlessed', ({ gs, tileIdx }) => {
      if (!isMine(gs, tileIdx, this.id)) return;
      const t = gs.map.outerTiles[tileIdx];
      t.contentState = t.contentState || {};
      t.contentState.cabbageAllThrowNext = true;
      EventBus.emit(GE.TOAST_SHOW, { text: `✨ 卷心菜田受祝福 → 下次每日开始时对全体敌人投掷`, duration: 2200 });
    }, this);
  },
};

// ════════════════════════════════════════════════════════════════
// ——— 资源类地块内容（5 种，共用同一套 HookDispatcher 注册方式）——
// ════════════════════════════════════════════════════════════════

// ── RES-001 事件点 ──
// 物品库：【进入时】遇到随机事件（每日限一次）；【受祝福时】显示今日此事件具体内容。
// 备注：不观测不抽取，只在即将进入或显示时才真正抽取（懒抽取）。
// 2026-11-04 裁决⑥：事件池正式条目未定稿前，使用独立占位数据表（src/data/placeholderPools.js）
//   让流程可跑通；条目均为占位，正式池录入后整组替换该表即可，本函数无需改动。
function resolveEventTile(gs, tileIdx, blessed) {
  // 懒抽取：只在此处（即将进入 / 受祝福显示）才真正抽取
  const st = (gs.map.outerTiles[tileIdx].contentState ||= {});
  let entry;
  let summary = '';
  if (blessed) {
    // 受祝福：仅「显示今日此事件具体内容」——仅当今日已进入过（事件已结算）时复用同一条目，
    //   不重复结算效果；否则视为预览抽取（不结算）
    const todayFired = !!gs.map.outerTiles[tileIdx].dailyFlags[flagKey('resource_event', 'onEnter')];
    entry = (todayFired && EVENT_POOL_PLACEHOLDER.find((e) => e.id === st.eventTodayId)) || drawPlaceholderEvent();
    summary = '（今日事件预览）';
  } else {
    entry = drawPlaceholderEvent();
    st.eventTodayId = entry.id; // 供受祝福时显示同一事件
    summary = applyPlaceholderEventEffect(gs, entry);
  }
  HookDispatcher.fire('onEventResolve', { gs, tileIdx, type: 'event', eventId: entry.id, blessed });
  EventBus.emit(GE.TOAST_SHOW, { text: `🎲 ${entry.name}${summary ? ' → ' + summary : ''}`, duration: 2200 });
}

const ResourceEvent = {
  id: 'resource_event',
  name: '事件点',
  emoji: Assets.resources.resource_event,
  value: 5,
  description: ITEMS.resource_event.description,
  register() {
    HookDispatcher.register('onEnter', ({ gs, tileIdx }) => {
      if (!isMine(gs, tileIdx, this.id)) return;
      const key = flagKey(this.id, 'onEnter');
      if (gs.map.outerTiles[tileIdx].dailyFlags[key]) return;
      gs.map.outerTiles[tileIdx].dailyFlags[key] = true;
      resolveEventTile(gs, tileIdx, false);
    }, this);

    HookDispatcher.register('onBlessed', ({ gs, tileIdx }) => {
      if (!isMine(gs, tileIdx, this.id)) return;
      const tile = gs.map.outerTiles[tileIdx];
      tile.contentState = tile.contentState || {};
      tile.contentState.eventBlessed = true; // 事件池录入后用于「显示今日具体内容」
      resolveEventTile(gs, tileIdx, true);
    }, this);
  },
};

// ── RES-002 奖励点 ──
// 物品库：【进入时】获得随机奖励（每日限一次）；【受祝福时】下次进入高价值奖励概率提升。
// 2026-11-04 裁决⑥：奖励池正式条目未定稿前，使用独立占位数据表（src/data/placeholderPools.js）
//   让流程可跑通；条目均为占位，正式池录入后整组替换该表即可，本函数无需改动。
function resolveRewardTile(gs, tileIdx) {
  const tile = gs.map.outerTiles[tileIdx];
  const st = tile.contentState = tile.contentState || {};
  const blessed = !!st.rewardBlessPending;
  if (blessed) st.rewardBlessPending = false; // 消耗「下次进入高价值奖励概率提升」
  const entry = drawPlaceholderReward(blessed); // 受祝福 → 高价值条目权重提升
  const summary = grantPlaceholderReward(gs, entry);
  HookDispatcher.fire('onEventResolve', { gs, tileIdx, type: 'reward', rewardId: entry.id, blessed });
  EventBus.emit(GE.TOAST_SHOW, { text: `🎁 ${entry.name} → ${summary}`, duration: 2000 });
}

const ResourceReward = {
  id: 'resource_reward',
  name: '奖励点',
  emoji: Assets.resources.resource_reward,
  value: 8,
  description: ITEMS.resource_reward.description,
  register() {
    HookDispatcher.register('onEnter', ({ gs, tileIdx }) => {
      if (!isMine(gs, tileIdx, this.id)) return;
      const key = flagKey(this.id, 'onEnter');
      if (gs.map.outerTiles[tileIdx].dailyFlags[key]) return;
      gs.map.outerTiles[tileIdx].dailyFlags[key] = true;
      resolveRewardTile(gs, tileIdx);
    }, this);

    HookDispatcher.register('onBlessed', ({ gs, tileIdx }) => {
      if (!isMine(gs, tileIdx, this.id)) return;
      const tile = gs.map.outerTiles[tileIdx];
      tile.contentState = tile.contentState || {};
      tile.contentState.rewardBlessPending = true;
      EventBus.emit(GE.TOAST_SHOW, { text: '✨ 奖励点受祝福 → 下次进入高价值奖励概率提升', duration: 2000 });
    }, this);
  },
};

// ── RES-003 狩猎点 ──
// 物品库：【进入时】可狩猎，概率获得随机生物（每日限一次）
// 功能：狩猎普通生物（每日 40%~90%）/ 狩猎危险生物（每日 15%~75%）
// 备注：受祝福时当日所有选项成功率 +50%，超出 100% 按 100% 计。
const HUNT_RATES = {
  normal: { min: 0.40, max: 0.90 },
  danger: { min: 0.15, max: 0.75 },
};

/**
 * 执行一次狩猎（每日限一次，成败均消耗次数）。
 * @param {'normal'|'danger'} option 狩猎普通生物 / 狩猎危险生物
 * @returns {{ok:boolean, success?:boolean, rate?:number, kind?:string, reason?:string}}
 */
export function huntCreature(gs, tileIdx, option) {
  const tile = gs.map.outerTiles[tileIdx];
  if (!tile || tile.contentId !== 'resource_hunt') return { ok: false, reason: 'notHuntTile' };
  const range = HUNT_RATES[option];
  if (!range) return { ok: false, reason: 'badOption' };
  const key = flagKey('resource_hunt', 'hunt');
  if (tile.dailyFlags[key]) return { ok: false, reason: 'alreadyHunted' };

  // 候选生物（生物池 POOL-02 按类别过滤）：
  //   普通生物 → 友善类（小鸡/鸡）；危险生物 → 史莱姆条目（BIO-003：展开为七种元素史莱姆等概率随机一种）
  const cat = option === 'normal' ? 'friendly' : 'danger';
  const candidates = (POOLS['POOL-02']?.entries || []).filter((e) => {
    if (e.id === 'slime') return cat === 'danger';
    const def = CREATURES[e.id];
    return !!def && def.category === cat;
  });
  if (!candidates.length) return { ok: false, reason: 'noPoolCandidate' };

  tile.dailyFlags[key] = true; // 每日限一次：成败都消耗

  // 成功率在区间内随机；受祝福 → +50%，超出 100% 按 100% 计（RES-003 备注）
  // 2026-11-04 裁决④：祝福按地块记账 —— huntBlessPending 记在本格，仅本格下一次狩猎消费
  let rate = range.min + Math.random() * (range.max - range.min);
  const st = (tile.contentState = tile.contentState || {});
  if (st.huntBlessPending) {
    rate = Math.min(1, rate + 0.5);
    st.huntBlessPending = false;
  }

  if (!Random.chance(rate)) {
    EventBus.emit(GE.TOAST_SHOW, { text: `🏹 狩猎失败（成功率 ${(rate * 100).toFixed(0)}%）`, duration: 2000 });
    HookDispatcher.fire('onEventResolve', { gs, tileIdx, type: 'hunt', option, success: false });
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
  HookDispatcher.fire('onEventResolve', { gs, tileIdx, type: 'hunt', option, success: true, kind });
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
    HookDispatcher.register('onEnter', ({ gs, tileIdx }) => {
      if (!isMine(gs, tileIdx, this.id)) return;
      if (gs.map.outerTiles[tileIdx].dailyFlags[flagKey(this.id, 'hunt')]) return;
      EventBus.emit(GE.TOAST_SHOW, { text: '🏹 狩猎点：选择狩猎目标（普通/危险）', duration: 1600 });
    }, this);

    // 受祝福：下一次进入本格狩猎地块时狩猎成功率 +50%（超出 100% 按 100% 计）
    // 2026-11-04 裁决④：按地块记账（不是全局下次）——记在本狩猎格的 tile.contentState.huntBlessPending，
    //   仅本格下一次狩猎时消费；其他狩猎格不受影响。
    HookDispatcher.register('onBlessed', ({ gs, tileIdx }) => {
      if (!isMine(gs, tileIdx, this.id)) return;
      const tile = gs.map.outerTiles[tileIdx];
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
  internalNote: '每日至多放置 1 个；场上上限 2；不在功能区，必须通过地块功能进入',
  register() {
    // §11.1 / §16.4 / §16.21：踩格不自动进入商店，由信息区「进入商店」功能选项进入
    HookDispatcher.register('onBlessed', ({ gs, tileIdx }) => {
      if (!isMine(gs, tileIdx, this.id)) return;
      const shop = ShopSystem.getShop(gs, tileIdx);
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
    HookDispatcher.register('onEnter', ({ gs, tileIdx }) => {
      if (!isMine(gs, tileIdx, this.id)) return;
      const tile = gs.map.outerTiles[tileIdx];

      // 行动力 +1（每日限一次；不允许超出上限，统一走 StaminaSystem 结算）
      const staminaKey = flagKey(this.id, 'onEnter_stamina');
      if (!tile.dailyFlags[staminaKey]) {
        tile.dailyFlags[staminaKey] = true;
        StaminaSystem.settleStamina(gs, 1, { reason: 'resource_bus' });
        EventBus.emit(GE.TOAST_SHOW, { text: '🚌 巴士站：行动力 +1', duration: 1500 });
      }

      // 获得 1 轮子（无每日限次）
      VehicleSystem.gainVehicle(gs, 'vehicle_wheel');
      devLog.info('[bus] onEnter stamina(daily) + wheel');
    }, this);

    // RES-005 / OUT-18：受祝福 → 获得 1 随机载具（载具池 1 = POOL-04）；载具进载具页手动装备
    HookDispatcher.register('onBlessed', ({ gs, tileIdx }) => {
      if (!isMine(gs, tileIdx, this.id)) return;
      const [hit] = drawFromPool('POOL-04', 1);
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

// ════════════════════════════════════════════════════════════════
// v0.5 新增 4 种设施（物品库 FAC-013 ~ FAC-016）
// ════════════════════════════════════════════════════════════════

// ── FAC-013 野生种子 🌱 ──
// 【放置时】变为随机设施（调用【设施池1】= POOL-01）
// 占位物品：平时不进随机池，只有池子候选不足时才补入；允许叠加，无【唯一】
const FacilityWildSeed = {
  id: 'facility_wild_seed',
  name: '野生种子',
  emoji: Assets.facilities.facility_wild_seed,
  value: 1,
  description: ITEMS.facility_wild_seed.description,
  internalNote: '占位物品：允许叠加，没有【唯一】；效果需调用设施池1',

  register() {
    HookDispatcher.register('onPlace', ({ gs, tileIdx }) => {
      const tile = gs.map.outerTiles[tileIdx];
      if (!tile || tile.contentId !== this.id) return;

      // 从设施池1 抽 1 个设施；抽中占位（野生种子）时重抽，避免自己变自己
      let picked = null;
      for (let i = 0; i < 8; i++) {
        const [hit] = drawFromPool('POOL-01', 1, { unique: true });
        if (hit && hit.id && hit.id !== this.id) { picked = hit; break; }
      }
      if (!picked) {
        devLog.warn('[wildSeed] 设施池1 抽不到非占位设施，保持原样');
        return;
      }
      tile.contentId = picked.id;
      EventBus.emit(GE.TILE_UPDATED, { tileIdx });
      EventBus.emit(GE.TOAST_SHOW, { text: `🌱 野生种子长成了 ${ITEMS[picked.id]?.name || picked.name}`, duration: 2200 });
      devLog.info('[wildSeed] →', picked.id);
    }, this);
  },
};

// ── FAC-014 蒲公英田地 🌼 ──
// 【放置时】【受祝福时】储存蒲公英×1（至多 1）
// 【移动后】按本次移动的曼哈顿距离提升储存蒲公英价值（初始 1）
// 可随时采摘：获得等同当前价值的蒲公英 ×1，并失去该地块内容
const FacilityDandelion = {
  id: 'facility_dandelion',
  name: '蒲公英田地',
  emoji: Assets.facilities.facility_dandelion,
  value: 1,
  description: ITEMS.facility_dandelion.description,
  internalNote: '每移动 1 格曼哈顿距离价值 +1（初始 1）；使用载具移动按起点到落点计算',

  register() {
    const ensureStored = (tile) => {
      const st = tile.contentState || (tile.contentState = {});
      if (!st.dandelionStored) {
        st.dandelionStored = true;
        st.dandelionValue = st.dandelionValue || 1;
      }
      return st;
    };

    HookDispatcher.register('onPlace', ({ gs, tileIdx }) => {
      const tile = gs.map.outerTiles[tileIdx];
      if (!tile || tile.contentId !== this.id) return;
      const st = ensureStored(tile);
      st.dandelionValue = 1;
      EventBus.emit(GE.TILE_UPDATED, { tileIdx });
    }, this);

    HookDispatcher.register('onBlessed', ({ gs, tileIdx }) => {
      const tile = gs.map.outerTiles[tileIdx];
      if (!tile || tile.contentId !== this.id) return;
      ensureStored(tile);   // 已储存则不叠加（至多 1 个）
      EventBus.emit(GE.TOAST_SHOW, { text: `✨ 蒲公英价值提升至 ${Math.max(0, tile.contentState.dandelionValue)}`, duration: 1800 });
      EventBus.emit(GE.TILE_UPDATED, { tileIdx });
    }, this);

    // onMoveEnd：params.distance = 本次移动的曼哈顿距离（由 MovementSystem 传入）
    HookDispatcher.register('onMoveEnd', ({ gs, distance = 0 }) => {
      if (distance <= 0) return;
      const tiles = gs.map.outerTiles.filter((t) => t.contentId === this.id);
      for (const t of tiles) {
        const st = t.contentState || (t.contentState = {});
        if (!st.dandelionStored) continue;
        st.dandelionValue = (st.dandelionValue || 1) + distance;
      }
      if (tiles.length) EventBus.emit(GE.TILE_UPDATED);
    }, this);
  },
};

// ── FAC-015 幽怜草田地 🌙 ──
// 【放置时】储存幽怜草×1（至多 1，初始价值 12）
// 【进入时】可以采摘
// 【受祝福时】储存的幽怜草价值 +12（同一日内第 2 次起每次衰减 2，最低 +0）
// 【每一日开始时】本日未受到过祝福 → 直接枯萎（地块内容消失，变空地块）
const FacilityGhostGrass = {
  id: 'facility_ghost_grass',
  name: '幽怜草田地',
  emoji: Assets.facilities.facility_ghost_grass,
  value: 12,
  description: ITEMS.facility_ghost_grass.description,
  internalNote: '初始价格 12；同日第 2 次起每次价值增加 -2，最低 +0；枯萎 = 地块内容直接失去',

  register() {
    HookDispatcher.register('onPlace', ({ gs, tileIdx }) => {
      const tile = gs.map.outerTiles[tileIdx];
      if (!tile || tile.contentId !== this.id) return;
      const st = tile.contentState || (tile.contentState = {});
      st.ghostStored = true;
      st.ghostValue = 12;
      st.ghostBlessCountToday = 0;
      st.ghostBlessedToday = false;
      EventBus.emit(GE.TILE_UPDATED, { tileIdx });
    }, this);

    HookDispatcher.register('onBlessed', ({ gs, tileIdx }) => {
      const tile = gs.map.outerTiles[tileIdx];
      if (!tile || tile.contentId !== this.id) return;
      const st = tile.contentState || (tile.contentState = {});
      if (!st.ghostStored) return;
      const n = (st.ghostBlessCountToday || 0) + 1;
      const gain = Math.max(0, 12 - 2 * (n - 1));   // 第 1 次 +12，第 2 次 +10，第 3 次 +8 …
      st.ghostValue = (st.ghostValue || 12) + gain;
      st.ghostBlessCountToday = n;
      st.ghostBlessedToday = true;
      EventBus.emit(GE.TOAST_SHOW, { text: `✨ 幽怜草价值 +${gain} → ${st.ghostValue}`, duration: 1800 });
      EventBus.emit(GE.TILE_UPDATED, { tileIdx });
    }, this);

    HookDispatcher.register('onDailyStart', ({ gs }) => {
      const tiles = gs.map.outerTiles.filter((t) => t.contentId === this.id);
      for (const t of tiles) {
        const st = t.contentState || (t.contentState = {});
        if (st.ghostStored && st.ghostBlessedToday === false) {
          t.contentId = null;
          t.contentState = {};
          EventBus.emit(GE.TOAST_SHOW, { text: '🌙 昨日未受祝福，幽怜草枯萎了', duration: 2000 });
          EventBus.emit(GE.TILE_UPDATED, { tileIdx: t.idx });
        }
        // 新的一天重置本日计数
        st.ghostBlessCountToday = 0;
        st.ghostBlessedToday = false;
      }
    }, this);
  },
};

// ── FAC-016 艾草田地 🍃 ──
// 【每一日开始时】获得艾草 ×2
// 【角色回复生命值时】获得艾草 ×1（任意途径回血都算）
// 【受祝福时】为角色回复 25% 生命值
const FacilityMugwort = {
  id: 'facility_mugwort',
  name: '艾草田地',
  emoji: Assets.facilities.facility_mugwort,
  value: 2,
  description: ITEMS.facility_mugwort.description,
  internalNote: '任意途径回复生命值都算，注意订阅所有回血来源',

  register() {
    HookDispatcher.register('onDailyStart', ({ gs }) => {
      const tiles = gs.map.outerTiles.filter((t) => t.contentId === this.id);
      if (!tiles.length) return;
      const total = tiles.length * 2;
      InventorySystem.addItem(gs, 'item_mugwort', total);
      EventBus.emit(GE.TOAST_SHOW, { text: `🍃 艾草田地 +${total} 艾草`, duration: 1800 });
    }, this);

    HookDispatcher.register('onHeal', ({ gs, amount = 0 }) => {
      if (amount <= 0) return;
      const tiles = gs.map.outerTiles.filter((t) => t.contentId === this.id);
      if (!tiles.length) return;
      InventorySystem.addItem(gs, 'item_mugwort', tiles.length);
      devLog.info('[mugwort] onHeal +', tiles.length);
    }, this);

    HookDispatcher.register('onBlessed', ({ gs, tileIdx }) => {
      const tile = gs.map.outerTiles[tileIdx];
      if (!tile || tile.contentId !== this.id) return;
      const actual = HealSystem.healPlayerByPercent(gs, 0.25, { source: this.id });
      EventBus.emit(GE.TOAST_SHOW, { text: `🍃 艾草祝福 回复 ${actual} 生命`, duration: 1800 });
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
  internalNote: '每日至多放置 1 个；场上上限 2；首次刷新免费 = 本次进入无论第几次刷新均 0 金币，但正常消耗刷新次数',

  register() {
    // §11.2 / §16.4 / §16.22：踩格不自动进入魔法商店，与普通商店同一套交互 ——
    // 由信息区「地块内容」tab 的功能选项「进入魔法商店」点击进入。
    // 「离开后本回合不可再进入」由 ShopSystem.enterShop 的 leftAtTurn 检查执行。
    HookDispatcher.register('onBlessed', ({ gs, tileIdx }) => {
      const tile = gs.map.outerTiles[tileIdx];
      if (!tile || tile.contentId !== this.id) return;
      ShopSystem.grantFreeRefresh(gs, tileIdx);
      EventBus.emit(GE.TOAST_SHOW, { text: '✨ 下次进入魔法商店，首次刷新免费', duration: 2000 });
    }, this);
  },
};

// ════════════════════════════════════════════════════════════════
// ——— 技能卡地块内容（skill_*） —— Phase 4 修复后 ———
// 技能卡作为 contentId 放进 outerTiles 后，触发由 SkillSystem.triggerSkillByHook 统一处理
// （遍历 outerTiles 找 skill_* 地块，按 hooks[hookType] + cooldown 触发）。
// 不再注册 HookDispatcher hook，不再消耗 tile.contentId（持续存在持续触发）。
// 连携技（isLinkSkill:true）也不走 HookDispatcher，它们是实时窗口按键触发的。
// ════════════════════════════════════════════════════════════════

/** 技能卡元数据：仅提供 id/name/emoji 供 UI 渲染（不再注册 onEnter hook，SkillSystem 统一处理） */
export const SKILL_FACILITIES = Object.values(SKILLS).map((skill) => ({
  id: skill.id,
  name: skill.name,
  emoji: skill.emoji,
}));

export function registerSkillHooks() {
  // Phase 4 修复：技能触发已由 SkillSystem.triggerSkillByHook 统一处理
  // 此处不再注册 HookDispatcher hook；连携技也由 LinkSkillSystem 实时窗口处理
  console.log('[facilities] SKILL_FACILITIES metadata-only (no hooks registered, SkillSystem handles trigger)');
}

// ════════════════════════════════════════════════════════════════
// 统一注册 + 导出
// ════════════════════════════════════════════════════════════════

export const ALL_FACILITIES = [
  // 16 种设施（FAC-001 ~ FAC-016）
  FacilityHome, FacilityTent, FacilityWheat, FacilityRice, FacilityPotato,
  FacilityTulip, FacilityStrawberry, FacilityPea, FacilityHenhouse, FacilitySlimehouse,
  FacilityCorn, FacilityCabbage,
  FacilityWildSeed, FacilityDandelion, FacilityGhostGrass, FacilityMugwort,
  // 6 种资源类地块内容（RES-001 ~ RES-006）
  ResourceEvent, ResourceReward, ResourceHunt, ResourceShop, ResourceBus, ResourceMagicShop,
];

/**
 * 统一注册所有设施/资源的 hook
 * GameDirector.start() 时调用一次
 */
export function registerFacilities() {
  for (const f of ALL_FACILITIES) {
    if (typeof f.register === 'function') f.register();
  }
  // Phase 4 —— 技能卡 skill_* onEnter hooks
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
 * 获取某 contentId 对应的设施/资源对象（UI 渲染时查表用）
 */
export function getDef(contentId) {
  return ALL_FACILITIES.find(f => f.id === contentId) || null;
}

/** Phase 1 向后兼容别名 */
export const PHASE1_FACILITIES = [FacilityHome, FacilityWheat];
export const FacilityHomeDef = FacilityHome;
export const FacilityWheatDef = FacilityWheat;
