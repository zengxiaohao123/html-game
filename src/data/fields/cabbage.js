// src/data/fields/cabbage.js
// 卷心菜田块（FAC-008，§10.12）
// 【每一日开始时】获得卷心菜*2，然后消耗背包里的一个卷心菜投向最近敌人，造成 20 点草元素伤害
// 【受祝福时】对所有敌人分别投掷一个卷心菜（不消耗背包中的卷心菜）
//
// 注意：blessed 状态在 DaySystem.startNewDay 第 3 步就被清除（早于第 6 步 onDailyStart），
//   所以「祝福投掷」标记必须落在 contentState 上，不能依赖 states 里的 blessed。

import { HookDispatcher } from '../../core/HookDispatcher.js';
import { devLog } from '../../core/Logger.js';
import { refXY, tileRefKey } from '../../core/TileAccess.js';
import * as InventorySystem from '../../systems/InventorySystem.js';
import { CombatSystem } from '../../systems/CombatSystem.js';
import { PendingDeathQueue } from '../../systems/PendingDeathQueue.js';
import { produce } from '../../systems/ProduceSystem.js';
import { getCreatureDef } from '../creatures.js';
import { defineField, eachOwnTile, flagKey, getTile, registerSelfHook, stateOf, toast } from './fieldKit.js';

export const CabbageField = defineField({
  id: 'facility_cabbage',
  emoji: '🥬',
  value: 4,

  register() {
    const throwCabbage = (gs, fromRef, target) => {
      CombatSystem.applyElementalDamageToCreature(gs, target, 20, 'grass', { source: 'facility_cabbage' });
      // 地块伤害不经过技能批次 → 击杀需要在此立即入队并 flush（掉落 / 图鉴 / 天赋回调一致）
      if (target.hp <= 0) {
        const deaths = new PendingDeathQueue(gs);
        deaths.markDead(target);
        deaths.flush();
      }
      toast(`🥬 卷心菜投向 ${getCreatureDef(target.kind)?.name || '敌人'} → 20 草元素伤害`, 1600);
      devLog.info('[cabbage] throw →', target.kind, 'from tile',
        typeof fromRef === 'number' ? fromRef : tileRefKey(fromRef));
    };

    HookDispatcher.register('onDailyStart', ({ gs }) => {
      eachOwnTile(gs, this.id, (ref, tile) => {
        const key = flagKey(this.id, 'onDailyStart');
        if (tile.dailyFlags[key]) return;
        tile.dailyFlags[key] = true;

        // 1) 先 +2 卷心菜（走 produce：该格带【产出时】则本次 +1）
        produce(gs, { ref, itemId: 'item_cabbage', qty: 2 });
        toast('🥬 每日 +2 卷心菜', 1500);

        const enemies = gs.creatures.filter(c => c.category !== 'friendly' && c.hp > 0);
        const blessedThrow = !!stateOf(tile).cabbageAllThrowNext;
        if (blessedThrow) {
          // 祝福：对所有敌人分别投掷一个，不消耗背包
          tile.contentState.cabbageAllThrowNext = false;
          if (enemies.length === 0) {
            toast('🥬 祝福投掷：当前没有敌人', 1600);
          } else {
            for (const c of enemies) throwCabbage(gs, ref, c);
          }
          return;
        }

        // 2) 非祝福：背包里有卷心菜才投（没有则不投、不消耗）
        if (InventorySystem.countItem(gs, 'item_cabbage') < 1) return;
        if (enemies.length === 0) return;
        // 最近敌人：以本块位置为基准（生物在 (col+1, row+1)）
        const txy = refXY(gs, ref);
        let nearest = null;
        let bestD = Infinity;
        for (const c of enemies) {
          const d = Math.hypot(c.fenceCol + 1 - txy.x, c.fenceRow + 1 - txy.y);
          if (d < bestD) { bestD = d; nearest = c; }
        }
        if (!nearest) return;
        InventorySystem.removeItem(gs, 'item_cabbage', 1);
        throwCabbage(gs, ref, nearest);
      });
    }, this);

    // 祝福：标记下次每日开始时对全体敌人投掷（不消耗背包）
    registerSelfHook('onBlessed', this, ({ gs }, ref) => {
      const tile = getTile(gs, ref);
      stateOf(tile).cabbageAllThrowNext = true;
      toast('✨ 卷心菜田受祝福 → 下次每日开始时对全体敌人投掷', 2200);
    });
  },
});
