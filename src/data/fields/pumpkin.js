// src/data/fields/pumpkin.js
// 南瓜田块（FAC-020）
// 【每一日结束时】获得12成长值。成长值达到100后，储存南瓜*1（至多1），并有50%概率获得南瓜田块*1
// 【进入时】取走南瓜，南瓜田块也随之消失
// 【受祝福时】获得30成长值
//
// 口径：每块独立成长；满 100 后成长值封顶（不囤积）；储存满期间不再结算；
//       获得的南瓜田块直接入背包（不是产物，不触发【产出时】）。

import { HookDispatcher } from '../../core/HookDispatcher.js';
import { EventBus } from '../../core/EventBus.js';
import { GE } from '../../core/GameEvents.js';
import { Random } from '../../core/Random.js';
import { addItem } from '../../systems/InventorySystem.js';
import { produce, takeStoredToBag, CHANNEL } from '../../systems/ProduceSystem.js';
import { ITEMS } from '../items.js';
import {
  defineField, afterStorageChange, eachOwnTile, registerSelfHook, refreshTile, stateOf, tileOf, toast,
} from './fieldKit.js';

export const PUMPKIN_ID = 'facility_pumpkin';
export const PUMPKIN_THRESHOLD = 100;
export const PUMPKIN_DAILY_GROWTH = 12;
export const PUMPKIN_BLESS_GROWTH = 30;
export const PUMPKIN_FIELD_DROP_RATE = 0.5;

export function pumpkinGrowthOf(tile) {
  const n = Number(tile?.contentState?.pumpkinGrowth);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

export function pumpkinStoredOf(tile) {
  const n = Number(tile?.contentState?.pumpkinStored);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, Math.floor(n))) : 0;
}

/** 增加成长值并结算阈值（入档字段：pumpkinGrowth / pumpkinStored） */
export function addPumpkinGrowth(gs, ref, tile, amount) {
  const cs = stateOf(tile);
  const wasFull = pumpkinStoredOf(tile) >= 1;
  cs.pumpkinGrowth = Math.min(PUMPKIN_THRESHOLD, pumpkinGrowthOf(tile) + amount);
  if (pumpkinGrowthOf(tile) < PUMPKIN_THRESHOLD || wasFull) return { stored: 0, fieldDrop: false };

  let stored = 0;
  produce(gs, {
    ref, itemId: 'item_pumpkin', qty: 1, channel: CHANNEL.STORE,
    apply: (k) => {
      const before = pumpkinStoredOf(tile);
      cs.pumpkinStored = Math.min(1, before + k);
      stored = cs.pumpkinStored - before;
      return stored;
    },
  });
  let fieldDrop = false;
  if (stored > 0 && Random.chance(PUMPKIN_FIELD_DROP_RATE)) {
    addItem(gs, PUMPKIN_ID, 1);
    fieldDrop = true;
    EventBus.emit(GE.TOAST_SHOW, { text: '🎃 额外获得南瓜田块 ×1（已放入背包）', duration: 2200 });
  }
  return { stored, fieldDrop };
}

export const PumpkinField = defineField({
  id: PUMPKIN_ID,
  emoji: '🎃',
  value: 12,

  register() {
    HookDispatcher.register('onPlace', ({ gs, tileIdx, tileRef, contentId }) => {
      if (contentId !== this.id) return;
      const tile = tileOf(gs, tileRef ?? tileIdx);
      if (tile) {
        const cs = stateOf(tile);
        cs.pumpkinGrowth = pumpkinGrowthOf(tile);
        cs.pumpkinStored = pumpkinStoredOf(tile);
      }
    }, this);

    HookDispatcher.register('onDailyEnd', ({ gs }) => {
      eachOwnTile(gs, this.id, (ref, tile) => {
        addPumpkinGrowth(gs, ref, tile, PUMPKIN_DAILY_GROWTH);
        afterStorageChange(gs, ref);
      });
    }, this);

    registerSelfHook('onBlessed', this, ({ gs }, ref) => {
      const tile = tileOf(gs, ref);
      if (!tile) return;
      addPumpkinGrowth(gs, ref, tile, PUMPKIN_BLESS_GROWTH);
      afterStorageChange(gs, ref);
      toast(`✨ 成长值 +${PUMPKIN_BLESS_GROWTH}（${pumpkinGrowthOf(tile)}/${PUMPKIN_THRESHOLD}）`, 2200);
    });

    // 【进入时】取走南瓜，田块消失
    registerSelfHook('onEnter', this, ({ gs }, ref) => {
      const tile = tileOf(gs, ref);
      if (!tile) return;
      const qty = pumpkinStoredOf(tile);
      if (qty <= 0) {
        toast('🎃 还没有可取的南瓜', 1600);
        return;
      }
      takeStoredToBag(gs, ref, 'item_pumpkin', qty);
      tile.contentId = null;
      tile.contentState = {};
      tile.states = [];
      EventBus.emit(GE.TILE_CONTENT_CHANGED, { tileIdx: ref, tileRef: ref, oldContentId: this.id, newContentId: null });
      EventBus.emit(GE.TOAST_SHOW, {
        text: `🎃 取走南瓜 ×${qty}，${ITEMS[this.id]?.name || '南瓜田块'}随之消失`, duration: 2400,
      });
      refreshTile(gs, ref);
    });
  },
});
