// src/data/fields/starfruit.js
// 杨桃田块（FAC-021）
// 【每一日开始时】【每一日结束时】【进入时】获得8成长值。成长值达到200后，获得杨桃*1并将成长值重置为100
// 【受祝福时】获得16成长值
//
// 口径：每块独立成长；达到 200 后溢出部分丢弃并置为 100。

import { HookDispatcher } from '../../core/HookDispatcher.js';
import { produce } from '../../systems/ProduceSystem.js';
import {
  defineField, eachOwnTile, refreshTile, registerSelfHook, stateOf, tileOf, toast,
} from './fieldKit.js';

export const STARFRUIT_ID = 'facility_starfruit';
export const STARFRUIT_THRESHOLD = 200;
export const STARFRUIT_RESET = 100;
export const STARFRUIT_GAIN = 8;
export const STARFRUIT_BLESS_GAIN = 16;

export function starfruitGrowthOf(tile) {
  const n = Number(tile?.contentState?.starfruitGrowth);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

/** 增加成长值并结算；返回本次获得杨桃数量 */
export function addStarfruitGrowth(gs, ref, tile, amount) {
  const cs = stateOf(tile);
  cs.starfruitGrowth = starfruitGrowthOf(tile) + amount;
  let gained = 0;
  while (cs.starfruitGrowth >= STARFRUIT_THRESHOLD) {
    cs.starfruitGrowth = STARFRUIT_RESET;
    if (produce(gs, { ref, itemId: 'item_starfruit', qty: 1 }) > 0) gained += 1;
    // 防御：保守处理，避免死循环（成长值已重置为 100，正常不会再进循环）
    if (gained > 8) break;
  }
  return gained;
}

export const StarfruitField = defineField({
  id: STARFRUIT_ID,
  emoji: '⭐',
  value: 16,

  register() {
    HookDispatcher.register('onPlace', ({ gs, tileIdx, tileRef, contentId }) => {
      if (contentId !== this.id) return;
      const tile = tileOf(gs, tileRef ?? tileIdx);
      if (tile) stateOf(tile).starfruitGrowth = starfruitGrowthOf(tile);
    }, this);

    const grow = (hook) => ({ gs }) => {
      eachOwnTile(gs, this.id, (ref, tile) => {
        const gained = addStarfruitGrowth(gs, ref, tile, STARFRUIT_GAIN);
        if (gained > 0) toast(`⭐ 获得杨桃 ×${gained}`, 2000);
        refreshTile(gs, ref);
      });
    };
    HookDispatcher.register('onDailyStart', grow('dailyStart'), this);
    HookDispatcher.register('onDailyEnd', grow('dailyEnd'), this);

    // 经过不算，进入才算（【进入时】）
    registerSelfHook('onEnter', this, ({ gs }, ref) => {
      const tile = tileOf(gs, ref);
      if (!tile) return;
      const gained = addStarfruitGrowth(gs, ref, tile, STARFRUIT_GAIN);
      if (gained > 0) toast(`⭐ 获得杨桃 ×${gained}`, 2000);
      refreshTile(gs, ref);
    });

    registerSelfHook('onBlessed', this, ({ gs }, ref) => {
      const tile = tileOf(gs, ref);
      if (!tile) return;
      const gained = addStarfruitGrowth(gs, ref, tile, STARFRUIT_BLESS_GAIN);
      if (gained > 0) toast(`✨ 获得杨桃 ×${gained}`, 2200);
      refreshTile(gs, ref);
    });
  },
});
