// src/data/fields/rice.js
// 水稻田块（FAC-004，v0.6 改写）
// 【每一日开始时】获得稻草*1。若所处地块地形为水面，则额外获得稻草*2
// 【受祝福时】接下来的5日，每一日开始时获得稻草*1
//
// 变更点（相对旧实现）：
//   · 删除「草地 +1」与「相邻水面 +2」
//   · 改为「自身地块地形为水面 → 额外 +2」（合计 3）
//   · 魔导书不变：【庆丰收】相连 ≥3 翻倍；【仓廪实】麦稻视同；【春光好】【稻香远】不受影响

import { HookDispatcher } from '../../core/HookDispatcher.js';
import { GE } from '../../core/GameEvents.js';
import { EventBus } from '../../core/EventBus.js';
import { devLog } from '../../core/Logger.js';
import { normalizeTerrain } from '../terrains.js';
import { FieldEffects } from '../../systems/FieldEffects.js';
import { produce } from '../../systems/ProduceSystem.js';
import { isSuppressed } from '../../systems/SuppressSystem.js';
import { defineField, eachOwnTile, isMine, refOf, toast } from './fieldKit.js';

export const RiceField = defineField({
  id: 'facility_rice',
  emoji: '🌱',
  value: 3,

  register() {
    HookDispatcher.register('onDailyStart', ({ gs }) => {
      let totalBase = 0;
      let totalBless = 0;
      eachOwnTile(gs, this.id, (ref, tile) => {
        let qty = 1;
        if (normalizeTerrain(tile.terrain) === 'terrain_water') qty += 2;
        qty *= FieldEffects.harvestMultiplier(gs, ref);
        totalBase += qty;

        // 受祝福：独立 rice_bless state，剩余天数逐日扣减；额外稻草并入该格本次产出
        let blessAdd = 0;
        for (const bs of (tile.states || [])) {
          if (bs.type === 'rice_bless' && bs.remainingDays > 0) {
            blessAdd += 1;
            bs.remainingDays -= 1;
          }
        }
        totalBless += blessAdd;
        tile.states = (tile.states || []).filter(s =>
          !(s.type === 'rice_bless' && s.remainingDays !== undefined && s.remainingDays <= 0));
        const total = qty + blessAdd;
        if (total > 0) {
          produce(gs, { ref, itemId: 'item_rice_straw', qty: total });
        }
      });
      if (totalBase > 0) {
        const msg = `🌱 每日 +${totalBase} 稻草` + (totalBless > 0 ? `（祝福 +${totalBless}）` : '');
        toast(msg, 2200);
      }
      devLog.info('[rice] base', totalBase, 'bless', totalBless);
      EventBus.emit(GE.INVENTORY_CHANGE);
    }, this);

    HookDispatcher.register('onBlessed', ({ gs, tileIdx, tileRef }) => {
      const ref = refOf(tileIdx, tileRef);
      if (!isMine(gs, ref, this.id)) return;
      if (isSuppressed(gs, ref)) return;
      const tile = eachTile(gs, ref);
      if (!tile) return;
      let rb = (tile.states || []).find(s => s.type === 'rice_bless');
      if (!rb) {
        rb = { type: 'rice_bless', remainingDays: 5 };
        tile.states.push(rb);
      } else {
        rb.remainingDays = Math.max(rb.remainingDays, 5);
      }
      toast(`✨ 稻田受祝福 → 未来 ${rb.remainingDays} 日每日 +1 稻草`, 2400);
    }, this);
  },
});

function eachTile(gs, ref) {
  // 局部避免与 eachOwnTile 语义混淆
  return (gs.map.outerTiles || []).find(t => t.idx === ref)
    || (gs.map.fence || []).find(t => t.ref === ref)
    || null;
}
