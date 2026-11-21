// src/data/fields/sunflower.js
// 向日葵花田（FAC-018）
// 【每一日开始时】使周围8格的随机1格田块获得持续一天的临时特性：
//     【产出时】产量+1，并有10%概率获得向日葵*1
// 【受祝福时】使周围8格的所有田块获得该临时特性
//
// 日初授予在 FieldAuraSystem.preDailyStart 中「优先结算」，保证当天其它田块产出即可吃到；
// 本文件只负责受祝福时的即时授予。

import { grantSunflowerTraits } from '../../systems/FieldAuraSystem.js';
import { defineField, refreshTile, registerSelfHook, toast } from './fieldKit.js';

export const SunflowerField = defineField({
  id: 'facility_sunflower',
  emoji: '🌻',
  value: 12,

  register() {
    registerSelfHook('onBlessed', this, ({ gs }, ref) => {
      const granted = grantSunflowerTraits(gs, { onlyRef: ref, all: true });
      toast(`✨ 向日葵花田：周围 ${granted} 格获得【产出时】`, 2400);
      refreshTile(gs, ref);
    });
  },
});
