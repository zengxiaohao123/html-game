// src/data/fields/potato.js
// 土豆田块（FAC-002）
// 【每一日开始时】储存土豆*3（容量 30；薯道难 → 全程共用容量池）
// 【进入时】可以取走储存的土豆（薯道难：可一次取走所有土豆田块的土豆）
// 【受祝福时】储存土豆*5
//
// 魔导书：薯道难 → 全部土豆田共用容量池；薯条四重奏 → 田块数为 4 的倍数时每块 +10。

import { HookDispatcher } from '../../core/HookDispatcher.js';
import { devLog } from '../../core/Logger.js';
import { tileRefKey } from '../../core/TileAccess.js';
import { produce, CHANNEL } from '../../systems/ProduceSystem.js';
import {
  POTATO_BLESS_ADD,
  addPotatoStored,
  potatoCapacity,
  potatoStoredOf,
  potatoTotalStored,
  hasPotatoHardship,
} from '../../systems/PotatoSystem.js';
import { syncPumpkin } from '../../systems/PassiveItemSystem.js';
import {
  afterStorageChange, defineField, eachOwnTile, flagKey, getTile, isMine, registerSelfHook, toast,
} from './fieldKit.js';

export const PotatoField = defineField({
  id: 'facility_potato',
  emoji: '🥔',
  value: 4,

  register() {
    HookDispatcher.register('onDailyStart', ({ gs }) => {
      eachOwnTile(gs, this.id, (ref, tile) => {
        const key = flagKey(this.id, 'onDailyStart');
        if (tile.dailyFlags[key]) return;
        tile.dailyFlags[key] = true;

        let add = 3;
        if (tile.states?.some(s => s.type === 'blessed')) add = 5;
        produce(gs, {
          ref, itemId: 'item_potato', qty: add, channel: CHANNEL.STORE,
          apply: (k) => addPotatoStored(gs, tile, k),
        });
        devLog.info('[potato] tile', tileRefKey(ref), 'stored →', potatoStoredOf(tile), '/', potatoCapacity(gs));
      });
      syncPumpkin(gs); // A-12：储存变化 → 同步悲恸南瓜加成
    }, this);

    // 收获由 InfoPanel 手动滑动条触发（§16.4），进入时不再自动取走
    HookDispatcher.register('onEnter', ({ gs, tileIdx, tileRef }) => {
      if (!isMine(gs, tileRef ?? tileIdx, this.id)) return;
      devLog.info('[potato] onEnter (manual harvest via InfoPanel now)');
    }, this);

    // 祝福：储存 +5（立即触发，按容量截断）
    registerSelfHook('onBlessed', this, ({ gs }, ref) => {
      const tile = getTile(gs, ref);
      let added = 0;
      produce(gs, {
        ref, itemId: 'item_potato', qty: POTATO_BLESS_ADD, channel: CHANNEL.STORE,
        apply: (k) => { const a = addPotatoStored(gs, tile, k); added += a; return a; },
      });
      const cap = potatoCapacity(gs);
      const cur = hasPotatoHardship(gs) ? potatoTotalStored(gs) : potatoStoredOf(tile);
      toast(`✨ 祝福储存 +${added} 土豆（现 ${cur}/${cap}）`, 2000);
      afterStorageChange(gs, ref);
    });
  },
});
