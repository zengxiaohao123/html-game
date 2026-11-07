// src/main.js —— Phase 4 组装入口
// 在 Phase 2B 基础上 boot：RolePanel / TeamPanel / ForgePanel / ShopPanel / VehiclePanel / LinkSkillUI / DialogBox
//
// 场景约束：主菜单是独立场景。游戏场景（地图 / HUD / 游戏面板）只在两种情况下挂载：
//   1. 主菜单点「新的游戏」→ GameDirector.startNewGame()
//   2. 主菜单「读取存档」→ 选中存档且 Storage.load + director.loadGame 成功
// 其余入口（图鉴 / 存档页 / 设置）只使用不依赖 GS 的常驻 UI，绝不挂载主地图。

import { EventBus } from './core/EventBus.js';
import { GE } from './core/GameEvents.js';
import { devLog } from './core/Logger.js';
import { InventorySystem } from './systems/InventorySystem.js';

// 系统
import { GameDirector } from './systems/GameDirector.js';
import { InputManager } from './systems/InputManager.js';

// UI
import { MapView } from './ui/MapView.js';
import { mountFenceTerrainDrop } from './ui/FenceTerrainDrop.js';
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
import { TileHighlight } from './ui/TileHighlight.js';
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
// 技能卡所在地块高亮（v0.5 §16.3）
loadStylesheet('./src/ui/styles/map-highlight.css');

devLog.info('=== 转盘农场 Phase 2B 启动中 ===');

// 1. 主导演
//    不在这里 start()：进入主地图只能由「新的游戏」或「读档成功」触发。
const director = new GameDirector();
window.__gameDirector = director;

// ════════════════════════════════════════════════════════════
// 2. 常驻 UI（不依赖 GS，主菜单场景可用）
// ════════════════════════════════════════════════════════════
const toast = new Toast();
toast.mount();

const dialogBox = new DialogBox();
dialogBox.mount();
director.dialogBox = dialogBox; // 第 11 批 §16.4：InputManager 据此在弹窗打开时把数字键让给选项模式

// 设置面板同时是主菜单的「读取存档」页（8 槽存档管理）
const settingsPanel = new SettingsPanel(director);
settingsPanel.mount();
director.settingsPanel = settingsPanel;
director.registerPanel('settings', settingsPanel);

// 图鉴是纯数据面板，主菜单可直接打开
const codexPanel = new CodexPanel(director);
codexPanel.mount();
director.registerPanel('codex', codexPanel);

// 3. 输入（主菜单可见时 InputManager 自身拦截所有游戏快捷键）
const inputManager = new InputManager(director);
inputManager.bind();

// 4. 获得即生效类物品（收藏品 / 魔导书 / 技能石）；进入游戏后由 BOOT 触发补挂 hook
initPassiveItems(() => director.getGS());
initUseItems();

// ════════════════════════════════════════════════════════════
// 5. 游戏场景（首次真正进入时才挂载）
// ════════════════════════════════════════════════════════════
let gameMounted = false;
let inventoryPanel = null;

/** 新开局预设 HotBar 与初始技能卡（只在新游戏进入时注入，读档不注入） */
function applyNewGamePresets(gs) {
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
}

/** 挂载整个游戏场景（地图 / HUD / 游戏面板）。只在真正进入主地图时调用一次。 */
function mountGameScene(gs) {
  const mapView = new MapView();
  mapView.mount(gs);
  mountFenceTerrainDrop(mapView);

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

  // 祈福抽奖动画（订阅 GE.BLESS_START → 2.5s 滚动 → blessCommit）
  const blessAnimation = new BlessAnimation();
  blessAnimation.mount();

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

  // 连携技实时窗口（LinkSkillSystem 入队时自动显示；按 1/2/3 触发）
  const linkSkillUI = new LinkSkillUI(director);
  linkSkillUI.mount();

  // 技能卡所在地块高亮（必须在 MapView 之后 mount：订阅顺序保证地块重建后重新挂类）
  const tileHighlight = new TileHighlight(director);
  tileHighlight.mount();

  // 任务面板（J 切换；2 tab 日常/核心）
  const taskPanel = new TaskPanel(director);
  taskPanel.mount();

  // 背包面板（Phase 2B，需要 GS）
  inventoryPanel = new InventoryPanel(director);
  inventoryPanel.mount();

  // 面板实例登记 —— GameDirector 用它们校验「栈内条目是否真的显示着」（栈自愈）
  director.registerPanel('info', infoPanel);
  director.registerPanel('inventory', inventoryPanel);
  director.registerPanel('shop', shopPanel);
  director.registerPanel('role', rolePanel);
  director.registerPanel('team', teamPanel);
  director.registerPanel('forge', forgePanel);
  director.registerPanel('vehicle', vehiclePanel);
  director.registerPanel('task', taskPanel);

  devLog.info('已挂载:', { mapView, topBar, funcBar, hotBar, spiritArea, toast, settingsPanel, infoPanel, inventoryPanel });
}

// 进入游戏场景的统一收口：由 GameDirector 在「新的游戏」/「读档成功」后回调
director.onEnterGame = (gs, mode) => {
  if (mode === 'new') applyNewGamePresets(gs);

  if (!gameMounted) {
    mountGameScene(gs);
    gameMounted = true;
  }

  // 收起主菜单上打开的常驻面板，避免压在地图上
  director.panelRefs.settings?.hide?.();
  director.panelRefs.codex?.hide?.();

  // 先挂好场景再广播，保证所有 UI 在收到 BOOT / STATE_RESET 时已经就绪
  EventBus.emit(GE.BOOT, { gs });
  EventBus.emit(GE.STATE_RESET, { gs });

  director.mainMenu?.hide();
};

// ════════════════════════════════════════════════════════════
// 6. 主菜单遮罩 —— 启动立即显示；只有进入游戏成功才隐藏
// ════════════════════════════════════════════════════════════
const mainMenu = new MainMenu(director);
director.mainMenu = mainMenu;
mainMenu.show();

console.log('转盘农场 Phase 2B 启动 ✓');
devLog.info('WASD 移动 / P 睡觉 / B 背包 / Tab 建造 / ESC 设置');
devLog.info('MainMenu shown, 等待玩家选择...');
