// src/data/fields/wild_seed.js
// 野生种子（FAC-013）
// 【放置时】变为随机田块（调用【田块池1】= POOL-01）
//
// 占位物品：平时不进随机池，只有池子候选不足时才补入；允许叠加，无【唯一】。

import { HookDispatcher } from '../../core/HookDispatcher.js';
import { devLog } from '../../core/Logger.js';
import { drawFromPool } from '../../systems/RandomPool.js';
import { defineField, getTile, isMine, refreshTile, toast } from './fieldKit.js';
import { ITEMS } from '../items.js';

export const WildSeedField = defineField({
  id: 'facility_wild_seed',
  emoji: '🌱',
  value: 1,

  register() {
    HookDispatcher.register('onPlace', ({ gs, tileIdx, tileRef }) => {
      const ref = tileRef ?? tileIdx;
      if (!isMine(gs, ref, this.id)) return;
      const tile = getTile(gs, ref);

      // 从田块池1 抽 1 个田块；抽中占位（野生种子）时重抽，避免自己变自己
      let picked = null;
      for (let i = 0; i < 8; i++) {
        const [hit] = drawFromPool('POOL-01', 1, { unique: true, gs });
        if (hit && hit.id && hit.id !== this.id) { picked = hit; break; }
      }
      if (!picked) {
        devLog.warn('[wildSeed] 田块池1 抽不到非占位田块，保持原样');
        return;
      }
      tile.contentId = picked.id;
      refreshTile(gs, ref);
      toast(`🌱 野生种子长成了 ${ITEMS[picked.id]?.name || picked.name}`, 2200);
      devLog.info('[wildSeed] →', picked.id);
    }, this);
  },
});
