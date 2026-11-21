// src/data/fields/blackberry.js
// 黑莓田块（FAC-023）
// 【每一日开始时】获得黑莓*2。【压制】周围8格的非黑莓田块
// 【受祝福时】获得黑莓*2。暂时解除【压制】，持续4天
//
// 压制本身在 FieldAuraSystem.preDailyStart → SuppressSystem.applyBlackberrySuppression 中
// 「优先结算」，保证当天其它田块产出已受压制影响；这里只负责收获与解除。

import { HookDispatcher } from '../../core/HookDispatcher.js';
import { produce } from '../../systems/ProduceSystem.js';
import { releaseBlackberry } from '../../systems/SuppressSystem.js';
import { defineField, eachOwnTile, refreshTile, registerSelfHook, toast } from './fieldKit.js';

export const BLACKBERRY_ID = 'facility_blackberry';

export const BlackberryField = defineField({
  id: BLACKBERRY_ID,
  emoji: '🫐',
  value: 12,

  register() {
    HookDispatcher.register('onDailyStart', ({ gs }) => {
      eachOwnTile(gs, this.id, (ref) => {
        produce(gs, { ref, itemId: 'item_blackberry', qty: 2 });
      });
    }, this);

    registerSelfHook('onBlessed', this, ({ gs }, ref) => {
      produce(gs, { ref, itemId: 'item_blackberry', qty: 2 });
      const cleared = releaseBlackberry(gs, ref);
      refreshTile(gs, ref);
      toast(`✨ 黑莓 +2，解除周围 ${cleared} 格【压制】（持续 4 天）`, 2600);
    });
  },
});
