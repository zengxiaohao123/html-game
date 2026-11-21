// src/data/fields/hops.js
// 啤酒花田块（FAC-019）
// 【每一日开始时】【每一日结束时】【受祝福时】储存啤酒花*1（至多18）
// 【经过时】自动取走储存的啤酒花
// 啤酒花需要浇水，当相邻格的地形有水面时，激活特性：【产出时】产量+2
//
// 说明：不新增"浇水"操作，相邻（4 方向）存在水面地形即视为已浇水；
//       【产出时】+2 的水面门槛由 ProduceSystem.hasProduceBonus 统一把关。

import { HookDispatcher } from '../../core/HookDispatcher.js';
import { produce, takeStoredToBag, CHANNEL } from '../../systems/ProduceSystem.js';
import {
  defineField, afterStorageChange, eachOwnTile, flagKey, registerSelfHook, stateOf, tileOf, toast,
} from './fieldKit.js';

export const HOPS_ID = 'facility_hops';
export const HOPS_MAX = 18;

export function hopsStoredOf(tile) {
  const n = Number(tile?.contentState?.hopsStored);
  return Number.isFinite(n) ? Math.max(0, Math.min(HOPS_MAX, Math.floor(n))) : 0;
}

export function addHopsStored(tile, n) {
  const cs = stateOf(tile);
  const before = hopsStoredOf(tile);
  cs.hopsStored = Math.min(HOPS_MAX, before + Math.max(0, Math.floor(n)));
  return cs.hopsStored - before;
}

export const HopsField = defineField({
  id: HOPS_ID,
  emoji: '🍺',
  value: 8,

  register() {
    HookDispatcher.register('onPlace', ({ gs, tileIdx, tileRef, contentId }) => {
      if (contentId !== this.id) return;
      const tile = tileOf(gs, tileRef ?? tileIdx);
      if (tile) stateOf(tile).hopsStored = hopsStoredOf(tile);
    }, this);

    const storeOne = (hook) => ({ gs }) => {
      eachOwnTile(gs, this.id, (ref, tile) => {
        const key = flagKey(this.id, hook);
        if (tile.dailyFlags?.[key]) return;
        if (tile.dailyFlags) tile.dailyFlags[key] = true;
        const n = produce(gs, {
          ref, itemId: 'item_hops', qty: 1, channel: CHANNEL.STORE,
          apply: (k) => addHopsStored(tile, k),
        });
        if (n > 0) afterStorageChange(gs, ref);
      });
    };

    HookDispatcher.register('onDailyStart', storeOne('dailyStart'), this);
    HookDispatcher.register('onDailyEnd', storeOne('dailyEnd'), this);

    registerSelfHook('onBlessed', this, ({ gs }, ref) => {
      const tile = tileOf(gs, ref);
      if (!tile) return;
      produce(gs, { ref, itemId: 'item_hops', qty: 1, channel: CHANNEL.STORE, apply: (k) => addHopsStored(tile, k) });
      afterStorageChange(gs, ref);
      toast(`✨ 储存 +1 啤酒花（${hopsStoredOf(tile)}/${HOPS_MAX}）`, 2000);
    });

    registerSelfHook('onPass', this, ({ gs }, ref) => {
      const tile = tileOf(gs, ref);
      if (!tile) return;
      const qty = hopsStoredOf(tile);
      if (qty <= 0) return;
      stateOf(tile).hopsStored = 0;
      takeStoredToBag(gs, ref, 'item_hops', qty);
      afterStorageChange(gs, ref);
      toast(`🧺 取走啤酒花 ×${qty}`, 2000);
    });
  },
});
