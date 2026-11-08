// src/systems/CropGrimoireHooks.js
// 土豆 / 郁金香系列魔导书的 hook 接线（薯道难 / 土豆地雷 / 薯条四重奏 / 泡沫 /
// 郁金香，简单！/ 经济上行）
//
// 复用既有的 HookDispatcher.onTurnStart（【每回合开始时】）与 onDailyStart，
// 不新建第二套回合 hook；实时碰撞挂在 RealtimeClock 的 200ms 逻辑步上。

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { HookDispatcher } from '../core/HookDispatcher.js';
import { devLog } from '../core/Logger.js';
import * as Geometry from '../core/Geometry.js';
import { hasGrimoire } from './PassiveItemSystem.js';
import { getRealtimeClock } from './RealtimeClock.js';
import {
  GRIMOIRE_POTATO_MINE,
  PotatoSystem,
} from './PotatoSystem.js';
import {
  TulipSystem,
  initTulipTile,
  applyTulipFluctuation,
} from './TulipSystem.js';
import {
  MineSystem,
  MAX_MINES,
  plantMine,
  tickMines,
  stepMineCollisions,
} from './MineSystem.js';

let wiredEpoch = -1;
let listenersAttached = false;
let stepAttached = false;

function wireHooks() {
  // 与 PassiveItemSystem 相同的 epoch 守卫：clearAll 之后才补挂，避免重复叠加
  if (wiredEpoch === HookDispatcher.epoch) return;
  wiredEpoch = HookDispatcher.epoch;

  // 【每一日开始时】土豆地雷：每个土豆田块埋下 1 个，场上至多 5 个
  HookDispatcher.register('onDailyStart', ({ gs }) => {
    if (!hasGrimoire(gs, GRIMOIRE_POTATO_MINE)) return;
    let planted = 0;
    for (const tile of gs.map.outerTiles) {
      if (tile?.contentId !== PotatoSystem.POTATO_ID) continue;
      if (MineSystem.countMines(gs) >= MAX_MINES) break;
      if (plantMine(gs, tile.idx)) planted += 1;
    }
    if (planted > 0) {
      EventBus.emit(GE.TOAST_SHOW, { text: `💣 埋下 ${planted} 个土豆地雷（场上 ${MineSystem.countMines(gs)}/${MAX_MINES}）`, duration: 2000 });
    }
  });

  // 【每回合开始时】地雷倒计时 / 郁金香「简单！」波动
  HookDispatcher.register('onTurnStart', ({ gs }) => {
    tickMines(gs);
    if (TulipSystem.hasTulipSimple(gs)) {
      for (const tile of gs.map.outerTiles) {
        if (tile?.contentId !== TulipSystem.TULIP_ID) continue;
        applyTulipFluctuation(gs, tile, 'turn');
      }
    }
  });

  // 【放置时】郁金香写入初始价值（经济上行 +6 已包含在 tulipInitialValue 中）
  HookDispatcher.register('onPlace', ({ gs, tileIdx, contentId }) => {
    if (contentId !== TulipSystem.TULIP_ID) return;
    initTulipTile(gs, gs.map.outerTiles[tileIdx]);
  });

  devLog.info('[CropGrimoireHooks] hooks wired');
}

/** 只挂一次的事件订阅（不被 HookDispatcher.clearAll 清除） */
function attachListeners(getGS) {
  if (listenersAttached) {
    return;
  }
  listenersAttached = true;

  // 农场扩建：外圈 idx 整体重排 → 地雷的来源田块索引与坐标同步
  EventBus.on(GE.MAP_EXPANDED, ({ gs, idxMap }) => {
    if (!gs || !Array.isArray(gs.mines) || gs.mines.length === 0) return;
    const rect = Geometry.fenceRect(gs);
    for (const m of gs.mines) {
      if (!m) continue;
      if (Number.isInteger(m.sourceTileIdx) && idxMap?.has?.(m.sourceTileIdx)) {
        m.sourceTileIdx = idxMap.get(m.sourceTileIdx);
      }
      // 栅栏边界变化后，把圆心夹回合法区域
      const r = m.radius || 0.35;
      m.x = Math.min(rect.x1 - r, Math.max(rect.x0 + r, m.x));
      m.y = Math.min(rect.y1 - r, Math.max(rect.y0 + r, m.y));
    }
  });

  if (typeof getGS === 'function') {
    getRealtimeClock(getGS).onStep((dt, gs) => {
      stepMineCollisions(gs || getGS());
    });
  }
  stepAttached = true;
}

/**
 * 初始化（main.js 在 initPassiveItems 之后调用）
 * @param {() => object} getGS
 */
export function initCropGrimoires(getGS) {
  wireHooks();
  attachListeners(getGS);
  // GameDirector.start() 会 clearAll()，BOOT 后按 epoch 补挂
  EventBus.on(GE.BOOT, () => { wireHooks(); });
}

/** 测试 / 重开时手动补挂（幂等） */
export function rewireCropGrimoires() {
  wireHooks();
}

export default { initCropGrimoires, rewireCropGrimoires };
