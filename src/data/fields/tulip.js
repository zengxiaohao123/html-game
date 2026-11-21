// src/data/fields/tulip.js
// 郁金香花田（FAC-003）
// 【每一日开始时】价值随机 -4 ~ +10（存在 tile.contentState.tulipValue；对外显示 max(0, val)）
// 【受祝福时】立即触发 2 次每日效果
//
// 魔导书「泡沫」→ -9~+18；「郁金香，简单！」改为每回合波动（此处在日初路径跳过）。

import { HookDispatcher } from '../../core/HookDispatcher.js';
import { devLog } from '../../core/Logger.js';
import { contentEntries, tileRefKey } from '../../core/TileAccess.js';
import { applyTulipFluctuation, tulipDisplayValue } from '../../systems/TulipSystem.js';
import { isSuppressed } from '../../systems/SuppressSystem.js';
import { defineField, flagKey, getTile, refreshTile, registerSelfHook, toast } from './fieldKit.js';

export const TulipField = defineField({
  id: 'facility_tulip',
  emoji: '🌷',
  value: 8,

  register() {
    HookDispatcher.register('onDailyStart', ({ gs }) => {
      for (const { ref, tile: t } of contentEntries(gs)) {
        if (t.contentId !== this.id) continue;
        // 【压制】禁用该地块所有特性，不做例外
        if (isSuppressed(gs, ref)) continue;
        const key = flagKey(this.id, 'onDailyStart');
        if (t.dailyFlags[key]) continue;
        t.dailyFlags[key] = true;
        const value = applyTulipFluctuation(gs, t, 'daily', ref);
        devLog.info('[tulip] tile', tileRefKey(ref), 'value →', value);
      }
    }, this);

    registerSelfHook('onBlessed', this, ({ gs }, ref) => {
      const tile = getTile(gs, ref);
      // 立即触发 2 次波动（叠放倍率 / 泡沫区间 / 简单！回合区间都按当前生效规则）
      applyTulipFluctuation(gs, tile, 'bless', ref);
      toast(`✨ 郁金香祝福 +2 次波动，当前值 ${tulipDisplayValue(gs, tile)}`, 2000);
      refreshTile(gs, ref);
    });
  },
});
