// src/main.js —— 入口
// Phase 0 基础设施层：只做模块组装 + 启动日志 + demo hook 测试
// 不写任何 UI 渲染代码

import { EventBus } from './core/EventBus.js';
import { GE } from './core/GameEvents.js';
import { HookDispatcher } from './core/HookDispatcher.js';
import { devLog } from './core/Logger.js';
import { createInitialState } from './state/gameState.js';
import { Storage } from './state/storage.js';

// ── Phase 0 Demo Hook 测试 ──
// 这些 hook 仅在启动时注册一次，用于验证 HookDispatcher 工作正常
// 正式游戏逻辑将在 Phase 1+ 通过 data/*.js 的设施/技能注册

HookDispatcher.register('onEnter', (params) => {
  devLog.info('[demo hook] onEnter 触发, params:', params);
});

HookDispatcher.register('onDailyStart', (params) => {
  devLog.info('[demo hook] onDailyStart 触发, params:', params);
});

// EventBus demo 订阅
EventBus.on(GE.BOOT, () => {
  devLog.info('[demo subscriber] BOOT 事件已收到');
});

// 创建一个初始 GS 用于验证
const gs = createInitialState();
devLog.info('初始 GS 创建成功, day=', gs.day, 'turn=', gs.turn);
devLog.info('外圈格数:', gs.map.outerTiles.length, '栅栏格数:', gs.map.fence.length);
devLog.info('左下 idx=6 内容:', gs.map.outerTiles[6].contentId);
devLog.info('玩家初始位置 x:', gs.player.x, 'hp:', gs.player.hp, 'stamina:', gs.player.stamina);

// Storage round-trip 自检（不真正存档，Phase 5 正式接入）
// 这里只演示 API 可用
devLog.info('Storage 模块就绪, slots:', Storage.listSlots().length, '槽位');

// 触发一次 BOOT 事件演示 EventBus
EventBus.emit(GE.BOOT);

console.log('转盘农场启动 ✓');
