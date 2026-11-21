// src/data/fields/wheat.js
// 小麦田块（FAC-001）
// 【每一日开始时】获得小麦*2（草地额外*1）
// 【受祝福时】获得小麦*3
//
// §13.2：友善超载惩罚「友善类收益归 0」明确排除小麦/水稻 —— 本产出不受惩罚影响。

import { HookDispatcher } from '../../core/HookDispatcher.js';
import { normalizeTerrain } from '../terrains.js';
import { FieldEffects } from '../../systems/FieldEffects.js';
import { produce } from '../../systems/ProduceSystem.js';
import { defineField, eachOwnTile, registerSelfHook, toast } from './fieldKit.js';

export const WheatField = defineField({
  id: 'facility_wheat',
  emoji: '🌾',
  value: 3,

  register() {
    HookDispatcher.register('onDailyStart', ({ gs }) => {
      let total = 0;
      eachOwnTile(gs, this.id, (ref, tile) => {
        let qty = 2;
        if (normalizeTerrain(tile.terrain) === 'terrain_grass') qty += 1;
        // 魔导书【庆丰收】：该格视同水稻田块且处在「≥3 相连」的簇内 → 该格产出 +100%
        qty *= FieldEffects.harvestMultiplier(gs, ref);
        // 统一走 produce 漏斗：该格若带【产出时】临时特性（向日葵）本次 +1
        qty = produce(gs, { ref, itemId: 'item_wheat', qty });
        total += qty;
      });
      if (total > 0) toast(`🌾 每日 +${total} 小麦`, 2000);
    }, this);

    // 祝福即时触发一次（草地不加成，按物品库文案固定 ×3）
    registerSelfHook('onBlessed', this, ({ gs }, ref) => {
      const qty = produce(gs, { ref, itemId: 'item_wheat', qty: 3 });
      toast(`🌾 祝福 +${qty} 小麦`, 2000);
    });
  },
});
