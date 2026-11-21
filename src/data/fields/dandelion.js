// src/data/fields/dandelion.js
// 蒲公英田块（FAC-014）
// 【放置时】【受祝福时】储存蒲公英*1（至多 1）
// 【移动后】按本次移动的曼哈顿距离提升储存蒲公英价值（初始 1）
// 可随时采摘：获得等同当前价值的蒲公英 ×1，并失去该地块内容
//
// 每移动 1 格曼哈顿距离价值 +1（初始 1）；使用载具移动按起点到落点计算。

import { HookDispatcher } from '../../core/HookDispatcher.js';
import { EventBus } from '../../core/EventBus.js';
import { GE } from '../../core/GameEvents.js';
import { contentEntries } from '../../core/TileAccess.js';
import { syncPumpkin } from '../../systems/PassiveItemSystem.js';
import { defineField, getTile, isMine, refreshTile, toast } from './fieldKit.js';

export const DandelionField = defineField({
  id: 'facility_dandelion',
  emoji: '🌼',
  value: 1,

  register() {
    const ensureStored = (tile) => {
      const st = tile.contentState || (tile.contentState = {});
      if (!st.dandelionStored) {
        st.dandelionStored = true;
        st.dandelionValue = st.dandelionValue || 1;
      }
      return st;
    };

    HookDispatcher.register('onPlace', ({ gs, tileIdx, tileRef }) => {
      const ref = tileRef ?? tileIdx;
      if (!isMine(gs, ref, this.id)) return;
      const tile = getTile(gs, ref);
      const st = ensureStored(tile);
      st.dandelionValue = 1;
      refreshTile(gs, ref);
      syncPumpkin(gs); // A-12：储存作物数 +1
    }, this);

    HookDispatcher.register('onBlessed', ({ gs, tileIdx, tileRef }) => {
      const ref = tileRef ?? tileIdx;
      if (!isMine(gs, ref, this.id)) return;
      const tile = getTile(gs, ref);
      ensureStored(tile);   // 已储存则不叠加（至多 1 个）
      toast(`✨ 蒲公英价值提升至 ${Math.max(0, tile.contentState.dandelionValue)}`, 1800);
      refreshTile(gs, ref);
    }, this);

    // onMoveEnd：params.distance = 本次移动的曼哈顿距离（由 MovementSystem 传入）
    HookDispatcher.register('onMoveEnd', ({ gs, distance = 0 }) => {
      if (distance <= 0) return;
      const tiles = contentEntries(gs).filter(e => e.tile.contentId === this.id);
      for (const { tile: t } of tiles) {
        const st = t.contentState || (t.contentState = {});
        if (!st.dandelionStored) continue;
        st.dandelionValue = (st.dandelionValue || 1) + distance;
      }
      if (tiles.length) EventBus.emit(GE.TILE_UPDATED);
    }, this);
  },
});
