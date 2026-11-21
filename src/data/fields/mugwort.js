// src/data/fields/mugwort.js
// 艾草田块（FAC-016）
// 【每一日开始时】获得艾草*2
// 【角色回复生命值时】获得艾草*1（任意途径回血都算）
// 【受祝福时】为角色回复 25% 生命值

import { HookDispatcher } from '../../core/HookDispatcher.js';
import { devLog } from '../../core/Logger.js';
import { HealSystem } from '../../systems/HealSystem.js';
import { produce } from '../../systems/ProduceSystem.js';
import { defineField, eachOwnTile, getTile, isMine, registerSelfHook, toast } from './fieldKit.js';

export const MugwortField = defineField({
  id: 'facility_mugwort',
  emoji: '🍃',
  value: 2,

  register() {
    HookDispatcher.register('onDailyStart', ({ gs }) => {
      let total = 0;
      eachOwnTile(gs, this.id, (ref) => {
        total += produce(gs, { ref, itemId: 'item_mugwort', qty: 2 });
      });
      if (total > 0) toast(`🍃 艾草田块 +${total} 艾草`, 1800);
    }, this);

    // 任意途径回血都算（HealSystem.fire 统一 fire onHeal）
    HookDispatcher.register('onHeal', ({ gs, amount = 0 }) => {
      if (amount <= 0) return;
      let n = 0;
      eachOwnTile(gs, this.id, (ref) => {
        produce(gs, { ref, itemId: 'item_mugwort', qty: 1 });
        n += 1;
      });
      if (n > 0) devLog.info('[mugwort] onHeal +', n);
    }, this);

    registerSelfHook('onBlessed', this, ({ gs }, ref) => {
      const tile = getTile(gs, ref);
      if (!tile) return;
      const actual = HealSystem.healPlayerByPercent(gs, 0.25, { source: this.id });
      toast(`🍃 艾草祝福 回复 ${actual} 生命`, 1800);
    });
  },
});
