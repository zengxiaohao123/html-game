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
import { Random } from '../core/Random.js';
import { SLIME_KINDS } from './creatures.js';
import { SKILLS } from './characters.js';
import { normalizeTerrain } from './terrains.js';
import { ITEMS } from './items.js';
import { drawFromPool } from '../systems/RandomPool.js';
import { HealSystem } from '../systems/HealSystem.js';
import { ShopSystem } from '../systems/ShopSystem.js';

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
  description: '【永恒】【唯一】\n【经过时】获得 1 金币（每天限 1 次）\n【进入时】获得 1 金币（每天限 1 次）\n【受祝福时】获得 1 金币\n【睡觉时】改为回满行动力',

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
          const newS = Math.min(gs.player.maxStamina, gs.player.stamina + extra);
          const delta = newS - gs.player.stamina;
          gs.player.stamina = newS;
          EventBus.emit(GE.STAMINA_CHANGE, { newValue: newS, delta, maxStamina: gs.player.maxStamina });
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
  description: '【睡觉时】改为回满行动力\n【受祝福时】下 1 次使用该帐篷睡觉时，额外回复 3 点行动力',

  register() {
    // onSleep：帐篷睡觉时回满（SleepSystem 主逻辑已在执行前判断，此处处理"受祝福时额外 +3"——
    // 用独立的 tent_bless state（与 1 天 blessed state 分离，避免 DaySystem 先清除导致丢失）
    HookDispatcher.register('onSleep', ({ gs }) => {
      const cur = gs.map.outerTiles[gs.player.x];
      if (!cur || cur.contentId !== this.id) return;
      const tentBless = cur.states?.find(s => s.type === 'tent_bless');
      if (tentBless && tentBless.bonus && tentBless.bonus > 0) {
        const bonus = tentBless.bonus;
        const delta = Math.min(bonus, gs.player.maxStamina - gs.player.stamina);
        if (delta > 0) {
          gs.player.stamina += delta;
          EventBus.emit(GE.STAMINA_CHANGE, { newValue: gs.player.stamina, delta, maxStamina: gs.player.maxStamina });
          EventBus.emit(GE.TOAST_SHOW, { text: `⛺ 祝福帐篷额外 +${delta} 🔷`, duration: 1800 });
        }
        // 一次睡觉消耗一次 bonus（每睡一次减 3，可叠加次数如 +6 → 睡两次）
        tentBless.bonus -= 3;
        if (tentBless.bonus <= 0) {
          cur.states = cur.states.filter(s => s !== tentBless);
        }
        devLog.info('[tent] consumed tent_bless bonus, remaining =', tentBless.bonus);
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
  description: '【每一日开始时】获得小麦 ×2。若地形为草地，额外小麦 ×1\n【受祝福时】获得小麦 ×3',

  register() {
    // onDailyStart：找所有麦田格，每格 ×2（草地 +1），总计加背包
    // 注意：不要检查 tile.states.some(s=>s.type==='blessed') —— DaySystem 会先清除 1 天 blessed
    // 再 fire onDailyStart。小麦的【受祝福时】效果由 wheat.onBlessed hook 立即触发（×3），
    // 不跨日，所以这里只需处理每日基础产出即可。
    HookDispatcher.register('onDailyStart', ({ gs }) => {
      // Phase 3 容量惩罚：友善超载 → 友善类收益归 0
      if (gs.capacity?.friendlyOverloaded) {
        devLog.info('[wheat] friendly overload → skip daily produce');
        return;
      }
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
  description: '【每一日开始时】获得稻草 ×1。若地形为草地额外稻草 ×1；若相邻有水面地形额外稻草 ×2\n【受祝福时】接下来 5 日每日开始时获得稻草 ×1',

  register() {
    // onDailyStart
    HookDispatcher.register('onDailyStart', ({ gs }) => {
      // Phase 3 容量惩罚：友善超载 → 友善类收益归 0
      if (gs.capacity?.friendlyOverloaded) {
        devLog.info('[rice] friendly overload → skip daily produce');
        return;
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
  description: '【每一日开始时】储存土豆 ×3（至多 30）\n【进入时】可以取走储存的土豆\n【受祝福时】储存土豆 ×5',

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
  description: '【每一日开始时】价值随机 -4~+10\n【受祝福时】立即触发 2 次【每一日开始时】的效果\n可以随时采摘',

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
  description: '【经过时】储存草莓 ×1（至多 5，每天限 1 次）\n【进入时】若草莓数量已满，则可以取走所有草莓\n【受祝福时】储存随机 2~5 个草莓',

  register() {
    HookDispatcher.register('onPass', ({ gs, tileIdx }) => {
      if (!isMine(gs, tileIdx, this.id)) return;
      const key = flagKey(this.id, 'onPass');
      if (gs.map.outerTiles[tileIdx].dailyFlags[key]) return;
      gs.map.outerTiles[tileIdx].dailyFlags[key] = true;
      const tile = gs.map.outerTiles[tileIdx];
      const state = tile.contentState || (tile.contentState = {});
      state.strawberryStored = Math.min(STRAWBERRY_MAX, (state.strawberryStored || 0) + 1);
      EventBus.emit(GE.TILE_UPDATED, { tileIdx });
    }, this);

    // onEnter 自动取走已删除 —— 满时手动取走改为 InfoPanel 按钮触发（§16.4）
    HookDispatcher.register('onEnter', ({ gs, tileIdx }) => {
      if (!isMine(gs, tileIdx, this.id)) return;
      devLog.info('[strawberry] onEnter (manual full-harvest via InfoPanel now)');
    }, this);

    HookDispatcher.register('onBlessed', ({ gs, tileIdx }) => {
      if (!isMine(gs, tileIdx, this.id)) return;
      const tile = gs.map.outerTiles[tileIdx];
      const state = tile.contentState || (tile.contentState = {});
      const rnd = Math.floor(Math.random() * 4) + 2; // 2~5
      const before = state.strawberryStored || 0;
      state.strawberryStored = Math.min(STRAWBERRY_MAX, before + rnd);
      const actuallyAdded = state.strawberryStored - before;
      EventBus.emit(GE.TOAST_SHOW, { text: `✨ 祝福储存 +${actuallyAdded} 草莓（上限 ${STRAWBERRY_MAX}）`, duration: 2000 });
      EventBus.emit(GE.TILE_UPDATED, { tileIdx });
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
  description: '【使用技能时】储存豌豆 ×1（至多 10，每 2 回合限 1 次）\n【进入时】可以取走储存的豌豆\n【受祝福时】自动取走储存的豌豆',

  register() {
    // onUseSkill：每 2 回合限 1 次（用 gs.turn - last >= 2 判断）
    HookDispatcher.register('onUseSkill', ({ gs }) => {
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
  description: '【进入时】生成 1 只小鸡（每日限 1 次）。每个鸡舍至多生成 4 只鸡\n【进入时】可以取走储存的鸡蛋（至多储存 10 个）\n【受祝福时】属于该鸡舍的随机 1 只小鸡立刻长大',

  register() {
    // 进入时：每日限 1 次生成小鸡（取走鸡蛋已改为 InfoPanel 手动滑动条 §16.4）
    HookDispatcher.register('onEnter', ({ gs, tileIdx }) => {
      if (!isMine(gs, tileIdx, this.id)) return;
      const tile = gs.map.outerTiles[tileIdx];

      // 生成小鸡（每日限 1 次；每个鸡舍至多 4 只）
      const spawnKey = flagKey(this.id, 'spawn');
      if (!tile.dailyFlags[spawnKey]) {
        // 统计属于该鸡舍的生物数量
        const sameFacility = gs.creatures.filter(c => c.facilityId === this.id).length;
        if (sameFacility < 4) {
          tile.dailyFlags[spawnKey] = true;
          CreatureSystem.spawnCreature(gs, 'chick', { facilityId: this.id });
        } else {
          EventBus.emit(GE.TOAST_SHOW, { text: '鸡舍已满 4 只，先收获吧～', duration: 1500 });
        }
      }

      EventBus.emit(GE.TILE_UPDATED, { tileIdx });
    }, this);

    // 受祝福时：属于该鸡舍的随机 1 只小鸡立刻长大
    HookDispatcher.register('onBlessed', ({ gs, tileIdx }) => {
      if (!isMine(gs, tileIdx, this.id)) return;
      const chicks = gs.creatures.filter(c => c.facilityId === this.id && c.kind === 'chick');
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
  description: '【每日开始时】生成 1 只史莱姆（种类随机）\n【受祝福时】接下来的 3 天内，【每日开始时】效果触发 2 次',

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
// 【受祝福时】获得随机 1 个生物（60% 友善 / 40% 危险 / 0% 极度危险）
// 注意：onCreatureAdded hook 由 CreatureSystem 在 spawnCreature 时 fire（Agent 3 实现）
// ════════════════════════════════════════════════════════════════
const FacilityCorn = {
  id: 'facility_corn',
  name: '玉米田块',
  emoji: '🌽',
  value: 4,
  description: '【生物增加时】获得玉米 ×1\n【受祝福时】获得随机 1 个生物',

  register() {
    // onCreatureAdded：任何生物（友善/危险/极度危险）增加时，每块玉米田 +1 玉米
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

    // onBlessed：获得随机 1 个生物
    //   池子：60% 友善 / 40% 危险 / 0% 极度危险；抽中类型后从该类中等概率随机
    // Phase 3 实现 CreatureSystem.spawnCreatureFromPool；此处先 Toast 占位
    HookDispatcher.register('onBlessed', ({ gs, tileIdx }) => {
      if (!isMine(gs, tileIdx, this.id)) return;
      EventBus.emit(GE.TOAST_SHOW, { text: '✨ 玉米田受祝福 → 获得随机 1 个生物（Phase 3 实现）', duration: 2200 });
      devLog.info('[corn] onBlessed TODO: spawn random creature (60% friendly / 40% danger)');
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
  description: '【每一日开始时】获得卷心菜 ×2，然后消耗背包里的一个卷心菜，将其投向最近的敌人，造成 20 点草元素伤害\n【受祝福时】对所有敌人分别投掷一个卷心菜（不消耗背包中的卷心菜）',

  register() {
    // onDailyStart：先获得 ×2 卷心菜进背包，再消耗 1 个自动投最近敌人
    HookDispatcher.register('onDailyStart', ({ gs }) => {
      const tiles = gs.map.outerTiles.filter(t => t.contentId === this.id);
      for (const t of tiles) {
        const key = flagKey(this.id, 'onDailyStart');
        if (t.dailyFlags[key]) continue;
        t.dailyFlags[key] = true;

        // 1) 先 +2 卷心菜
        InventorySystem.addItem(gs, 'item_cabbage', 2);
        EventBus.emit(GE.TOAST_SHOW, { text: `🥬 每日 +2 卷心菜`, duration: 1500 });

        // 2) 然后消耗 1 个卷心菜投向最近敌人，造成 20 点草元素伤害
        //    背包里没卷心菜则跳过（注意上面刚 +2 了所以一定有，但祝福效果不消耗所以不影响）
        const hasBless = t.states?.some(s => s.type === 'blessed');
        if (!hasBless) {
          // 非祝福：消耗 1 个，投最近敌人
          // TODO: 真正的 CombatSystem.performDamage(gs, nearestEnemy, 20, 'grass') — Phase 3 接入
          // Phase 2A 简化：检查背包里是否真的有，然后减 1
          const inv = gs.player?.inventory || {};
          if (inv.item_cabbage && inv.item_cabbage > 0) {
            InventorySystem.addItem(gs, 'item_cabbage', -1);
            EventBus.emit(GE.TOAST_SHOW, { text: `🥬 卷心菜投掷！20 点草元素伤害（Phase 3 生效）`, duration: 1800 });
          }
        } else {
          // 祝福：对所有敌人分别投掷一个卷心菜，不消耗背包
          EventBus.emit(GE.TOAST_SHOW, { text: `✨ 祝福卷心菜 → 对所有敌人各投 1 个（Phase 3 生效）`, duration: 2200 });
        }
      }
    }, this);

    // onBlessed：立即获得 2 个卷心菜（祝福额外产出，与 onDailyStart 不重复）
    HookDispatcher.register('onBlessed', ({ gs, tileIdx }) => {
      if (!isMine(gs, tileIdx, this.id)) return;
      // 祝福效果由 onDailyStart 内的 hasBless 分支处理（判断当前 tile 是否 blessed）
      EventBus.emit(GE.TOAST_SHOW, { text: `✨ 卷心菜田受祝福 → 下次每日开始时对全体敌人投掷`, duration: 2200 });
    }, this);
  },
};

// ════════════════════════════════════════════════════════════════
// ——— 资源类地块内容（5 种，共用同一套 HookDispatcher 注册方式）——
// ════════════════════════════════════════════════════════════════

const ResourceEvent = {
  id: 'resource_event',
  name: '事件点',
  emoji: Assets.resources.resource_event,
  value: 5,
  description: '【进入时】遭遇随机事件（每日限 1 次）\n【受祝福时】显示本事件今日具体内容',
  register() {
    HookDispatcher.register('onEnter', ({ gs, tileIdx }) => {
      if (!isMine(gs, tileIdx, this.id)) return;
      const key = flagKey(this.id, 'onEnter');
      if (gs.map.outerTiles[tileIdx].dailyFlags[key]) return;
      gs.map.outerTiles[tileIdx].dailyFlags[key] = true;
      EventBus.emit(GE.TOAST_SHOW, { text: '🎲 遭遇随机事件…（Phase 5 触发）', duration: 2000 });
    }, this);
  },
};

const ResourceReward = {
  id: 'resource_reward',
  name: '奖励点',
  emoji: Assets.resources.resource_reward,
  value: 8,
  description: '【进入时】获得随机奖励（每日限 1 次）\n【受祝福时】下 1 次进入时高价值奖励概率提升',
  register() {
    HookDispatcher.register('onEnter', ({ gs, tileIdx }) => {
      if (!isMine(gs, tileIdx, this.id)) return;
      const key = flagKey(this.id, 'onEnter');
      if (gs.map.outerTiles[tileIdx].dailyFlags[key]) return;
      gs.map.outerTiles[tileIdx].dailyFlags[key] = true;
      EventBus.emit(GE.TOAST_SHOW, { text: '🎁 发现随机奖励…（Phase 5 触发）', duration: 2000 });
    }, this);
  },
};

const ResourceHunt = {
  id: 'resource_hunt',
  name: '狩猎点',
  emoji: Assets.resources.resource_hunt,
  value: 5,
  description: '【进入时】可狩猎，概率获得随机生物（每日限 1 次）\n【受祝福时】下一次成功率提升\n功能：狩猎普通生物 / 狩猎危险生物',
  register() {
    HookDispatcher.register('onEnter', ({ gs, tileIdx }) => {
      if (!isMine(gs, tileIdx, this.id)) return;
      const key = flagKey(this.id, 'onEnter');
      if (gs.map.outerTiles[tileIdx].dailyFlags[key]) return;
      gs.map.outerTiles[tileIdx].dailyFlags[key] = true;
      EventBus.emit(GE.TOAST_SHOW, { text: '⚔️ 狩猎中…（Phase 3 触发）', duration: 2000 });
    }, this);
  },
};

const ResourceShop = {
  id: 'resource_shop',
  name: '商店',
  emoji: Assets.resources.resource_shop,
  value: 1,
  description: '【进入时】可进入商店\n【受祝福时】下一次进入时，有概率出现打折商品',
  internalNote: '每日至多放置 1 个；场上上限 2；不在功能区，必须通过地块功能进入',
  register() {
    HookDispatcher.register('onEnter', ({ gs, tileIdx }) => {
      if (!isMine(gs, tileIdx, this.id)) return;
      EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'shop', tileIdx });
      devLog.info('[shop] onEnter → open shop panel, tile', tileIdx);
    }, this);

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
  description: '【进入时】行动力 +1（每日限 1 次）\n【进入时】获得 1 个轮子\n【受祝福时】获得 1 个随机载具',
  register() {
    HookDispatcher.register('onEnter', ({ gs, tileIdx }) => {
      if (!isMine(gs, tileIdx, this.id)) return;
      const key = flagKey(this.id, 'onEnter');
      if (gs.map.outerTiles[tileIdx].dailyFlags[key]) return;
      gs.map.outerTiles[tileIdx].dailyFlags[key] = true;

      // 行动力 +1（上限 maxStamina）
      const newS = Math.min(gs.player.maxStamina, gs.player.stamina + 1);
      const delta = newS - gs.player.stamina;
      gs.player.stamina = newS;
      if (delta > 0) {
        EventBus.emit(GE.STAMINA_CHANGE, { newValue: newS, delta, maxStamina: gs.player.maxStamina });
      }
      // 获得 1 载具：轮子（按设计文档 §14.7：巴士站 → vehicle_wheel）
      VehicleSystem.gainVehicle(gs, 'vehicle_wheel');
      EventBus.emit(GE.TOAST_SHOW, { text: `🚌 行动力 +1 🚗 +1 轮子载具`, duration: 2000 });
      devLog.info('[bus] stamina +1, +1 wheel');
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
  description: '【放置时】变为随机设施',
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
  description: '【移动后】根据本次移动经过的距离提升储存的蒲公英的价值\n【放置时】【受祝福时】储存蒲公英 ×1（至多 1 个）\n可以随时采摘',
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
  description: '【放置时】储存幽怜草 ×1（至多 1 个）\n【进入时】可以采摘\n【受祝福时】储存的幽怜草价值 +12（同一日内多次祝福有衰减）\n若本日没有受到过祝福则下一日开始时会直接枯萎',
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
  description: '【每一日开始时】获得艾草 ×2\n【角色回复生命值时】获得艾草 ×1\n【受祝福时】为角色回复 25% 生命值',
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
  description: '【进入时】可进入魔法商店\n【受祝福时】下一次进入时，首次刷新免费',
  internalNote: '每日至多放置 1 个；场上上限 2；首次刷新免费 = 本次进入无论第几次刷新均 0 金币，但正常消耗刷新次数',

  register() {
    HookDispatcher.register('onEnter', ({ gs, tileIdx }) => {
      if (!isMine(gs, tileIdx, this.id)) return;
      const key = flagKey(this.id, 'onEnter');
      if (gs.map.outerTiles[tileIdx].dailyFlags[key]) return;
      gs.map.outerTiles[tileIdx].dailyFlags[key] = true;
      // 打开魔法商店页面（B4 实现 UI；此处先发事件，UI 未接时由 Toast 兜底）
      EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'magicShop', tileIdx });
      EventBus.emit(GE.TOAST_SHOW, { text: '🔮 进入魔法商店', duration: 1500 });
    }, this);

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
