// src/data/fields/blue_star_fruit.js
// 蓝星果田块（FAC-025）
// 【每一日开始时】储存蓝星果*1（至多7）。储存的蓝星果会散发小范围【蓝息】，数量越多范围越大
// 【进入时】可以取走蓝星果
// 蓝息：半径 0.6 + 0.2×(储存数-1) 米；范围内田块产出的作物 10% 变异为【湛蓝】【违禁品】；
//       范围内角色与生物最大生命 / 攻击 +25%，生物移速 +50%；
//       特殊NPC例行搜查系统尚未开发，本文件不实现。
//
// 口径：蓝星果本体恒为【湛蓝】不参与随机；蓝星果田块通过【产出时】额外产出的其它作物照常判定；
//       范围重叠取最高、不叠加、不重复判定。

import { HookDispatcher } from '../../core/HookDispatcher.js';
import { produce, CHANNEL } from '../../systems/ProduceSystem.js';
import { BLUE_FIELD_ID, BLUE_MAX, syncBlueBreath } from '../../systems/BlueBreathSystem.js';
import {
  defineField, afterStorageChange, eachOwnTile, stateOf, tileOf, toast,
} from './fieldKit.js';

export { BLUE_FIELD_ID, BLUE_MAX };

export function blueStoredOf(tile) {
  const n = Number(tile?.contentState?.blueStored);
  return Number.isFinite(n) ? Math.max(0, Math.min(BLUE_MAX, Math.floor(n))) : 0;
}

export function addBlueStored(tile, n) {
  const cs = stateOf(tile);
  const before = blueStoredOf(tile);
  cs.blueStored = Math.min(BLUE_MAX, before + Math.max(0, Math.floor(n)));
  return cs.blueStored - before;
}

export const BlueStarFruitField = defineField({
  id: BLUE_FIELD_ID,
  emoji: '💙',
  value: 20,

  register() {
    HookDispatcher.register('onPlace', ({ gs, tileIdx, tileRef, contentId }) => {
      if (contentId !== this.id) return;
      const tile = tileOf(gs, tileRef ?? tileIdx);
      if (tile) stateOf(tile).blueStored = blueStoredOf(tile);
      syncBlueBreath(gs);
    }, this);

    HookDispatcher.register('onDailyStart', ({ gs }) => {
      let changed = false;
      eachOwnTile(gs, this.id, (ref, tile) => {
        const added = produce(gs, {
          ref, itemId: 'item_blue_starfruit', qty: 1, channel: CHANNEL.STORE,
          apply: (k) => addBlueStored(tile, k),
        });
        if (added > 0) {
          changed = true;
          afterStorageChange(gs, ref);
        }
      });
      if (changed) syncBlueBreath(gs);
    }, this);
  },
});
