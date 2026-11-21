// src/data/fields/corn.js
// 玉米田块（FAC-007，§10.11）
// 【生物增加时】获得玉米*1
// 【受祝福时】获得随机 1 个生物（60% 友善 / 40% 危险 / 0% 高危）
//
// 注意：onCreatureAdded 由 CreatureSystem 在 spawnCreature 时 fire。

import { HookDispatcher } from '../../core/HookDispatcher.js';
import { devLog } from '../../core/Logger.js';
import { isFenceRef } from '../../core/TileAccess.js';
import { Random } from '../../core/Random.js';
import { CreatureSystem } from '../../systems/CreatureSystem.js';
import { drawFromPool } from '../../systems/RandomPool.js';
import { CREATURES, SLIME_KINDS } from '../creatures.js';
import { produce } from '../../systems/ProduceSystem.js';
import { defineField, eachOwnTile, registerSelfHook, toast } from './fieldKit.js';

export const CornField = defineField({
  id: 'facility_corn',
  emoji: '🌽',
  value: 4,

  register() {
    // 任何生物（友善/危险/高危）增加时，每块玉米田 +1 玉米
    HookDispatcher.register('onCreatureAdded', ({ gs }) => {
      let total = 0;
      eachOwnTile(gs, this.id, (ref) => {
        total += produce(gs, { ref, itemId: 'item_corn', qty: 1 });
      });
      if (total > 0) toast(`🌽 生物增加 → +${total} 玉米`, 1800);
    }, this);

    // 受祝福：随机 1 个生物（随机生物池 1 = POOL-02；抽中史莱姆再随机元素变体）
    registerSelfHook('onBlessed', this, ({ gs }, ref) => {
      const hits = drawFromPool('POOL-02', 1, { gs });
      const picked = hits[0];
      if (!picked || !picked.id) return;
      const kind = picked.id === 'slime' ? Random.pick(SLIME_KINDS) : picked.id;
      const creature = CreatureSystem.spawnCreature(gs, kind, {
        facilityId: this.id,
        sourceTileIdx: isFenceRef(ref) ? null : ref,
        sourceTileRef: ref,
      });
      if (creature) {
        toast(`🌽 玉米田受祝福 → ${CREATURES[kind].emoji} ${CREATURES[kind].name} 出现`, 2000);
      } else {
        toast('🌽 玉米田受祝福 → 围栏已满，无法生成生物', 2000);
      }
      devLog.info('[corn] onBlessed spawn', kind);
    });
  },
});
