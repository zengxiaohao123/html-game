// src/main.js —— Phase 4 组装入口
// 在 Phase 2B 基础上 boot：RolePanel / TeamPanel / ForgePanel / ShopPanel / VehiclePanel / LinkSkillUI / DialogBox

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
import { DialogBox } from './ui/DialogBox.js';
import { LinkSkillUI } from './ui/LinkSkillUI.js';
import { InventoryPanel } from './ui/panels/InventoryPanel.js';
import { RolePanel } from './ui/panels/RolePanel.js';
import { TeamPanel } from './ui/panels/TeamPanel.js';
import { ForgePanel } from './ui/panels/ForgePanel.js';
import { ShopPanel } from './ui/panels/ShopPanel.js';
import { initPassiveItems } from './systems/PassiveItemSystem.js';
import { initUseItems } from './systems/UseItemSystem.js';
import { VehiclePanel } from './ui/panels/VehiclePanel.js';
import { TaskPanel } from './ui/panels/TaskPanel.js';
import { CodexPanel } from './ui/panels/CodexPanel.js';
import { MainMenu } from './ui/MainMenu.js';

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
//    Phase 4：把 1-3 格换成 skill_*（BuildMode 开局就能选到技能卡）
const PRESET_HOTBAR = [
  { itemId: 'skill_yumo_slash',             qty: 1 },  // Phase 4 技能卡（BuildMode 可放入）
  { itemId: 'skill_xiayang_flame_strike',   qty: 1 },  // Phase 4 技能卡
  { itemId: 'skill_luyouyou_careful_shot',  qty: 1 },  // Phase 4 技能卡
  { itemId: 'facility_tent',               qty: 2 },
  { itemId: 'facility_potato',              qty: 3 },
  { itemId: 'facility_strawberry',          qty: 1 },
  { itemId: 'facility_pea',                 qty: 1 },
  { itemId: 'resource_shop',                qty: 1 },
];
PRESET_HOTBAR.forEach((p, i) => {
  gs.hotbar[i] = { itemId: p.itemId };  // 只存 itemId，不存 qty
  InventorySystem.addItem(gs, p.itemId, p.qty);
});

// Phase 4 —— 初始技能卡（按 characters.js 实导出的 SKILLS）
//   每人给 2 张常用卡，共 7 种，BuildMode 里可放进地块触发消耗
const PRESET_SKILL_CARDS = [
  // 余默
  { itemId: 'skill_yumo_slash',        qty: 1 },
  { itemId: 'skill_yumo_desperate',     qty: 1 },
  { itemId: 'skill_yumo_pioneer',       qty: 1 },
  // 夏阳
  { itemId: 'skill_xiayang_flame_strike', qty: 1 },
  { itemId: 'skill_xiayang_ignite',       qty: 1 },
  // 陆悠悠
  { itemId: 'skill_luyouyou_careful_shot', qty: 1 },
  { itemId: 'skill_luyouyou_wind_stop',    qty: 1 },
];
PRESET_SKILL_CARDS.forEach((p) => InventorySystem.addItem(gs, p.itemId, p.qty));
devLog.info('[main] 初始技能卡', PRESET_SKILL_CARDS.map(p => p.itemId).join(', '));

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
director.settingsPanel = settingsPanel;

// Phase 2B 新增：背包面板
const inventoryPanel = new InventoryPanel(director);
inventoryPanel.mount();

// Phase 2B 新增：祈福抽奖动画（订阅 GE.BLESS_START → 2.5s 滚动 → blessCommit）
const blessAnimation = new BlessAnimation();
blessAnimation.mount();

// Phase 4 新增：核心 DialogBox（统一弹窗入口，GE.DIALOG_SHOW）
const dialogBox = new DialogBox();
dialogBox.mount();

// Phase 4 新增：6 个面板
const rolePanel = new RolePanel(director);
rolePanel.mount();
const teamPanel = new TeamPanel(director);
teamPanel.mount();
const forgePanel = new ForgePanel(director);
forgePanel.mount();
const shopPanel = new ShopPanel(director);
shopPanel.mount();
const vehiclePanel = new VehiclePanel(director);
vehiclePanel.mount();

// Phase 4 新增：连携技实时窗口（LinkSkillSystem 入队时自动显示；按 1/2/3 触发）
const linkSkillUI = new LinkSkillUI(director);
linkSkillUI.mount();

// Phase 4 新增：任务面板（J 切换；2 tab 日常/核心；Phase 5 补任务列表）
const taskPanel = new TaskPanel(director);
taskPanel.mount();

// Phase 4 新增：图鉴面板（K 切换；4 tab 物品/天赋/技能/收藏品）
const codexPanel = new CodexPanel(director);
codexPanel.mount();

// 4. 输入
const inputManager = new InputManager(director);
inputManager.bind();

// 4.5 获得即生效类物品（收藏品 / 魔导书 / 技能石）
initPassiveItems(() => director.getGS());
initUseItems();

// 5. 广播 BOOT
EventBus.emit(GE.BOOT, { gs });

// 6. 主菜单遮罩 —— 启动立即显示，覆盖游戏界面；玩家点"新的游戏"/"读取存档"才进入游戏
const mainMenu = new MainMenu(director);
director.mainMenu = mainMenu;
mainMenu.show();

console.log('转盘农场 Phase 2B 启动 ✓');
devLog.info('已挂载:', { mapView, topBar, funcBar, hotBar, spiritArea, toast, settingsPanel, infoPanel, inventoryPanel });
devLog.info('WASD 移动 / P 睡觉 / B 背包 / Tab 建造 / ESC 设置');
devLog.info('MainMenu shown, 等待玩家选择...');
