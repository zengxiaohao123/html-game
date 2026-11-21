// src/data/fields/ghost_grass.js
// 幽怜草田块（FAC-015）
// 【放置时】储存幽怜草*1（至多 1，初始价值 12）
// 【进入时】可以采摘
// 【受祝福时】储存的幽怜草价值 +12（同一日内第 2 次起每次衰减 2，最低 +0）
// 【每一日开始时】本日未受到过祝福 → 直接枯萎（地块内容消失，变空地块）
//
// 初始价格 12；同日第 2 次起每次价值增加 -2，最低 +0；枯萎 = 地块内容直接失去。

import { HookDispatcher } from '../../core/HookDispatcher.js';
import { contentEntries } from '../../core/TileAccess.js';
import { syncPumpkin } from '../../systems/PassiveItemSystem.js';
import { defineField, getTile, isMine, refreshTile, toast } from './fieldKit.js';

export const GhostGrassField = defineField({
  id: 'facility_ghost_grass',
  emoji: '🌙',
  value: 12,

  register() {
    HookDispatcher.register('onPlace', ({ gs, tileIdx, tileRef }) => {
      const ref = tileRef ?? tileIdx;
      if (!isMine(gs, ref, this.id)) return;
      const tile = getTile(gs, ref);
      const st = tile.contentState || (tile.contentState = {});
      st.ghostStored = true;
      st.ghostValue = 12;
      st.ghostBlessCountToday = 0;
      st.ghostBlessedToday = false;
      refreshTile(gs, ref);
      syncPumpkin(gs); // A-12：储存作物数 +1
    }, this);

    HookDispatcher.register('onBlessed', ({ gs, tileIdx, tileRef }) => {
      const ref = tileRef ?? tileIdx;
      if (!isMine(gs, ref, this.id)) return;
      const tile = getTile(gs, ref);
      const st = tile.contentState || (tile.contentState = {});
      if (!st.ghostStored) return;
      const n = (st.ghostBlessCountToday || 0) + 1;
      const gain = Math.max(0, 12 - 2 * (n - 1));   // 第 1 次 +12，第 2 次 +10，第 3 次 +8 …
      st.ghostValue = (st.ghostValue || 12) + gain;
      st.ghostBlessCountToday = n;
      st.ghostBlessedToday = true;
      toast(`✨ 幽怜草价值 +${gain} → ${st.ghostValue}`, 1800);
      refreshTile(gs, ref);
    }, this);

    HookDispatcher.register('onDailyStart', ({ gs, scopedTileIdx }) => {
      // 初级肥料只重复「产出类」每日效果：枯萎属于跨日结算，
      // 不能让施肥把未祝福的幽怜草直接清掉（肥料白名单也已按【每一日开始时】特性排除本田块）
      if (scopedTileIdx !== undefined) return;
      for (const { ref, tile: t } of contentEntries(gs)) {
        if (t.contentId !== this.id) continue;
        const st = t.contentState || (t.contentState = {});
        if (st.ghostStored && st.ghostBlessedToday === false) {
          t.contentId = null;
          t.contentState = {};
          refreshTile(gs, ref);
          syncPumpkin(gs); // A-12：储存作物数 -1
          toast('🌙 昨日未受祝福，幽怜草枯萎了', 2000);
        }
        // 新的一天重置本日计数
        st.ghostBlessCountToday = 0;
        st.ghostBlessedToday = false;
      }
    }, this);
  },
});
