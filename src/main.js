// src/main.js —— Phase 1 核心循环入口
// 组装 GameDirector + 所有 UI 模块，启动游戏
// Phase 0 的 demo hook 已移除，换成 registerFacilities()

import { EventBus } from './core/EventBus.js';
import { GE } from './core/GameEvents.js';
import { devLog } from './core/Logger.js';

// 系统
import { GameDirector } from './systems/GameDirector.js';
import { InputManager } from './systems/InputManager.js';

// UI
import { MapView } from './ui/MapView.js';
import { TopBar } from './ui/TopBar.js';
import { FuncBar } from './ui/FuncBar.js';
import { HotBar } from './ui/HotBar.js';
import { SpiritArea } from './ui/SpiritArea.js';
import { InfoPanel } from './ui/InfoPanel.js';
import { Toast } from './ui/Toast.js';
import { SettingsPanel } from './ui/SettingsPanel.js';

/**
 * 动态加载 CSS（ESM 不支持直接 import CSS，用 link 标签方式）
 */
function loadStylesheet(href) {
  // 避免重复加载
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

// 加载 Phase 1 样式
loadStylesheet('./src/ui/styles/base.css');
loadStylesheet('./src/ui/styles/map.css');

// ── 启动流程 ──
devLog.info('=== 转盘农场 Phase 1 启动中 ===');

// 1. 主导演
const director = new GameDirector();
director.start();

// 把 director 挂到 window，方便 UI 层访问 GS（Phase 1 简化方案）
window.__gameDirector = director;

// 2. UI 模块挂载
const gs = director.getGS();

// Toast 最先挂载（toast-layer 已在 index.html 预留）
const toast = new Toast();
toast.mount();

// 地图（居中，先算好）
const mapView = new MapView();
mapView.mount(gs);

// 顶部状态栏（偏左上角）
const topBar = new TopBar();
topBar.mount(gs);

// 功能区（偏右上角）
const funcBar = new FuncBar(director);
funcBar.mount();

// 快捷栏（底部居中）
const hotBar = new HotBar();
hotBar.mount();

// 精灵区（左侧 momo 圆头）
const spiritArea = new SpiritArea();
spiritArea.mount();

// 信息区（右侧 380px 面板，4 tab）
const infoPanel = new InfoPanel();
infoPanel.mount();

// 设置面板（全局遮罩）
const settingsPanel = new SettingsPanel(director);
settingsPanel.mount();

// 3. 输入管理器（WASD / P / ESC）
const inputManager = new InputManager(director);
inputManager.bind();

// 4. 广播 BOOT 完成
EventBus.emit(GE.BOOT, { gs });

console.log('转盘农场 Phase 1 启动 ✓');
devLog.info('已挂载模块:', { mapView, topBar, funcBar, hotBar, spiritArea, toast, settingsPanel });
devLog.info('WASD 移动 / P 睡觉 / ESC 设置 —— 试试吧！');
