// src/data/fields/pea.js
// 豌豆田块（FAC-005）
// 【使用技能时】储存豌豆*1（至多 10，每 2 回合限 1 次）
// 【进入时】可以取走储存的豌豆
// 【受祝福时】自动取走储存的豌豆（不用玩家去点）
//
// §13.2：友善超载惩罚 → 友善类收益归 0（除小麦/水稻）。

import { HookDispatcher } from '../../core/HookDispatcher.js';
import { devLog } from '../../core/Logger.js';
import { tileRefKey } from '../../core/TileAccess.js';
import { produce, CHANNEL, takeStoredToBag } from '../../systems/ProduceSystem.js';
import { syncPumpkin } from '../../systems/PassiveItemSystem.js';
import {
  afterStorageChange, defineField, eachOwnTile, getTile, isMine, refreshTile, registerSelfHook, stateOf, toast,
} from './fieldKit.js';

export const PEA_MAX = 10;

export const PeaField = defineField({
  id: 'facility_pea',
  emoji: '🫛',
  value: 4,

  register() {
    // onUseSkill：每 2 回合限 1 次（用 gs.turn - last >= 2 判断）
    HookDispatcher.register('onUseSkill', ({ gs }) => {
      if (gs.capacity?.friendlyOverloaded) return;
      eachOwnTile(gs, this.id, (ref, tile) => {
        const state = stateOf(tile);
        const lastTurn = state.peaLastSkillTurn ?? -999;
        if (gs.turn - lastTurn < 2) return; // 距上次不足 2 回合，跳过
        state.peaLastSkillTurn = gs.turn;
        produce(gs, {
          ref, itemId: 'item_pea', qty: 1, channel: CHANNEL.STORE,
          apply: (k) => {
            const before = state.peaStored || 0;
            state.peaStored = Math.min(PEA_MAX, before + k);
            return state.peaStored - before;
          },
        });
        devLog.info('[pea] tile', tileRefKey(ref), '+1 pea (turn', gs.turn, '), now', state.peaStored);
        refreshTile(gs, ref);
      });
      syncPumpkin(gs); // A-12
    }, this);

    HookDispatcher.register('onEveryNTurn', () => {
      // 豌豆架每 2 回合限 1 次 —— 由 onUseSkill 的 turn 差判断，不主动 fire 此 hook
    }, this);

    // 收获豌豆改为 InfoPanel 手动滑动条触发（§16.4）
    HookDispatcher.register('onEnter', ({ gs, tileIdx, tileRef }) => {
      if (!isMine(gs, tileRef ?? tileIdx, this.id)) return;
      devLog.info('[pea] onEnter (manual harvest via InfoPanel now)');
    }, this);

    // 祝福：自动取走储存的豌豆
    registerSelfHook('onBlessed', this, ({ gs }, ref) => {
      const tile = getTile(gs, ref);
      const state = stateOf(tile);
      const stored = state.peaStored || 0;
      if (stored <= 0) return;
      takeStoredToBag(gs, ref, 'item_pea', stored);
      state.peaStored = 0;
      toast(`✨ 祝福自动收获 +${stored} 豌豆`, 2000);
      afterStorageChange(gs, ref);
    });
  },
});
