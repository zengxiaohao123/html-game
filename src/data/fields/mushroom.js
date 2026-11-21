// src/data/fields/mushroom.js
// 蘑菇田块（FAC-022）
// 【每一日开始时】储存蘑菇*2（至多6）。储存超出上限时向相邻空地块扩散1个蘑菇田块
// 【进入时】可以取走储存的蘑菇
// 【受祝福时】储存蘑菇*5。储存超出上限扩散
// 蘑菇田块所在地块地形为水面时，所有特性失效
//
// 扩散口径：目标必须是外圈地块（小径不算）且地块内容为空；多个候选随机 1 个；
//           一次超上限只扩散 1 块，多余丢弃。

import { HookDispatcher } from '../../core/HookDispatcher.js';
import { EventBus } from '../../core/EventBus.js';
import { GE } from '../../core/GameEvents.js';
import { Random } from '../../core/Random.js';
import { getTile, neighborRefs } from '../../core/TileAccess.js';
import { normalizeTerrain } from '../terrains.js';
import { produce, CHANNEL } from '../../systems/ProduceSystem.js';
import {
  defineField, afterStorageChange, eachOwnTile, ITEMS, refreshTile, registerSelfHook, stateOf, tileOf, toast,
} from './fieldKit.js';

export const MUSHROOM_ID = 'facility_mushroom';
export const MUSHROOM_MAX = 6;
export const MUSHROOM_DAILY = 2;
export const MUSHROOM_BLESS = 5;

export function mushroomStoredOf(tile) {
  const n = Number(tile?.contentState?.mushroomStored);
  return Number.isFinite(n) ? Math.max(0, Math.min(MUSHROOM_MAX, Math.floor(n))) : 0;
}

export function isWaterTile(tile) {
  return normalizeTerrain(tile?.terrain) === 'terrain_water';
}

/** 储存蘑菇；返回 { added, overflow }（overflow = 本次按上限截断过） */
export function addMushroomStored(tile, n) {
  const cs = stateOf(tile);
  const before = mushroomStoredOf(tile);
  const raw = before + Math.max(0, Math.floor(n));
  cs.mushroomStored = Math.min(MUSHROOM_MAX, raw);
  return { added: cs.mushroomStored - before, overflow: raw > MUSHROOM_MAX };
}

/** 向相邻（4 方向）外圈空地扩散 1 个蘑菇田块 */
export function spreadMushroom(gs, ref) {
  const candidates = [];
  for (const nb of neighborRefs(gs, ref)) {
    const tile = (gs.map.outerTiles || []).find(t => t.idx === nb);
    if (tile && !tile.contentId) candidates.push(tile);
  }
  if (candidates.length === 0) return null;
  const target = Random.pick(candidates);
  target.contentId = MUSHROOM_ID;
  target.contentState = { mushroomStored: 0 };
  target.states = [];
  target.dailyFlags = {};
  EventBus.emit(GE.TILE_CONTENT_CHANGED, {
    tileIdx: target.idx, tileRef: target.idx, newContentId: MUSHROOM_ID, oldContentId: null,
  });
  EventBus.emit(GE.TOAST_SHOW, {
    text: `🍄 蘑菇田块向相邻空地扩散了 1 个（${ITEMS[MUSHROOM_ID]?.name || '蘑菇田块'}）`, duration: 2400,
  });
  return target;
}

export const MushroomField = defineField({
  id: MUSHROOM_ID,
  emoji: '🍄',
  value: 8,

  register() {
    HookDispatcher.register('onPlace', ({ gs, tileIdx, tileRef, contentId }) => {
      if (contentId !== this.id) return;
      const tile = tileOf(gs, tileRef ?? tileIdx);
      if (tile) stateOf(tile).mushroomStored = mushroomStoredOf(tile);
    }, this);

    const grow = (amount, hook) => ({ gs }) => {
      eachOwnTile(gs, this.id, (ref, tile) => {
        if (isWaterTile(tile)) return; // 水面：所有特性失效
        let overflow = false;
        produce(gs, {
          ref, itemId: 'item_mushroom', qty: amount, channel: CHANNEL.STORE,
          apply: (k) => {
            const r = addMushroomStored(tile, k);
            if (r.overflow) overflow = true;
            return r.added;
          },
        });
        if (overflow) spreadMushroom(gs, ref);
        afterStorageChange(gs, ref);
      });
    };

    HookDispatcher.register('onDailyStart', grow(MUSHROOM_DAILY, 'dailyStart'), this);

    registerSelfHook('onBlessed', this, ({ gs }, ref) => {
      const tile = tileOf(gs, ref);
      if (!tile || isWaterTile(tile)) return;
      let overflow = false;
      produce(gs, {
        ref, itemId: 'item_mushroom', qty: MUSHROOM_BLESS, channel: CHANNEL.STORE,
        apply: (k) => {
          const r = addMushroomStored(tile, k);
          if (r.overflow) overflow = true;
          return r.added;
        },
      });
      if (overflow) spreadMushroom(gs, ref);
      afterStorageChange(gs, ref);
      toast(`✨ 储存蘑菇（${mushroomStoredOf(tile)}/${MUSHROOM_MAX}）`, 2000);
      refreshTile(gs, ref);
    });
  },
});
