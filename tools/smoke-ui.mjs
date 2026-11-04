// tools/smoke-ui.mjs —— 第 5 批 UI 对齐检查用例（Node + 最小 DOM 桩）
//
// 项目无浏览器截图能力（无 puppeteer/playwright/构建），本脚本用最小 DOM 桩在
// Node 侧逐面板检查：元素存在、关键按钮可点、状态正确。每个第 5 批改动的面板
// 一条用例，另加 §16.10 / §16.14 / §16.20 / §16.21 中央接线用例。
//
// 用法：node tools/smoke-ui.mjs

// ════════════════════════════════════════════════════════════
// 0. 最小 DOM 桩（必须在 import 任何 src 模块之前装好）
// ════════════════════════════════════════════════════════════
class FakeEl {
  constructor(tag = 'div') {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.style.setProperty = () => {}; // 第 10 批：滑块金色填充用 CSS 变量，桩补齐
    this.attributes = Object.create(null);
    this._listeners = Object.create(null);
    this._text = '';
    this._classes = new Set();
    this.id = '';
    this.value = '';
    this.disabled = false;
    this.onclick = null;
    this.title = '';
    this.href = '';
    this.rel = '';
    this.src = '';
    this.alt = '';
  }
  get className() { return [...this._classes].join(' '); }
  set className(v) { this._classes = new Set(String(v || '').split(/\s+/).filter(Boolean)); }
  get classList() {
    const s = this._classes;
    return {
      add: (...cs) => cs.forEach((c) => s.add(c)),
      remove: (...cs) => cs.forEach((c) => s.delete(c)),
      toggle: (c, force) => {
        const on = force === undefined ? !s.has(c) : !!force;
        if (on) s.add(c); else s.delete(c);
        return on;
      },
      contains: (c) => s.has(c),
    };
  }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this._text = String(v ?? ''); this.children = []; }
  get innerHTML() { return ''; }
  set innerHTML(v) { if (String(v) === '') this.children = []; this._text = ''; }
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; }
  insertBefore(c, ref) {
    if (c.parentNode) c.parentNode.removeChild(c);
    c.parentNode = this;
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
    return c;
  }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) { this.children.splice(i, 1); c.parentNode = null; } return c; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  contains(other) { let n = other; while (n) { if (n === this) return true; n = n.parentNode; } return false; }
  setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'src') this.src = String(v); if (k === 'alt') this.alt = String(v); }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
  addEventListener(t, fn) { (this._listeners[t] ??= []).push(fn); }
  removeEventListener(t, fn) { const a = this._listeners[t]; if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } }
  dispatchEvent(ev) {
    for (const fn of [...(this._listeners[ev.type] || [])]) fn.call(this, ev);
    if (ev.type === 'click' && typeof this.onclick === 'function') this.onclick.call(this, ev);
    return true;
  }
  click() { this.dispatchEvent({ type: 'click', target: this, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} }); }
  getBoundingClientRect() { return { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }; }
  closest() { return null; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  focus() {}
  blur() {}
}

const body = new FakeEl('body');
const head = new FakeEl('head');
const app = new FakeEl('div'); app.id = 'app'; body.appendChild(app);
const docListeners = Object.create(null);

globalThis.document = {
  body,
  head,
  createElement: (t) => new FakeEl(t),
  addEventListener: (t, fn) => { (docListeners[t] ??= []).push(fn); },
  removeEventListener: (t, fn) => { const a = docListeners[t]; if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } },
  querySelector: (sel) => {
    if (sel === 'body') return body;
    if (sel === '#app') return app;
    return null;
  },
  getElementById: (id) => (id === 'app' ? app : null),
};

const winListeners = Object.create(null);
globalThis.window = {
  addEventListener: (t, fn) => { (winListeners[t] ??= []).push(fn); },
  removeEventListener: (t, fn) => { const a = winListeners[t]; if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } },
  dispatchEvent: (ev) => { for (const fn of [...(winListeners[ev.type] || [])]) fn.call(globalThis.window, ev); return true; },
  innerWidth: 1280,
  innerHeight: 720,
  __gameDirector: null,
};
globalThis.requestAnimationFrame = (fn) => { fn(); return 0; };
globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
};

// ════════════════════════════════════════════════════════════
// 1. 装配（镜像 main.js 的最小版）
// ════════════════════════════════════════════════════════════
const { EventBus } = await import('../src/core/EventBus.js');
const { GE } = await import('../src/core/GameEvents.js');
const { GameDirector } = await import('../src/systems/GameDirector.js');
const { InputManager } = await import('../src/systems/InputManager.js');
const { InventorySystem } = await import('../src/systems/InventorySystem.js');
const BuildSystem = await import('../src/systems/BuildSystem.js');
const { RECIPES } = await import('../src/data/recipes.js');

const { MapView } = await import('../src/ui/MapView.js');
const { TopBar } = await import('../src/ui/TopBar.js');
const { FuncBar } = await import('../src/ui/FuncBar.js');
const { HotBar } = await import('../src/ui/HotBar.js');
const { SpiritArea } = await import('../src/ui/SpiritArea.js');
const { InfoPanel } = await import('../src/ui/InfoPanel.js');
const { SettingsPanel } = await import('../src/ui/SettingsPanel.js');
const { LinkSkillUI } = await import('../src/ui/LinkSkillUI.js');
const { InventoryPanel } = await import('../src/ui/panels/InventoryPanel.js');
const { RolePanel } = await import('../src/ui/panels/RolePanel.js');
const { TeamPanel } = await import('../src/ui/panels/TeamPanel.js');
const { ForgePanel } = await import('../src/ui/panels/ForgePanel.js');
const { ShopPanel, SHOP_GRID } = await import('../src/ui/panels/ShopPanel.js');
const { VehiclePanel } = await import('../src/ui/panels/VehiclePanel.js');
const { TaskPanel } = await import('../src/ui/panels/TaskPanel.js');
const { CodexPanel } = await import('../src/ui/panels/CodexPanel.js');

let pass = 0, fail = 0;
function assert(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗', msg, extra !== undefined ? `→ ${JSON.stringify(extra)}` : ''); }
}
const head_ = (m) => console.log('\n— ' + m + ' —');

// 树遍历助手
function* walk(el) { if (!el) return; yield el; for (const c of el.children) yield* walk(c); }
const findAll = (root, pred) => [...walk(root)].filter(pred);
const hasText = (root, s) => findAll(root, (el) => el._text && el._text.includes(s)).length > 0;
const buttonsWithText = (root, s) => findAll(root, (el) => el.tagName === 'BUTTON' && (el._text || '').includes(s));

const director = new GameDirector();
director.start();
const gs = director.getGS();

const mapView = new MapView(); mapView.mount(gs);
const topBar = new TopBar(); topBar.mount(gs);
const funcBar = new FuncBar(director); funcBar.mount();
const hotBar = new HotBar(); hotBar.mount(); hotBar.renderFromGS(gs);
const spiritArea = new SpiritArea(); spiritArea.mount();
const infoPanel = new InfoPanel(); infoPanel.mount();
const settingsPanel = new SettingsPanel(director); settingsPanel.mount();
director.settingsPanel = settingsPanel;
const inventoryPanel = new InventoryPanel(director); inventoryPanel.mount();
const rolePanel = new RolePanel(director); rolePanel.mount();
const teamPanel = new TeamPanel(director); teamPanel.mount();
const forgePanel = new ForgePanel(director); forgePanel.mount();
const shopPanel = new ShopPanel(director); shopPanel.mount();
const vehiclePanel = new VehiclePanel(director); vehiclePanel.mount();
const linkSkillUI = new LinkSkillUI(director); linkSkillUI.mount();
const taskPanel = new TaskPanel(director); taskPanel.mount();
const codexPanel = new CodexPanel(director); codexPanel.mount();
const inputManager = new InputManager(director);   // 不 bind，直接调 _dispatchAction

// HotBar 预置（镜像 main.js）
gs.hotbar[0] = { itemId: 'facility_tent' };
EventBus.emit(GE.BOOT, { gs });

// ════════════════════════════════════════════════════════════
head_('§16.3 MapView：缩放 / 拖拽平移接线');
{
  assert(!!mapView.root, 'MapView root 存在');
  const before = mapView.root.style.transform || '';
  mapView.root.dispatchEvent({ type: 'wheel', deltaY: -120, preventDefault() {} });
  const after = mapView.root.style.transform || '';
  assert(after !== before && /scale\(/.test(after), '滚轮缩放生效（transform 含 scale）', { before, after });
}

head_('§16.6 SpiritArea：只显示精灵图标（无名字文字）');
{
  const icons = findAll(spiritArea.root, (el) => el.getAttribute && el.getAttribute('data-icon-id'));
  assert(icons.length >= 1, '精灵图标经 iconEl 渲染（data-icon-id 存在）', icons.length);
}

head_('§16.7 TopBar：容量超载红字闪烁 + 偏左布局');
{
  gs.creatures = gs.creatures || [];
  const chickKind = 'chick_test';
  for (let i = 0; i < (gs.capacity?.friendly ?? 0) + 2; i++) gs.creatures.push({ kind: chickKind, hp: 1, maxHp: 1 });
  EventBus.emit(GE.STAT_CHANGE, {});
  const blinking = findAll(topBar.root, (el) => el._classes && el._classes.has('overload-blink'));
  assert(blinking.length >= 1, '超载容量条目带 overload-blink 类');
  gs.creatures = gs.creatures.filter((c) => c.kind !== chickKind);
  EventBus.emit(GE.STAT_CHANGE, {});
}

head_('§16.8 FuncBar：右起顺序 + 无底板 + 设置按钮可点');
{
  assert(funcBar.root.style.flexDirection === 'row-reverse', 'FuncBar row-reverse（视觉从右往左 设置→载具）', funcBar.root.style.flexDirection);
  const btns = findAll(funcBar.root, (el) => el.tagName === 'BUTTON');
  assert(btns.length === 8, '功能区 8 个按钮', btns.length);
  assert(btns.every((b) => b.style.background === 'transparent'), '按钮无实体底板（background: transparent）');
  btns[0].click(); // items[0] = 设置
  assert(settingsPanel.visible === true, '点设置按钮 → 设置面板打开');
  EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'settings' });
  assert(settingsPanel.visible === false, 'UI_PANEL_CLOSE(settings) → 设置面板关闭（新订阅生效）');
}

head_('§16.19 HotBar：数量恒显 / 0 时「可合成」判定');
{
  for (let i = 0; i < 10; i++) gs.hotbar[i] = { itemId: 'facility_tent' };
  hotBar.renderFromGS(gs);
  const qtyEls = findAll(hotBar.root, (el) => el._classes && el._classes.has('slot-qty'));
  assert(qtyEls.length === 10, '10 格右下角数量恒显（有物品的格）', qtyEls.length);
  // 找一个配方：备齐材料 → 产物数量 0 时应显示「可合成」
  const recipeId = Object.keys(RECIPES)[0];
  const r = RECIPES[recipeId];
  const outId = r.outputs[0].itemId;
  for (const inp of r.ingredients) InventorySystem.addItem(gs, inp.itemId, inp.qty);
  gs.hotbar[9] = { itemId: outId };
  const idx = gs.inventory.items.findIndex((e) => e.itemId === outId);
  if (idx >= 0) gs.inventory.items[idx].qty = 0;
  hotBar.renderFromGS(gs);
  assert(hasText(hotBar.root, '可合成'), '数量为 0 且材料足够 → 显示「可合成」');
}

head_('§16.4 InfoPanel：1/4 宽 + 三总显 tab + 面板栈接线');
{
  infoPanel.selectTile(2);
  assert(infoPanel._panelOpen === true, '滑入后 emit UI_PANEL_OPEN(info)');
  assert(director.openPanels.includes('info'), 'openPanels 栈含 info', director.openPanels);
  assert(hasText(infoPanel.root, '地块内容') && hasText(infoPanel.root, '状态') && hasText(infoPanel.root, '单位'),
    '地块内容 / 状态 / 单位 三 tab 恒显');
  EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'info' });
  assert(infoPanel._panelOpen === false, 'UI_PANEL_CLOSE(info) → 滑出');
}

head_('§16.15 InventoryPanel：8 tab + 出货箱 + 幂等 OPEN');
{
  EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'inventory' });
  assert(inventoryPanel.visible === true, 'OPEN(inventory) → 显示');
  for (const t of ['总览', '设施', '资源', '技能', '地形', '产物', '道具', '杂物']) {
    assert(hasText(inventoryPanel.mask, t), `tab「${t}」存在`);
  }
  assert(hasText(inventoryPanel.mask, '出货箱'), '出货箱区存在');
  EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'inventory' });
  assert(inventoryPanel.visible === true, '重复 OPEN 幂等（不 toggle 关闭）');
  EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'inventory' });
}

head_('§16.13 ForgePanel：6 tab（无技能）+ 右上>右下');
{
  EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'forge' });
  assert(forgePanel.helper?.visible === true, 'OPEN(forge) → 显示');
  for (const t of ['总览', '设施', '资源', '地形', '产物', '道具']) {
    assert(hasText(forgePanel.helper.root, t), `tab「${t}」存在`);
  }
  EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'forge' });
}

head_('§16.11 RolePanel：全屏 + 左侧分页 tab');
{
  EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'role' });
  assert(rolePanel.helper?.visible === true, 'OPEN(role) → 显示');
  assert(hasText(rolePanel.helper.root, '技能展示') && hasText(rolePanel.helper.root, '羁绊等级'),
    '左侧分页 tab：技能展示 / 羁绊等级');
  EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'role' });
}


head_('§16.12 TeamPanel：快捷编队按钮 + 二级 ESC 回一级');
{
  EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'team' });
  assert(teamPanel.helper?.visible === true, 'OPEN(team) → 显示');
  const quickBtn = buttonsWithText(teamPanel.helper.root, '快捷编队')[0];
  const enableBtn = buttonsWithText(teamPanel.helper.root, '启用')[0];
  assert(!!quickBtn && !!enableBtn, '右下角两按钮：快捷编队 / 启用');
  quickBtn.click();
  const quickVisible = teamPanel.quickOverlay
    && teamPanel.quickOverlay.style.display !== 'none';
  assert(!!quickVisible, '点快捷编队 → 换人界面滑出');
  if (typeof teamPanel._keyHandler === 'function') {
    teamPanel._keyHandler({ key: 'Escape', preventDefault() {}, stopImmediatePropagation() {} });
  }
  assert(teamPanel.helper?.visible === true, '二级 ESC → 回一级（TeamPanel 仍可见）');
  EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'team' });
}

head_('§16.16 VehiclePanel：独立格 + 剩余次数');
{
  gs.vehicle.available.push({ vehicleId: 'vehicle_wheel', usageLeft: 3 });
  EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'vehicle' });
  assert(vehiclePanel.helper?.visible === true, 'OPEN(vehicle) → 显示');
  assert(hasText(vehiclePanel.helper.root, '剩余'), '载具格显示剩余使用次数');
  EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'vehicle' });
}

head_('§16.17 TaskPanel：面板可开 + 幂等');
{
  EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'task' });
  assert(taskPanel.helper?.visible === true, 'OPEN(task) → 显示');
  EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'task' });
  assert(taskPanel.helper?.visible === true, '重复 OPEN 幂等');
  EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'task' });
}

head_('§16.18 LinkSkillUI：中央偏右 + 层级高于面板');
{
  const st = linkSkillUI.root.style;
  assert(String(st.zIndex) === '6500', 'zIndex 6500（> 面板 6000 / 商店 5500）', st.zIndex);
  assert(String(st.left).includes('62%'), '定位中央偏右（left 62%）', st.left);
}

head_('CodexPanel：幂等 OPEN');
{
  EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'codex' });
  assert(codexPanel.helper?.visible === true, 'OPEN(codex) → 显示');
  EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'codex' });
  assert(codexPanel.helper?.visible === true, '重复 OPEN 幂等（原 toggle 已改）');
  EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'codex' });
}

head_('§16.9 SettingsPanel：8 槽位');
{
  EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'settings' });
  assert(settingsPanel.visible === true, 'OPEN(settings) → 显示');
  const slotEls = settingsPanel.slotsGrid ? settingsPanel.slotsGrid.children : [];
  assert(slotEls.length === 8, '存档槽位 8 个', slotEls.length);
  EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'settings' });
}

head_('§16.21/16.22 ShopPanel：悬浮刷新 / 12 格 / ✖ / 金币不足灰化');
{
  const shopTile = gs.map.outerTiles.find((t) => !t.contentId);
  shopTile.contentId = 'resource_shop';
  shopTile.contentState = {};
  EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'shop', tileIdx: shopTile.idx });
  assert(shopPanel.visible === true, 'OPEN(shop) → 进入商店');
  assert(director.openPanels.includes('shop'), 'openPanels 栈含 shop', director.openPanels);
  assert(shopPanel.refreshBtn && shopPanel.refreshBtn.style.position === 'absolute',
    '刷新按钮悬浮定位（absolute）', shopPanel.refreshBtn?.style?.position);
  const gridCells = shopPanel.gridEl ? shopPanel.gridEl.children.length : 0;
  assert(gridCells === 12, '商品网格 12 格（4×3）', gridCells);
  const closeBtn = buttonsWithText(shopPanel.root, '✖')[0];
  assert(!!closeBtn, '右上角 ✖ 存在');

  // §16.21 二级嵌套：商店开着时开背包 → 叠在上面，关闭回商店
  EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'inventory' });
  assert(director.openPanels.includes('shop') && director.openPanels.includes('inventory'),
    '商店 + 背包同叠（商店保留）', director.openPanels);
  assert(shopPanel.visible === true, '开背包后商店仍可见');
  EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'inventory' });
  assert(director.openPanels.length === 1 && director.openPanels[0] === 'shop',
    '关背包后回到商店', director.openPanels);

  // ✖ 关闭商店（无详情弹窗时直接关店）
  closeBtn.click();
  assert(shopPanel.visible === false, '✖ → 关闭商店回主界面');
}

head_('第 8 批：商店/魔法商店逐项 UI（选项齐全/正方格/留白/灰化/关闭层级）');
{
  const { ITEMS } = await import('../src/data/items.js');
  const { getShop, isSellable } = await import('../src/systems/ShopSystem.js');

  // 上一块已离店（本回合禁入同一家），用新地块开一家新店
  const shopTile = gs.map.outerTiles.find((t) => !t.contentId);
  shopTile.contentId = 'resource_shop';
  shopTile.contentState = {};
  EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'shop', tileIdx: shopTile.idx });
  assert(shopPanel.visible === true, '新店 OPEN(shop) → 进入');

  // 1) 功能选项与文档完全一致：[售卖][购买] 切换 + 悬浮刷新 + 右下离开 + 右上✖，不多不少
  const tabLabels = shopPanel.tabBtns.map((b) => b._text);
  assert(JSON.stringify(tabLabels) === JSON.stringify(['售卖', '购买']),
    '切换按钮恰为 [售卖, 购买] 且顺序一致', tabLabels);
  const refreshText = shopPanel.refreshBtn.children.map((c) => c._text || '').join('');
  assert(refreshText.includes('刷新'), '刷新按钮含「刷新」+ 价格文案', refreshText);
  assert(shopPanel.leaveBtn && shopPanel.leaveBtn._text === '离开', '右下角「离开」大按钮');
  assert(buttonsWithText(shopPanel.root, '✖').length === 1, '右上角 ✖ 唯一');
  assert(!hasText(shopPanel.root, '剩'), '刷新按钮无多余文字「剩 N 次」（次数改放 title）');
  assert(!hasText(shopPanel.root, '已售出'), '售出格不显示「已售出」（§16.21 买完该格即空）');

  // 2) 正方形格子 + 统一间距 + 居中留白不铺满
  const cols = shopPanel.gridEl.style.gridTemplateColumns;   // repeat(4, 112px)
  const rows = shopPanel.gridEl.style.gridAutoRows;          // 112px
  const m = cols.match(/repeat\((\d+),\s*(\d+)px\)/);
  assert(m && Number(m[1]) === SHOP_GRID.cols, '网格 4 列', cols);
  assert(m && Number(m[2]) === parseInt(rows, 10), '格宽 = 格高（正方形）', { cols, rows });
  assert(shopPanel.gridEl.style.gap === `${SHOP_GRID.gap}px`, '网格间距统一', shopPanel.gridEl.style.gap);
  assert(shopPanel.root.style.alignItems === 'center' && shopPanel.root.style.justifyContent === 'center',
    '卡片居中 → 四周留白');
  assert(shopPanel.cardEl.style.width.startsWith('min(') && shopPanel.cardEl.style.height.startsWith('min('),
    '卡片 min() 限宽高，不铺满屏幕');

  // 3) 灰化条件逐项
  const shop = getShop(gs, shopTile.idx);
  shop.refreshUsed = 3;
  shopPanel._renderHeaderState();
  assert(shopPanel.refreshBtn.disabled === true, '刷新次数用完 → 刷新按钮灰化');
  shop.refreshUsed = 0;
  shopPanel._renderHeaderState();
  assert(shopPanel.refreshBtn.disabled === false, '刷新次数恢复 → 按钮可用');

  const goldBackup = gs.player.gold;
  gs.player.gold = 0;
  const firstCell = [...shopPanel.gridEl.children].find((c) => c.getAttribute('data-shop-empty') !== '1');
  firstCell.onclick();
  const buyOk = buttonsWithText(shopPanel.detailEl, '购买')[0];
  assert(buyOk && buyOk.disabled === true, '金币不足 → 详情「购买」灰化');

  // 4) 关闭层级：弹窗开着时 ✖ 只关弹窗，商店保留；再 ✖ 才关商店
  buttonsWithText(shopPanel.root, '✖')[0].click();
  assert(shopPanel.detailEl === null && shopPanel.visible === true, '弹窗开时 ✖ 只关弹窗回商店');
  gs.player.gold = goldBackup;

  // 5) 售卖 tab：背包格同卡片三要素；不可售物品「售卖」灰化且格上无多余文字
  const unsellableId = Object.keys(ITEMS).find((id) => !isSellable(id));
  gs.inventory.items.push({ itemId: unsellableId, qty: 1 });
  EventBus.emit(GE.INVENTORY_CHANGE, {});
  shopPanel.tabBtns[0].click();   // 售卖
  assert(!hasText(shopPanel.root, '不可售'), '售卖格不显示「不可售」文字（灰化在详情按钮）');
  const targetCell = [...shopPanel.gridEl.children].find((c) => {
    let hit = false;
    for (const n of walk(c)) if (n._text && n._text.includes(ITEMS[unsellableId].name)) hit = true;
    return hit;
  });
  assert(!!targetCell, '售卖网格含不可售物品格', unsellableId);
  targetCell.onclick();
  const sellOk = buttonsWithText(shopPanel.detailEl, '售卖')[0];
  assert(sellOk && sellOk.disabled === true, '不可售物品 → 详情「售卖」灰化');
  buttonsWithText(shopPanel.root, '✖')[0].click();   // 关弹窗
  gs.inventory.items = gs.inventory.items.filter((e) => e.itemId !== unsellableId);
  shopPanel.tabBtns[1].click();   // 回购买

  // 6) 常驻 UI 层级：商店遮罩 5500 之上仍可见可点（§16.21）
  assert(Number(topBar.root.style.zIndex) > 5500, 'TopBar 层级高于商店', topBar.root.style.zIndex);
  assert(Number(funcBar.root.style.zIndex) > 5500, 'FuncBar 层级高于商店', funcBar.root.style.zIndex);
  assert(Number(hotBar.wrapEl.style.zIndex) > 5500, 'HotBar 层级高于商店', hotBar.wrapEl.style.zIndex);
  assert(Number(settingsPanel.mask.style.zIndex) > 5500, '设置面板层级高于商店（二级嵌套可见）');

  shopPanel.leaveBtn.click();
  assert(shopPanel.visible === false, '「离开」→ 关闭商店');

  // 7) 魔法商店：同布局，10 格商品 + 2 空格（§16.22）
  const magicTile = gs.map.outerTiles.find((t) => !t.contentId);
  magicTile.contentId = 'resource_magic_shop';
  magicTile.contentState = {};
  EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'magicShop', tileIdx: magicTile.idx });
  assert(shopPanel.visible === true && shopPanel.kind === 'magic', 'OPEN(magicShop) → 魔法商店');
  assert(shopPanel.gridEl.children.length === 12, '魔法商店 4×3 网格共 12 位', shopPanel.gridEl.children.length);
  const empties = findAll(shopPanel.gridEl, (el) => el.getAttribute && el.getAttribute('data-shop-empty') === '1');
  assert(empties.length === 2, '魔法商店留 2 个空格', empties.length);
  assert(hasText(shopPanel.root, '魔法商人'), '魔法商店商人对话框');
  shopPanel.leaveBtn.click();
  assert(shopPanel.visible === false, '魔法商店「离开」→ 关闭');
}

head_('§16.20 中央接线：开新面板关旧面板 / 开面板退建造');
{
  EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'inventory' });
  EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'role' });
  assert(director.openPanels.length === 1 && director.openPanels[0] === 'role',
    '开角色页 → 背包被中央关闭', director.openPanels);
  assert(inventoryPanel.visible === false, '背包面板确实已隐藏');
  EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'role' });

  BuildSystem.enterBuildMode(gs);
  assert(gs.buildMode === true, '进入建造模式');
  EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'inventory' });
  assert(gs.buildMode === false, '§16.14 打开任何界面 → 退出建造模式');
  EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'inventory' });
}

head_('§16.10 睡觉确认 + P 键仅主界面有效');
{
  const dialogs = [];
  const onDialog = (p) => dialogs.push(p);
  EventBus.on(GE.DIALOG_SHOW, onDialog);

  gs.player.stamina = 5;
  const dayBefore = gs.day;
  const r1 = director.sleep();
  assert(r1 === false && dialogs.length === 1, '行动力 >0 → 弹确认且不立即睡觉');
  assert(gs.day === dayBefore, '确认前未换日');
  assert((dialogs[0].content || '').includes('行动力尚未耗尽'), '确认文案为文档原文');
  const confirmOpt = dialogs[0].options.find((o) => o.label.includes('确定'));
  confirmOpt.onSelect();
  assert(gs.day === dayBefore + 1, '点「确定睡觉」→ 换日');

  // P 键 gating：有面板打开时 _dispatchAction('sleep') 无反应
  gs.player.stamina = 5;
  EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'inventory' });
  const dialogsBefore = dialogs.length;
  const dayBefore2 = gs.day;
  inputManager._dispatchAction('sleep');
  assert(dialogs.length === dialogsBefore && gs.day === dayBefore2, '有界面打开时 P 无效');
  EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'inventory' });
  EventBus.off(GE.DIALOG_SHOW, onDialog);
}

// ════════════════════════════════════════════════════════════
// 第 6 批：图标覆盖检查（每个 icon id 要么有真实素材且文件存在，要么能安全回退 emoji）
// ════════════════════════════════════════════════════════════
head_('图标覆盖：PNG 注册存在性 + 全量 icon id 回退安全');
{
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { Assets } = await import('../src/core/Assets.js');
  const { ITEMS } = await import('../src/data/items.js');
  const { CREATURES } = await import('../src/data/creatures.js');
  const { CHARACTERS, SKILLS, SPIRITS } = await import('../src/data/characters.js');
  const { BUFFS } = await import('../src/data/buffs.js');
  const { TALENTS } = await import('../src/data/talents.js');

  const groupOf = (id) => (id.startsWith('facility_') ? 'facilities'
    : id.startsWith('resource_') ? 'resources'
      : id.startsWith('terrain_') ? 'terrains'
        : 'items');

  // 全量 icon id 宇宙：物品库 93 + 生物 9 + 角色 3 + 精灵 3 + 技能 20 + 状态 6 + 天赋 6
  //   + UI 固定 19 + 商人 2 + 日常任务 4（后三者 id/emoji 与调用点源码一致，见 FuncBar/TopBar/ShopPanel/TaskPanel）
  const universe = [];
  for (const [id, def] of Object.entries(ITEMS)) universe.push({ group: groupOf(id), id, def });
  for (const [id, def] of Object.entries(CREATURES)) universe.push({ group: 'creatures', id, def });
  for (const def of Object.values(CHARACTERS)) universe.push({ group: 'ui', id: def.id, def });
  for (const def of Object.values(SPIRITS)) universe.push({ group: 'creatures', id: def.id, def });
  // 技能 skill_* 已在 ITEMS（物品库）内，不重复计入
  for (const def of Object.values(BUFFS)) universe.push({ group: 'ui', id: def.id, def });
  for (const def of Object.values(TALENTS)) universe.push({ group: 'ui', id: def.id, def });
  for (const id of Object.keys(Assets.ui)) universe.push({ group: 'ui', id, def: null }); // 含 day/task
  universe.push({ group: 'ui', id: 'merchant_shop', def: { emoji: '🧑‍🌾' } });
  universe.push({ group: 'ui', id: 'merchant_magic', def: { emoji: '🧙' } });
  for (const [id, emoji] of [['place-3', '🛠️'], ['bless-1', '🙏'], ['move-10', '🚶'], ['earn-100', '💰']]) {
    universe.push({ group: 'ui', id, def: { emoji } });
  }

  // 1) 已注册 PNG / 数据 icon 字段：文件必须真实存在（防注册笔误、防 404 破图）
  const registered = [];
  for (const [group, table] of Object.entries(Assets.icons)) {
    for (const [id, p] of Object.entries(table)) registered.push({ group, id, p });
  }
  for (const { group, id, def } of universe) {
    if (def && typeof def.icon === 'string' && def.icon) registered.push({ group, id, p: def.icon });
  }
  const missingFiles = registered.filter((r) => !fs.existsSync(path.join(repoRoot, r.p)));
  assert(missingFiles.length === 0, `已注册 PNG 全部存在（${registered.length} 条）`, missingFiles);

  // 2) 全量 icon id：要么有素材，要么能安全回退 emoji（回退值非空且非 ❓）
  let matched = 0;
  const unsafe = [];
  for (const { group, id, def } of universe) {
    const png = (def && def.icon) || Assets.getIcon(group, id) || Assets.getIcon('items', id) || Assets.getIcon('ui', id);
    if (png) { matched++; continue; }
    const emoji = (def && def.emoji) || Assets.getEmoji(group, id);
    if (!emoji || emoji === '❓') unsafe.push(`${group}/${id}`);
  }
  assert(unsafe.length === 0, `全量 icon id 均有素材或安全 emoji 回退（宇宙 ${universe.length}）`, unsafe);
  console.log(`  · 图标覆盖率：${matched}/${universe.length} 已匹配 PNG，其余走 emoji 安全回退`);

  // 3) TopBar 任务入口图标走 iconEl 链（不再写死 emoji）
  const taskIconChild = topBar.taskIconEl.children[0];
  assert(taskIconChild && taskIconChild.getAttribute('data-icon-id') === 'task',
    'TopBar 任务入口图标带 data-icon-id=task（iconEl 链）', taskIconChild && taskIconChild.tagName);
  assert(taskIconChild.tagName === 'IMG', '任务图标命中 PNG（ui_task.png）', taskIconChild.tagName);
}

// ════════════════════════════════════════════════════════════
// 第 7 批裁决①③：鸡舍面板 —— 共享额度显示 / 优质蛋分开收获 / 投放饲料入口
// ════════════════════════════════════════════════════════════
head_('第 7 批：鸡舍面板（共享额度 + 分别收获 + 投放饲料）');
{
  const henTile = gs.map.outerTiles.find((t) => !t.contentId);
  henTile.contentId = 'facility_henhouse';
  henTile.contentState = { eggStored: 3, eggStoredGolden: 2, henhouseFeed: { item_wheat: 1 } };
  gs.player.x = henTile.idx;
  InventorySystem.addItem(gs, 'item_wheat', 2);
  InventorySystem.addItem(gs, 'item_rice_straw', 1);
  infoPanel.selectTile(henTile.idx);
  assert(hasText(infoPanel.root, '5 / 10'), '共享额度合计显示 5/10（普通 3 + 优质 2）');
  assert(hasText(infoPanel.root, '优质蛋 2'), '优质蛋数量单独显示');
  assert(buttonsWithText(infoPanel.root, '确认收获鸡蛋').length === 1, '普通鸡蛋收获按钮存在');
  assert(buttonsWithText(infoPanel.root, '确认收获优质蛋').length === 1, '优质蛋收获按钮存在（两物分别占格）');
  assert(hasText(infoPanel.root, '投放饲料'), '「投放饲料」区存在');
  assert(buttonsWithText(infoPanel.root, '投放稻草').length === 1 && buttonsWithText(infoPanel.root, '投放小麦').length === 1,
    '稻草 / 小麦投放按钮存在');
  const storeBefore = henTile.contentState.henhouseFeed.item_wheat || 0;
  const bagBefore = InventorySystem.countItem(gs, 'item_wheat');
  buttonsWithText(infoPanel.root, '投放小麦')[0].click();
  assert((henTile.contentState.henhouseFeed.item_wheat || 0) === storeBefore + 1
    && InventorySystem.countItem(gs, 'item_wheat') === bagBefore - 1,
    '点投放小麦 → 背包 -1、鸡舍储存 +1');
  EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'info' });
}

head_('第 9 批：商店剩余预览 / 背包拖拽放置 / 粘液中文名');
{
  const { ITEMS } = await import('../src/data/items.js');
  const { enterShop, leaveShop } = await import('../src/systems/ShopSystem.js');
  const { ALL_FACILITIES } = await import('../src/data/facilities.js');
  const { Distance } = await import('../src/core/Distance.js');

  // ── 1) §11.1 剩余商品预览：未进店不显示；进入过一次后显示（数量与剩余格） ──
  const freshShopTile = gs.map.outerTiles.find((t) => !t.contentId);
  freshShopTile.contentId = 'resource_shop';
  freshShopTile.contentState = {};
  infoPanel.selectTile(freshShopTile.idx);
  assert(!hasText(infoPanel.root, '剩余商品'), '未进入过的商店 → 地块内容 tab 不显示预览');

  const enterRes = enterShop(gs, freshShopTile.idx);
  assert(enterRes.ok === true && freshShopTile.contentState.shop.visited === true, 'enterShop 置 visited');
  leaveShop(gs, freshShopTile.idx);
  infoPanel.selectTile(freshShopTile.idx);
  const unsoldN = freshShopTile.contentState.shop.stock.filter((it) => !it.sold).length;
  assert(hasText(infoPanel.root, '剩余商品'), '进入过一次 → 显示剩余商品预览');
  assert(hasText(infoPanel.root, `剩余商品 ${unsoldN} 件`), '预览数量 = 未售出件数', unsoldN);
  assert(hasText(infoPanel.root, `空格 ${12 - unsoldN} 格`), '预览显示剩余格数', 12 - unsoldN);
  EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'info' });

  // ── 2) §15【粘液】状态 tab 显示中文名 ──
  const slimeTile = gs.map.outerTiles.find((t) => !t.contentId);
  slimeTile.states = slimeTile.states || [];
  slimeTile.states.push({ type: 'slime' });
  infoPanel.selectTile(slimeTile.idx);
  buttonsWithText(infoPanel.root, '状态')[0].click();
  assert(hasText(infoPanel.root, '粘液'), '状态 tab 显示中文名「粘液」');
  assert(!hasText(infoPanel.root, 'slime'), '状态 tab 不再显示原始 type');
  EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'info' });

  // ── 3) §16.15 拖拽放置：仅地块内容类可拖；拖拽不触发地图平移；落点放置且只放 1 个 ──
  // 用背包中已有的地块内容类（设施）与产物类条目，避免重复 push 造成同 id 多格
  const facEntry = gs.inventory.items.find((e) => /^facility_/.test(e.itemId));
  assert(!!facEntry, '背包已有地块内容类（设施）物品');
  const facDef = ALL_FACILITIES.find((f) => f.id === facEntry.itemId);
  assert(!!facDef, '设施定义存在');
  assert(!!gs.inventory.items.find((e) => e.itemId === 'item_wheat'), '背包已有产物类物品（小麦）');
  EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'inventory' });
  EventBus.emit(GE.INVENTORY_CHANGE, {});

  // 背包顶层元素是 mask（无 root 属性），格子搜索以 mask 为根
  const invRoot = inventoryPanel.mask;
  const facSlots = findAll(invRoot, (el) => el.getAttribute
    && el.getAttribute('draggable') === 'true' && (el.title || '').includes(facDef.name));
  assert(facSlots.length === 1, '地块内容类（设施）格可拖拽');
  const wheatSlot = findAll(invRoot, (el) => (el.title || '').startsWith(ITEMS['item_wheat'].name + ' ×'));
  assert(wheatSlot.length >= 1 && wheatSlot.every((el) => el.getAttribute('draggable') !== 'true'),
    '产物类物品格不触发拖拽（无 draggable）');

  // dragstart：背包自动关闭 + 全局拖拽标记
  const dt = {};
  facSlots[0].dispatchEvent({
    type: 'dragstart', preventDefault() {},
    dataTransfer: { setData: (k, v) => { dt[k] = v; }, effectAllowed: '' },
  });
  assert(dt['text/plain'] === facDef.id, 'dragstart 携带物品 id');
  assert(window.__invDrag === true, 'dragstart 置全局拖拽标记');
  assert(inventoryPanel.visible === false, '拖拽开始背包自动关闭露出地图');

  // 拖拽期间地图平移被抑制
  const transformBefore = mapView.root.style.transform;
  mapView.root.dispatchEvent({ type: 'mousedown', button: 0, clientX: 100, clientY: 100, preventDefault() {} });
  window.dispatchEvent({ type: 'mousemove', clientX: 320, clientY: 300 });
  assert(mapView._drag === null && mapView.root.style.transform === transformBefore,
    '拖背包格期间地图不触发拖拽平移');
  facSlots[0].dispatchEvent({ type: 'dragend' });
  assert(window.__invDrag === false, 'dragend 复位拖拽标记');

  // drop 到空地块：放置成功且只放 1 个
  const targetTile = gs.map.outerTiles.find((t) => !t.contentId);
  let tx = -1, ty = -1;
  for (let y = 0; y < gs.map.size && tx < 0; y++) {
    for (let x = 0; x < gs.map.size; x++) {
      if (Distance.outerXYToIdx(gs.map.size, x, y) === targetTile.idx) { tx = x; ty = y; break; }
    }
  }
  assert(tx >= 0, '目标地块可反解网格坐标');
  const cntBefore = InventorySystem.countItem(gs, facDef.id);
  mapView.root.dispatchEvent({
    type: 'drop', preventDefault() {},
    clientX: tx * 80 + 10, clientY: ty * 80 + 10,
    dataTransfer: { getData: () => facDef.id },
  });
  assert(targetTile.contentId === facDef.id, 'drop → 地块放置成功');
  assert(InventorySystem.countItem(gs, facDef.id) === cntBefore - 1, '每拖一次只放 1 个（背包 -1）');
}

// ════════════════════════════════════════════════════════════
head_('第 10 批任务 A：InfoPanel 精修后 tab/地形文案状态正确');
{
  infoPanel.selectTile(2);
  assert(infoPanel.mode === 'tile', 'selectTile 后为 tile 模式', infoPanel.mode);
  // 点「状态」tab → activeTabIdx 变化且渲染状态内容
  buttonsWithText(infoPanel.root, '状态')[0].click();
  assert(infoPanel.activeTabIdx === 1, '点状态 tab → activeTabIdx=1', infoPanel.activeTabIdx);
  assert(hasText(infoPanel.root, '地形：'), '状态 tab 渲染地形行');
  assert(!hasText(infoPanel.root, '地形：terrain_'), '地形行显示中文名（不露原始 id）');
  assert(!hasText(infoPanel.root, 'tile idx ='), '调试文案已移除');
  // 点回「地块内容」
  buttonsWithText(infoPanel.root, '地块内容')[0].click();
  assert(infoPanel.activeTabIdx === 0, '点地块内容 tab → activeTabIdx=0');
  EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'info' });
}

head_('第 10 批任务 B：SpiritArea → InfoPanel 祈福（点击触发状态变化）');
{
  spiritArea.root.click();
  assert(infoPanel.mode === 'bless', '点精灵 → InfoPanel 进入 bless 模式', infoPanel.mode);
  assert(hasText(infoPanel.root, '祈福'), '祈福 tab 显示');
  infoPanel.selectTile(2);
  assert(infoPanel.mode === 'tile', 'selectTile 后退出祈福模式');
  EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'info' });
}

head_('第 10 批任务 B：RolePanel 羁绊 tab（点击触发状态变化）');
{
  EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'role' });
  buttonsWithText(rolePanel.helper.root, '羁绊等级')[0].click();
  assert(rolePanel.activeTab === 'bond', '点羁绊等级 → activeTab=bond', rolePanel.activeTab);
  buttonsWithText(rolePanel.helper.root, '技能展示')[0].click();
  assert(rolePanel.activeTab === 'skills', '点技能展示 → activeTab=skills');
  EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'role' });
}

head_('第 10 批任务 B：TeamPanel 切组（点击触发状态变化）');
{
  EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'team' });
  // 队伍按钮的文字在子 div 里 → 用 textContent 匹配
  const groupBtn = (label) => findAll(teamPanel.helper.root,
    (el) => el.tagName === 'BUTTON' && el.textContent.includes(label))[0];
  groupBtn('队伍 2').click();
  assert(teamPanel.selectedGroup === 1, '点队伍 2 → selectedGroup=1', teamPanel.selectedGroup);
  groupBtn('队伍 1').click();
  assert(teamPanel.selectedGroup === 0, '点队伍 1 → selectedGroup=0');
  EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'team' });
}

head_('第 10 批任务 B：ForgePanel 选配方+合成（点击触发状态变化）');
{
  const recipeId = Object.keys(RECIPES)[0];
  const r = RECIPES[recipeId];
  const outId = r.outputs[0].itemId;
  for (const inp of r.ingredients) InventorySystem.addItem(gs, inp.itemId, inp.qty);
  EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'forge' });
  // 配方格为可点 div（含配方产物名/图标），逐个试点击直到选中目标配方
  const clickables = findAll(forgePanel.helper.root, (el) => el._listeners && el._listeners.click && el.tagName !== 'BUTTON');
  for (const el of clickables) {
    el.dispatchEvent({ type: 'click', target: el, preventDefault() {}, stopPropagation() {} });
    if (forgePanel.selectedRecipeId === recipeId) break;
  }
  assert(forgePanel.selectedRecipeId === recipeId, '点配方格 → selectedRecipeId 命中', forgePanel.selectedRecipeId);
  // 数量 1 后点「合成」→ 产物按配方产出数进背包
  forgePanel.craftQty = 1;
  const perCraft = r.outputs[0].qty || 1;
  const cntBefore = InventorySystem.countItem(gs, outId);
  const craftBtn = buttonsWithText(forgePanel.helper.root, '合成 ×')[0];
  assert(!!craftBtn, '合成按钮存在');
  craftBtn.click();
  assert(InventorySystem.countItem(gs, outId) === cntBefore + perCraft,
    `点合成 → 产物 +${perCraft}（背包状态变化）`,
    { before: cntBefore, after: InventorySystem.countItem(gs, outId) });
  EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'forge' });
}

head_('第 10 批任务 B：InventoryPanel 切 tab（点击触发状态变化）');
{
  EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'inventory' });
  buttonsWithText(inventoryPanel.mask, '资源')[0].click();
  assert(inventoryPanel.selectedTabIdx === 2, '点资源 tab → selectedTabIdx=2', inventoryPanel.selectedTabIdx);
  buttonsWithText(inventoryPanel.mask, '总览')[0].click();
  assert(inventoryPanel.selectedTabIdx === 0, '点总览 tab → selectedTabIdx=0');
  EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'inventory' });
}

head_('第 10 批任务 B：VehiclePanel 卸下（点击触发状态变化）');
{
  gs.vehicle.current = { vehicleId: 'vehicle_wheel', usageLeft: 3 };
  EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'vehicle' });
  const unloadBtn = buttonsWithText(vehiclePanel.helper.root, '卸下')[0];
  assert(!!unloadBtn, '装备中 → 卸下按钮存在');
  unloadBtn.click();
  assert(gs.vehicle.current === null, '点卸下 → current=null');
  // detachVehicle 把剩余次数同步回 available 里的同种载具条目（不新增）
  assert(gs.vehicle.available.some((a) => a.vehicleId === 'vehicle_wheel' && a.usageLeft === 3),
    '卸下后剩余次数同步回库存条目');
  EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'vehicle' });
}

head_('第 10 批任务 B：TaskPanel 切 tab（点击触发状态变化 + 高亮更新）');
{
  EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'task' });
  buttonsWithText(taskPanel.helper.root, '核心任务')[0].click();
  assert(taskPanel.activeTab === 'core', '点核心任务 → activeTab=core', taskPanel.activeTab);
  assert(taskPanel.tabBtns[1].classList.contains('active'), '核心任务 tab 点击后高亮');
  assert(!taskPanel.tabBtns[0].classList.contains('active'), '日常任务 tab 高亮移除');
  buttonsWithText(taskPanel.helper.root, '日常任务')[0].click();
  assert(taskPanel.activeTab === 'daily', '点日常任务 → activeTab=daily');
  EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'task' });
}

head_('第 10 批任务 B：CodexPanel 切 tab（点击触发状态变化 + 高亮更新）');
{
  EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'codex' });
  buttonsWithText(codexPanel.helper.root, '天赋')[0].click();
  assert(codexPanel.activeTab === 'talents', '点天赋 → activeTab=talents', codexPanel.activeTab);
  assert(codexPanel.tabBtns[1].classList.contains('active'), '天赋 tab 点击后高亮');
  EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'codex' });
}

head_('第 10 批任务 B：SettingsPanel 槽位/返回（点击触发状态变化）');
{
  EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'settings' });
  let dialogPayload = null;
  const onDlg = (p) => { dialogPayload = p; };
  EventBus.on(GE.DIALOG_SHOW, onDlg);
  settingsPanel.slotsGrid.children[1].click();
  assert(!!dialogPayload && /Slot 2/.test(dialogPayload.title || ''), '点 Slot 2 → 弹槽位操作对话框', dialogPayload?.title);
  EventBus.off(GE.DIALOG_SHOW, onDlg);
  // 「返回主菜单」→ 面板关闭且 director.mainMenu 被调用（smoke 无 mainMenu → 只验证面板关闭）
  buttonsWithText(settingsPanel.panel, '返回主菜单')[0].click();
  assert(settingsPanel.visible === false, '点返回主菜单 → 设置面板关闭');
}

head_('第 10 批任务 B：FuncBar 建造按钮（点击触发状态变化）');
{
  const btns = findAll(funcBar.root, (el) => el.tagName === 'BUTTON');
  btns[5].click(); // items[5] = 建造
  assert(gs.buildMode === true, '点建造 → gs.buildMode=true');
  btns[5].click();
  assert(gs.buildMode === false, '再点建造 → 退出建造模式');
}

head_('第 10 批任务 B：HotBar 槽位选中（点击触发状态变化）');
{
  window.__gameDirector = director; // HotBar 经 window.__gameDirector 取 GS（镜像 main.js）
  InventorySystem.addItem(gs, 'facility_tent', 1);
  gs.hotbar[0] = { itemId: 'facility_tent' };
  hotBar.renderFromGS(gs);
  hotBar.slotEls[0].click();
  assert(hotBar.selectedSlotIdx === 0 && hotBar.selectedContentId === 'facility_tent',
    '点 slot 0 → 选中（idx + contentId）', { idx: hotBar.selectedSlotIdx, id: hotBar.selectedContentId });
  assert(hotBar.slotEls[0].classList.contains('selected'), '选中格带 selected 类');
  hotBar.slotEls[0].click();
  assert(hotBar.selectedSlotIdx === null, '再点 → 取消选中');
}

head_('第 10 批任务 B：MainMenu 图鉴入口（点击触发状态变化）');
{
  const { MainMenu } = await import('../src/ui/MainMenu.js');
  const mm = new MainMenu(director);
  mm.show();
  assert(mm.visible === true, 'MainMenu show() 可见');
  buttonsWithText(mm.mask, '图鉴')[0].click();
  assert(codexPanel.helper?.visible === true, '点图鉴 → 图鉴面板打开');
  assert(mm.visible === false, '点按钮后主菜单隐藏');
  EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'codex' });
  mm.remove();
}

// ════════════════════════════════════════════════════════════
console.log(`\nsmoke-ui 结果：${pass} 通过 / ${fail} 失败（共 ${pass + fail}）`);
process.exit(fail > 0 ? 1 : 0);
