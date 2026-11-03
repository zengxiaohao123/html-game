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
const { ShopPanel } = await import('../src/ui/panels/ShopPanel.js');
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
console.log(`\nsmoke-ui 结果：${pass} 通过 / ${fail} 失败（共 ${pass + fail}）`);
process.exit(fail > 0 ? 1 : 0);
