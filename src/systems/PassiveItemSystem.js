// src/systems/PassiveItemSystem.js
// "获得后自动生效"类物品的统一处理：收藏品、魔导书。
//
// 设计文档 v0.5 §14.1：
//   魔导书 —— 为设施提供效果，获得后自动生效，自带【唯一】，不可出售
//   收藏品 —— 直接提供增益，绝大多数自带【唯一】，不可出售
//
// 两类物品都不需要玩家手动"使用"，所以统一在获得的那一刻（ITEM_GAINED）结算，
// 之后常驻生效的通过 HookDispatcher 挂到对应触发点。
// 技能不再经过中间物品：购买 / 获得技能物品即直接入背包，未放置前就是物品。

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { HookDispatcher } from '../core/HookDispatcher.js';
import { devLog } from '../core/Logger.js';
import { COLLECTIBLES } from '../data/collectibles.js';
import { ITEMS } from '../data/items.js';
import { drawFromPool } from './RandomPool.js';
import * as InventorySystem from './InventorySystem.js';
import { HealSystem } from './HealSystem.js';
import { FieldEffects } from './FieldEffects.js';

let wiredEpoch = -1;
let hpListenerAttached = false;

/** 挂常驻/触发型收藏品的 hook */
function wireHooks() {
  if (wiredEpoch === HookDispatcher.epoch) return;
  wiredEpoch = HookDispatcher.epoch;

  // 睡觉时：皇家枕头回 15% 生命
  HookDispatcher.register('onSleep', ({ gs }) => {
    if (InventorySystem.countItem(gs, 'collectible_royal_pillow') < 1) return;
    const pct = COLLECTIBLES.collectible_royal_pillow.effectParams.percent;
    HealSystem.healPlayerByPercent(gs, pct, { source: 'collectible_royal_pillow' });
  });

  // 移动后：枯木新枝回（6 + 1%）生命
  HookDispatcher.register('onMoveEnd', ({ gs }) => {
    if (InventorySystem.countItem(gs, 'collectible_deadwood') < 1) return;
    const p = COLLECTIBLES.collectible_deadwood.effectParams;
    const amount = p.flat + Math.floor(gs.player.maxHp * p.percent);
    HealSystem.healPlayer(gs, amount, { source: 'collectible_deadwood' });
  });

  // 每一日结束时：穗粒满 → 每块小麦田块 +1 小麦
  // （仓廪实生效时，水稻田块同样视同小麦田块，一起计入）
  HookDispatcher.register('onDailyEnd', ({ gs }) => {
    if (InventorySystem.countItem(gs, 'grimoire_grain_full') < 1) return;
    const n = FieldEffects.countFieldTiles(gs, FieldEffects.FIELD_TYPES.WHEAT);
    if (n > 0) {
      InventorySystem.addItem(gs, 'item_wheat', n);
      devLog.info('[Passive] 穗粒满 小麦 +', n);
    }
  });

  // 每一回合开始时：稻香远 → 回复 2 × 稻草田块数量 点生命（受上限截断）
  HookDispatcher.register('onTurnStart', ({ gs }) => {
    if (InventorySystem.countItem(gs, 'grimoire_rice_scent') < 1) return;
    const n = FieldEffects.countFieldTiles(gs, FieldEffects.FIELD_TYPES.RICE);
    if (n <= 0) return;
    HealSystem.healPlayer(gs, 2 * n, { source: 'grimoire_rice_scent' });
  });

  // 经过时：黄金浪 → 处于「≥3 小麦田块相连」簇内的田块，经过时获得小麦 ×1
  HookDispatcher.register('onPass', ({ gs, tileIdx }) => {
    if (InventorySystem.countItem(gs, 'grimoire_golden_wave') < 1) return;
    if (!FieldEffects.hasGoldenWaveTrait(gs, tileIdx)) return;
    InventorySystem.addItem(gs, 'item_wheat', 1);
    EventBus.emit(GE.TOAST_SHOW, { text: '🌾 黄金浪：经过麦浪 → 小麦 +1', duration: 1200 });
    devLog.info('[Passive] 黄金浪 经过田块', tileIdx, '→ 小麦 +1');
  });
}

export function hasGrimoire(gs, id) {
  return InventorySystem.countItem(gs, id) >= 1;
}

/**
 * 是否存在"≥n 个水稻田块相连"的簇（四方向相邻，栅栏内不算）
 * 保留此导出供既有调用方使用，实现已收敛到 FieldEffects（含仓廪实视同）。
 */
export function hasConnectedRice(gs, n = 3) {
  return FieldEffects.hasFieldCluster(gs, FieldEffects.FIELD_TYPES.RICE, n);
}

/**
 * 「食为先」：角色生命值低于 50% 时立即回复（3% × 小麦田块数量）生命值，每天限 1 次。
 * 由 GE.HP_CHANGE（生命下降）驱动；回复走 HealSystem，天然不会突破生命上限。
 * 口径：向下取整，至少 1 点；小麦田块数量为 0 时不消耗当日次数。
 */
export function tryFoodFirstHeal(gs, payload) {
  if (!gs || !gs.player) return 0;
  if (!payload || !(payload.delta < 0)) return 0;
  if (InventorySystem.countItem(gs, 'grimoire_food_first') < 1) return 0;
  if (gs.player.hp <= 0) return 0;
  if (gs.player.hp >= gs.player.maxHp * 0.5) return 0;

  gs.flags = gs.flags || {};
  if (gs.flags.foodFirstDay === gs.day) return 0;

  const n = FieldEffects.countFieldTiles(gs, FieldEffects.FIELD_TYPES.WHEAT);
  if (n <= 0) return 0;

  gs.flags.foodFirstDay = gs.day;   // 先记账再回复：OnHeal 链上不会二次触发
  const amount = Math.max(1, Math.floor(gs.player.maxHp * 0.03 * n));
  const healed = HealSystem.healPlayer(gs, amount, { source: 'grimoire_food_first' });
  if (healed > 0) {
    EventBus.emit(GE.TOAST_SHOW, { text: `📖 食为先：回复 ${healed} 生命`, duration: 1800 });
    devLog.info('[Passive] 食为先 回复', healed, '（小麦田块', n, '）');
  }
  return healed;
}

/** 商店折扣（会员卡） */
export function shopDiscount(gs) {
  return InventorySystem.countItem(gs, 'collectible_membership_card') >= 1 ? 0.5 : 0;
}

/**
 * 获得物品时的即时结算
 */
export function onItemGained(gs, itemId) {
  const def = ITEMS[itemId];
  if (!def) return;

  // ── 收藏品 ──
  if (def.tier3 === '收藏品') {
    switch (itemId) {
      case 'collectible_memoir': {
        const base = gs.player.maxHp;
        const add = Math.max(1, Math.floor(base * 0.02));
        gs.player.maxHp += add;
        gs.player.hp += add;
        EventBus.emit(GE.HP_CHANGE, { newValue: gs.player.hp, delta: add, reason: 'collectible_memoir' });
        break;
      }
      case 'collectible_membership_card': {
        gs.flags = gs.flags || {};
        gs.flags.shopDiscount = 0.5;
        EventBus.emit(GE.TOAST_SHOW, { text: '💳 会员卡：商店商品 -50%', duration: 2000 });
        break;
      }
      case 'collectible_farm_guide': {
        // C-15（ITM-COL-006「获得 3 个随机设施」）：抽到占位/野生种子时补抽，保证 3 个设施
        let granted = 0;
        for (let i = 0; i < 3; i++) {
          for (let attempt = 0; attempt < 8; attempt++) {
            const [hit] = drawFromPool('POOL-01', 1);
            if (hit?.id && !hit.placeholder && hit.id !== 'facility_wild_seed') {
              InventorySystem.addItem(gs, hit.id, 1);
              granted += 1;
              break;
            }
          }
        }
        EventBus.emit(GE.TOAST_SHOW, { text: `📘 《农业指南》：获得 ${granted} 个随机设施`, duration: 2200 });
        break;
      }
      case 'collectible_sad_pumpkin': {
        // 被动：场上每储存 1 个作物 → 最大生命/攻击 +2%（在 _syncPumpkin 里按需重算）
        syncPumpkin(gs);
        break;
      }
      default:
        break;
    }
  }

  // ── 魔导书 ──
  if (def.tier3 === '魔导书') {
    gs.flags = gs.flags || {};
    const toast = (text) => EventBus.emit(GE.TOAST_SHOW, { text, duration: 2200 });
    switch (itemId) {
      case 'grimoire_harvest_cereal':
        toast('📕 庆丰收：相连水稻田产出翻倍');
        break;
      case 'grimoire_grain_full':
        toast('📗 穗粒满：小麦田每日结束时 +1 小麦');
        break;
      case 'grimoire_rice_scent':
        toast('📖 稻香远：每回合开始时回复生命');
        break;
      case 'grimoire_spring_glow':
        toast('📖 春光好：草元素伤害提升');
        break;
      case 'grimoire_food_first':
        toast('📖 食为先：低血量时自动回复（每日 1 次）');
        break;
      case 'grimoire_golden_wave':
        toast('📖 黄金浪：相连麦田经过时 +1 小麦');
        break;
      case 'grimoire_granary_full':
        toast('📖 仓廪实：水稻田块与小麦田块互为视同');
        break;
      default:
        break;
    }
  }
}

/**
 * 悲伤的南瓜：按"场上储存的作物总数"给出最大生命/攻击加成。
 * 由于储存量随时变化，这里用"记录上次加成 → 求差 → 增量应用"的方式，避免重复叠加。
 */
export function syncPumpkin(gs) {
  if (InventorySystem.countItem(gs, 'collectible_sad_pumpkin') < 1) return;
  // 场上储存的作物总数：土豆/草莓/豌豆按个数；蒲公英/幽怜草各为独立"储存 1 个作物"
  let stored = 0;
  for (const t of gs.map.outerTiles) {
    const st = t.contentState || {};
    stored += (st.potatoStored || 0) + (st.strawberryStored || 0);
    stored += (st.peaStored || 0) + (st.dandelionStored ? 1 : 0) + (st.ghostStored ? 1 : 0);
  }
  gs._pumpkin = gs._pumpkin || { stored: 0, hpApplied: 0, atkApplied: 0 };
  const delta = stored - gs._pumpkin.stored;
  if (delta === 0) return;

  const baseHp = gs.player.maxHp - gs._pumpkin.hpApplied;
  const baseAtk = gs.player.atk - gs._pumpkin.atkApplied;
  const hpAdd = Math.floor(baseHp * 0.02 * delta);
  const atkAdd = Math.floor(baseAtk * 0.02 * delta);

  gs.player.maxHp += hpAdd;
  gs.player.hp += hpAdd;
  gs.player.atk += atkAdd;
  gs._pumpkin.stored = stored;
  gs._pumpkin.hpApplied += hpAdd;
  gs._pumpkin.atkApplied += atkAdd;
}

/**
 * 系统初始化：挂 hook + 订阅获得事件
 * @param {() => object} getGS 取当前 GS 的方法（GameDirector.getGS）
 */
export function initPassiveItems(getGS) {
  wireHooks();
  // GameDirector.start() 会 HookDispatcher.clearAll()，把这里的 hook 一并清掉；
  // 每次 start 结束后都会发 BOOT，此时若 epoch 变了就补挂一次（否则收藏品效果全部失效）
  EventBus.on(GE.BOOT, () => { wireHooks(); });
  if (typeof getGS !== 'function') return;

  // 食为先：生命值下降后检查「低于 50%」—— 事件订阅只挂一次，避免多次 BOOT 后重复结算
  if (!hpListenerAttached) {
    hpListenerAttached = true;
    EventBus.on(GE.HP_CHANGE, (payload) => {
      const gs = getGS();
      if (gs) tryFoodFirstHeal(gs, payload);
    });
  }

  EventBus.on(GE.ITEM_GAINED, ({ itemId }) => {
    const gs = getGS();
    if (gs) onItemGained(gs, itemId);
  });
}

export const PassiveItemSystem = {
  initPassiveItems,
  onItemGained,
  hasGrimoire,
  hasConnectedRice,
  tryFoodFirstHeal,
  shopDiscount,
  syncPumpkin,
};
