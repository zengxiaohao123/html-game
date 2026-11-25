// src/data/fields/mushroom.js
// 蘑菇田块（FAC-022）
// 【每一日开始时】储存蘑菇*2（至多6）。储存超出上限时向相邻空地块扩散1个蘑菇田块
// 【进入时】可以取走储存的蘑菇
// 【受祝福时】储存蘑菇*5。储存超出上限扩散
// 蘑菇田块所在地块地形为水面时，其余所有特性失效
//
// 扩散口径：目标必须是外圈地块（小径不算）且地块内容为空；多个候选随机 1 个；
//           一次超上限只扩散 1 块，多余丢弃。
//           储存已满（本次一个都存不进）视为没有产出：不扩散、不触发【产出时】。
//           只有本次真的存入了一部分、且总量超过上限时，才算「溢出」并扩散。
//           扩散生成的田块与「一手放置」完全等同：同一条 onPlace 初始化 + 同一套地块标识，
//           扩建时随地块对象一起重映射（不得因扩建消失）。

import { HookDispatcher } from '../../core/HookDispatcher.js';
import { EventBus } from '../../core/EventBus.js';
import { GE } from '../../core/GameEvents.js';
import { Random } from '../../core/Random.js';
import { getTile, isOuterRef, neighborRefs } from '../../core/TileAccess.js';
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
    if (!isOuterRef(gs, nb)) continue; // 小径格不算扩散目标
    const tile = getTile(gs, nb);      // 以地块位置（数组下标）为准，避免旧 idx 失配
    if (tile && !tile.contentId) candidates.push({ tile, ref: nb });
  }
  if (candidates.length === 0) return null;
  const { tile: target, ref: targetRef } = Random.pick(candidates);
  target.contentId = MUSHROOM_ID;
  target.contentState = {};
  target.states = [];
  target.dailyFlags = {};
  // 与 BuildSystem.placeContent 同一条初始化链路：扩散出的田块与手放田块完全等同
  HookDispatcher.fire('onPlace', { gs, tileIdx: targetRef, tileRef: targetRef, contentId: MUSHROOM_ID });
  EventBus.emit(GE.TILE_CONTENT_CHANGED, {
    tileIdx: targetRef, tileRef: targetRef, newContentId: MUSHROOM_ID, oldContentId: null,
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
        if (isWaterTile(tile)) return; // 水面：其余所有特性失效
        let overflow = false;
        let added = 0;
        produce(gs, {
          ref, itemId: 'item_mushroom', qty: amount, channel: CHANNEL.STORE,
          apply: (k) => {
            const r = addMushroomStored(tile, k);
            if (r.overflow) overflow = true;
            added += r.added;
            return r.added;
          },
        });
        // 储存已满（added = 0）视为本次没有产出：不扩散
        if (added > 0 && overflow) spreadMushroom(gs, ref);
        afterStorageChange(gs, ref);
      });
    };

    HookDispatcher.register('onDailyStart', grow(MUSHROOM_DAILY, 'dailyStart'), this);

    registerSelfHook('onBlessed', this, ({ gs }, ref) => {
      const tile = tileOf(gs, ref);
      if (!tile || isWaterTile(tile)) return;
      let overflow = false;
      let added = 0;
      produce(gs, {
        ref, itemId: 'item_mushroom', qty: MUSHROOM_BLESS, channel: CHANNEL.STORE,
        apply: (k) => {
          const r = addMushroomStored(tile, k);
          if (r.overflow) overflow = true;
          added += r.added;
          return r.added;
        },
      });
      if (added > 0 && overflow) spreadMushroom(gs, ref);
      afterStorageChange(gs, ref);
      toast(`✨ 储存蘑菇（${mushroomStoredOf(tile)}/${MUSHROOM_MAX}）`, 2000);
      refreshTile(gs, ref);
    });
  },
});
