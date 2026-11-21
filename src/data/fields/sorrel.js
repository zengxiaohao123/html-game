// src/data/fields/sorrel.js
// 酢浆草田块（FAC-024）
// 【经过时】本日内，本田块受到【压制】
// 【每一日结束时】【受祝福时】获得酢浆草*4
//
// 口径：自压制按【压制】术语执行 —— 当日全部特性失效，日末与受祝福均不结算。

import { HookDispatcher } from '../../core/HookDispatcher.js';
import { produce } from '../../systems/ProduceSystem.js';
import { suppressSelfToday } from '../../systems/SuppressSystem.js';
import {
  defineField, eachOwnTile, refreshTile, registerSelfHook, toast,
} from './fieldKit.js';

export const SORREL_ID = 'facility_sorrel';

export const SorrelField = defineField({
  id: SORREL_ID,
  emoji: '🍀',
  value: 8,

  register() {
    // 经过：自压制（注意：registerSelfHook 会跳过已压制格，重复经过不会重复提示）
    registerSelfHook('onPass', this, ({ gs }, ref) => {
      suppressSelfToday(gs, ref);
      refreshTile(gs, ref);
      toast('🍀 酢浆草田块本日受到【压制】', 2000);
    });

    HookDispatcher.register('onDailyEnd', ({ gs }) => {
      eachOwnTile(gs, this.id, (ref) => {
        produce(gs, { ref, itemId: 'item_sorrel', qty: 4 });
      });
    }, this);

    registerSelfHook('onBlessed', this, ({ gs }, ref) => {
      produce(gs, { ref, itemId: 'item_sorrel', qty: 4 });
      toast('✨ 酢浆草 +4', 1800);
    });
  },
});
