// src/data/fields/mugwort.js
// 艾草田块（FAC-016）
// 【角色回复生命值时】获得艾草*1（每回合限 2 次，回合开始重置计数）
// 【受祝福时】为角色回复 25% 生命值

import { HookDispatcher } from '../../core/HookDispatcher.js';
import { devLog } from '../../core/Logger.js';
import { HealSystem } from '../../systems/HealSystem.js';
import { produce } from '../../systems/ProduceSystem.js';
import { defineField, eachOwnTile, getTile, registerSelfHook, toast } from './fieldKit.js';

const HEAL_GAIN_PER_TURN = 2;

export const MugwortField = defineField({
  id: 'facility_mugwort',
  emoji: '🍃',
  value: 2,

  register() {
    // 回合开始：重置本回合的「回血获得艾草」计数
    HookDispatcher.register('onTurnStart', ({ gs }) => {
      eachOwnTile(gs, this.id, (_ref, tile) => {
        if (tile?.contentState) tile.contentState.mugwortHealCount = 0;
      }, { skipSuppressed: false });
    }, this);

    // 任意途径回血都算（HealSystem.fire 统一 fire onHeal）；每块田每回合至多 2 次
    HookDispatcher.register('onHeal', ({ gs, amount = 0 }) => {
      if (amount <= 0) return;
      let n = 0;
      eachOwnTile(gs, this.id, (ref, tile) => {
        const cs = tile.contentState || (tile.contentState = {});
        const used = Number(cs.mugwortHealCount) || 0;
        if (used >= HEAL_GAIN_PER_TURN) return;
        if (produce(gs, { ref, itemId: 'item_mugwort', qty: 1 }) <= 0) return;
        cs.mugwortHealCount = used + 1;
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
