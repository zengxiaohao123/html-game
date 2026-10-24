// src/data/facilities.js
// Phase 1 极简版设施定义：只 home + wheat 两种作为 demo
// Phase 2 再补全完整 10 种设施
//
// 每种设施：id, name, emoji, hooks 注册
// 核心逻辑：通过 HookDispatcher.register() 把回调挂到对应 hook 类型上
// 回调会收到 (params, ctx) 两个参数，params 通常包含 { gs, tileIdx } 等

import { HookDispatcher } from '../core/HookDispatcher.js';
import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { Assets } from '../core/Assets.js';
import { devLog } from '../core/Logger.js';

// 每种设施的对象：{ id, name, emoji, hooks: { onEnter, onPass, onDailyStart, ... } }
const FacilityHome = {
  id: 'facility_home',
  name: '家',
  emoji: Assets.facilities.facility_home,

  /** 注册所有 hook 到 HookDispatcher */
  register() {
    // 进入家 / 经过家 → 获得 1 金币
    const gainGold = (gs) => {
      gs.player.gold += 1;
      EventBus.emit(GE.GOLD_CHANGE, { newValue: gs.player.gold, delta: 1 });
      EventBus.emit(GE.TOAST_SHOW, { text: '+1 🪙', duration: 1500 });
      devLog.info('[home hook] 获得 1 金币, 当前:', gs.player.gold);
    };

    HookDispatcher.register('onEnter', ({ gs, tileIdx }) => {
      // 只对 home 格（idx=6）触发
      if (tileIdx === 6) gainGold(gs);
    }, this);

    HookDispatcher.register('onPass', ({ gs, tileIdx }) => {
      // 只对 home 格（idx=6）触发
      if (tileIdx === 6) gainGold(gs);
    }, this);
  },
};

const FacilityWheat = {
  id: 'facility_wheat',
  name: '麦田',
  emoji: Assets.facilities.facility_wheat,

  /** 注册所有 hook 到 HookDispatcher */
  register() {
    // 每日开始 → 所有麦田每块产 2 小麦
    HookDispatcher.register('onDailyStart', ({ gs }) => {
      // 找出所有麦田格
      const wheatTiles = gs.map.outerTiles.filter(t => t.contentId === FacilityWheat.id);
      const total = wheatTiles.length * 2;
      if (total > 0) {
        // 加小麦到背包
        const existing = gs.inventory.items.find(i => i.itemId === 'item_wheat');
        if (existing) {
          existing.qty += total;
        } else {
          gs.inventory.items.push({ itemId: 'item_wheat', qty: total });
        }
        EventBus.emit(GE.ITEM_GAINED, { itemId: 'item_wheat', qty: total });
        EventBus.emit(GE.INVENTORY_CHANGE);
        EventBus.emit(GE.TOAST_SHOW, { text: `🌾 +${total} 小麦`, duration: 2000 });
        devLog.info('[wheat hook] 每日产出 小麦 x', total);
      }
    }, this);
  },
};

/**
 * 统一注册 Phase 1 所有设施的 hook
 * GameDirector.start() 时调用一次
 */
export function registerFacilities() {
  FacilityHome.register();
  FacilityWheat.register();
  devLog.info('Phase 1 设施 hook 注册完成:', HookDispatcher.count('onEnter'), 'onEnter /',
    HookDispatcher.count('onPass'), 'onPass /', HookDispatcher.count('onDailyStart'), 'onDailyStart');
}

/**
 * Phase 1 用的极简设施列表（方便调试）
 */
export const PHASE1_FACILITIES = [FacilityHome, FacilityWheat];
