// src/systems/PassiveItemSystem.js
// "获得后自动生效"类物品的统一处理：收藏品、魔导书、技能石。
//
// 设计文档 v0.5 §14.1：
//   魔导书 —— 为设施提供效果，获得后自动生效，自带【唯一】，不可出售
//   技能石 —— 获得后自动习得对应技能，允许同名多个，不可出售
//   收藏品 —— 直接提供增益，绝大多数自带【唯一】，不可出售
//
// 三类物品都不需要玩家手动"使用"，所以统一在获得的那一刻（ITEM_GAINED）结算，
// 之后常驻生效的通过 HookDispatcher 挂到对应触发点。

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { HookDispatcher } from '../core/HookDispatcher.js';
import { devLog } from '../core/Logger.js';
import { COLLECTIBLES } from '../data/collectibles.js';
import { ITEMS } from '../data/items.js';
import { Distance } from '../core/Distance.js';
import { drawFromPool } from './RandomPool.js';
import * as InventorySystem from './InventorySystem.js';
import { HealSystem } from './HealSystem.js';

/** 技能石 → 习得的技能 id */
export const STONE_TO_SKILL = {
  skill_stone_zongheng: 'skill_zongheng',
  skill_stone_shift: 'skill_link_shift',
};

let wired = false;

/** 只挂一次：常驻/触发型收藏品的 hook */
function wireHooks() {
  if (wired) return;
  wired = true;

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

  // 每一日结束时：穗粒满 → 每块小麦田 +1 小麦
  HookDispatcher.register('onDailyEnd', ({ gs }) => {
    if (InventorySystem.countItem(gs, 'grimoire_grain_full') < 1) return;
    const n = gs.map.outerTiles.filter((t) => t.contentId === 'facility_wheat').length;
    if (n > 0) {
      InventorySystem.addItem(gs, 'item_wheat', n);
      devLog.info('[Passive] 穗粒满 小麦 +', n);
    }
  });

  // 每一日开始时：庆丰收 → 重算"水稻是否 ≥3 相连"，给设施侧一个开关
  HookDispatcher.register('onDailyStart', ({ gs }) => {
    gs.flags = gs.flags || {};
    gs.flags.riceDouble = hasGrimoire(gs, 'grimoire_harvest_cereal') && hasConnectedRice(gs, 3);
  });
}

export function hasGrimoire(gs, id) {
  return InventorySystem.countItem(gs, id) >= 1;
}

/**
 * 是否存在"≥n 个水稻田块相连"的簇（四方向相邻，栅栏内不算）
 */
export function hasConnectedRice(gs, n = 3) {
  const rice = new Set(
    gs.map.outerTiles.filter((t) => t.contentId === 'facility_rice').map((t) => t.idx)
  );
  if (rice.size < n) return false;

  const seen = new Set();
  for (const start of rice) {
    if (seen.has(start)) continue;
    const stack = [start];
    let size = 0;
    while (stack.length) {
      const cur = stack.pop();
      if (seen.has(cur)) continue;
      seen.add(cur);
      size += 1;
      for (const nb of Distance.outerNeighbors(gs.map.size, cur)) {
        if (nb != null && rice.has(nb) && !seen.has(nb)) stack.push(nb);
      }
    }
    if (size >= n) return true;
  }
  return false;
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

  // ── 技能石：获得即习得 ──
  const skillId = STONE_TO_SKILL[itemId];
  if (skillId) {
    InventorySystem.addItem(gs, skillId, 1);
    InventorySystem.removeItem(gs, itemId, 1);
    EventBus.emit(GE.TOAST_SHOW, { text: `💎 习得技能【${ITEMS[skillId]?.name || skillId}】`, duration: 2000 });
    devLog.info('[Passive] skill stone →', skillId);
    return;
  }

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
        for (let i = 0; i < 3; i++) {
          const [hit] = drawFromPool('POOL-01', 1);
          if (hit?.id && hit.id !== 'facility_wild_seed') {
            InventorySystem.addItem(gs, hit.id, 1);
          }
        }
        EventBus.emit(GE.TOAST_SHOW, { text: '📘 《农业指南》：获得 3 个随机设施', duration: 2200 });
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
    if (itemId === 'grimoire_harvest_cereal') {
      gs.flags.riceDouble = hasConnectedRice(gs, 3);
      EventBus.emit(GE.TOAST_SHOW, { text: '📕 庆丰收：相连水稻田产出翻倍', duration: 2200 });
    }
    if (itemId === 'grimoire_grain_full') {
      EventBus.emit(GE.TOAST_SHOW, { text: '📗 穗粒满：小麦田每日结束时 +1 小麦', duration: 2200 });
    }
  }
}

/**
 * 悲伤的南瓜：按"场上储存的作物总数"给出最大生命/攻击加成。
 * 由于储存量随时变化，这里用"记录上次加成 → 求差 → 增量应用"的方式，避免重复叠加。
 */
export function syncPumpkin(gs) {
  if (InventorySystem.countItem(gs, 'collectible_sad_pumpkin') < 1) return;
  // 简化：储存量取所有田块的 contentState.stored 之和（土豆/草莓/豌豆等）
  let stored = 0;
  for (const t of gs.map.outerTiles) {
    const st = t.contentState || {};
    stored += (st.potatoStored || 0) + (st.strawberryStored || 0) + (st.peaStored || 0);
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
  if (typeof getGS !== 'function') return;
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
  shopDiscount,
  syncPumpkin,
  STONE_TO_SKILL,
};
