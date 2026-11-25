// src/data/fields/strawberry.js
// 草莓田块（FAC-004）
// 【经过时】储存草莓*1（至多 5，每天限 1 次）
// 【进入时】若草莓数量已满（≥5），取走所有；不满则什么都不做
// 【受祝福时】储存随机 2 ~ 5 个（不超上限）
//
// §13.2：友善超载惩罚 → 友善类收益归 0（除小麦/水稻）。

import { HookDispatcher } from '../../core/HookDispatcher.js';
import { devLog } from '../../core/Logger.js';
import { produce, CHANNEL } from '../../systems/ProduceSystem.js';
import { isSuppressed } from '../../systems/SuppressSystem.js';
import {
  afterStorageChange, defineField, flagKey, getTile, isMine, registerSelfHook, stateOf, toast,
} from './fieldKit.js';

export const STRAWBERRY_MAX = 5;

export const StrawberryField = defineField({
  id: 'facility_strawberry',
  emoji: '🍓',
  value: 5,

  register() {
    HookDispatcher.register('onPass', ({ gs, tileIdx, tileRef }) => {
      const ref = tileRef ?? tileIdx;
      if (!isMine(gs, ref, this.id)) return;
      if (gs.capacity?.friendlyOverloaded) return;
      const tile = getTile(gs, ref);
      if (isSuppressed(gs, ref)) return;
      const key = flagKey(this.id, 'onPass');
      if (tile.dailyFlags[key]) return;
      tile.dailyFlags[key] = true;
      const state = stateOf(tile);
      produce(gs, {
        ref, itemId: 'item_strawberry', qty: 1, channel: CHANNEL.STORE,
        apply: (k) => {
          const before = state.strawberryStored || 0;
          state.strawberryStored = Math.min(STRAWBERRY_MAX, before + k);
          return state.strawberryStored - before;
        },
      });
      afterStorageChange(gs, ref);
    }, this);

    // 满时取走改为 InfoPanel 按钮触发（§16.4）
    HookDispatcher.register('onEnter', ({ gs, tileIdx, tileRef }) => {
      if (!isMine(gs, tileRef ?? tileIdx, this.id)) return;
      devLog.info('[strawberry] onEnter (manual full-harvest via InfoPanel now)');
    }, this);

    registerSelfHook('onBlessed', this, ({ gs }, ref) => {
      if (gs.capacity?.friendlyOverloaded) return;
      const tile = getTile(gs, ref);
      const state = stateOf(tile);
      const rnd = Math.floor(Math.random() * 4) + 2; // 2~5
      let actuallyAdded = 0;
      produce(gs, {
        ref, itemId: 'item_strawberry', qty: rnd, channel: CHANNEL.STORE,
        apply: (k) => {
          const before = state.strawberryStored || 0;
          state.strawberryStored = Math.min(STRAWBERRY_MAX, before + k);
          const a = state.strawberryStored - before;
          actuallyAdded += a;
          return a;
        },
      });
      if (actuallyAdded > 0) toast(`✨ 祝福储存 +${actuallyAdded} 草莓（上限 ${STRAWBERRY_MAX}）`, 2000);
      else toast(`🍓 储存已满（${STRAWBERRY_MAX}/${STRAWBERRY_MAX}），本次不产出`, 2000);
      afterStorageChange(gs, ref);
    });
  },
});
