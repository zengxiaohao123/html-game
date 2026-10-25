// src/main.js —— Phase 2B 组装入口
// 组装 GameDirector + 所有 UI 模块 + InventoryPanel
// 加三个新 CSS + 预置 HotBar 内容让建造模式立即可用

import { EventBus } from './core/EventBus.js';
import { GE } from './core/GameEvents.js';
import { devLog } from './core/Logger.js';
import { InventorySystem } from './systems/InventorySystem.js';

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
import { BlessAnimation } from './ui/BlessAnimation.js';
import { InventoryPanel } from './ui/panels/InventoryPanel.js';

function loadStylesheet(href) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

// Phase 1 样式
loadStylesheet('./src/ui/styles/base.css');
loadStylesheet('./src/ui/styles/map.css');
// Phase 2B 新增样式
loadStylesheet('./src/ui/styles/panels.css');
loadStylesheet('./src/ui/styles/hotbar.css');
loadStylesheet('./src/ui/styles/ui.css');

devLog.info('=== 转盘农场 Phase 2B 启动中 ===');

// 1. 主导演
const director = new GameDirector();
director.start();
window.__gameDirector = director;

const gs = director.getGS();

// 2. Phase 2B 预置 HotBar + 背包库存（HotBar 与背包同步：物品本质属于背包）
//    - HotBar slots 只存 {itemId}（没有 qty 字段）
//    - 对应数量走 InventorySystem.addItem 写入 inventory.items
//    - BuildSystem.placeContent 从 inventory 扣 1，HotBar 渲染时实时从 inventory 读 qty
const PRESET_HOTBAR = [
  { itemId: 'facility_tent',        qty: 2 },
  { itemId: 'facility_potato',       qty: 3 },
  { itemId: 'facility_strawberry',   qty: 1 },
  { itemId: 'facility_pea',          qty: 1 },
  { itemId: 'resource_shop',         qty: 1 },
];
PRESET_HOTBAR.forEach((p, i) => {
  gs.hotbar[i] = { itemId: p.itemId };  // 只存 itemId，不存 qty
  InventorySystem.addItem(gs, p.itemId, p.qty);
});

// 3. UI 挂载
const toast = new Toast();
toast.mount();

const mapView = new MapView();
mapView.mount(gs);

const topBar = new TopBar();
topBar.mount(gs);

const funcBar = new FuncBar(director);
funcBar.mount();

const hotBar = new HotBar();
hotBar.mount();
hotBar.renderFromGS(gs);

const spiritArea = new SpiritArea();
spiritArea.mount();

const infoPanel = new InfoPanel();
infoPanel.mount();

const settingsPanel = new SettingsPanel(director);
settingsPanel.mount();

// Phase 2B 新增：背包面板
const inventoryPanel = new InventoryPanel(director);
inventoryPanel.mount();

// Phase 2B 新增：祈福抽奖动画（订阅 GE.BLESS_START → 2.5s 滚动 → blessCommit）
const blessAnimation = new BlessAnimation();
blessAnimation.mount();

// 4. 输入
const inputManager = new InputManager(director);
inputManager.bind();

// 5. 广播 BOOT
EventBus.emit(GE.BOOT, { gs });

console.log('转盘农场 Phase 2B 启动 ✓');
devLog.info('已挂载:', { mapView, topBar, funcBar, hotBar, spiritArea, toast, settingsPanel, infoPanel, inventoryPanel });
devLog.info('WASD 移动 / P 睡觉 / B 背包 / Tab 建造 / ESC 设置');
