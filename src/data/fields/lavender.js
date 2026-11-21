// src/data/fields/lavender.js
// 薰衣草花田（FAC-017）
// 【经过时】获得金币*1，并有20%概率获得薰衣草*1
// 【受祝福时】获得薰衣草*2

import { Random } from '../../core/Random.js';
import { addGold } from '../../systems/GoldSystem.js';
import { produce } from '../../systems/ProduceSystem.js';
import { defineField, registerSelfHook, toast } from './fieldKit.js';

export const LavenderField = defineField({
  id: 'facility_lavender',
  emoji: '💜',
  value: 8,

  register() {
    registerSelfHook('onPass', this, ({ gs }, ref) => {
      addGold(gs, 1, '薰衣草花田');
      let msg = '💜 薰衣草花田：金币 +1';
      if (Random.chance(0.2)) {
        produce(gs, { ref, itemId: 'item_lavender', qty: 1 });
        msg += '，薰衣草 +1';
      }
      toast(msg, 1800);
    });

    registerSelfHook('onBlessed', this, ({ gs }, ref) => {
      produce(gs, { ref, itemId: 'item_lavender', qty: 2 });
      toast('✨ 薰衣草 +2', 1800);
    });
  },
});
