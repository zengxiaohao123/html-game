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
  createElementNS: (ns, t) => new FakeEl(t),
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
const { CATEGORY_TABS } = await import('../src/ui/CategoryBar.js');
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

// 测试用例会多次 new DialogBox（游戏里只有一个）：登记以便逐个清理，
// 避免上一个弹窗实例残留 visible 影响后续用例的输入门控
const _dlgRegistry = [];
const trackDlg = (d) => { _dlgRegistry.push(d); return d; };
const hideAllDialogs = () => _dlgRegistry.forEach((d) => { if (d.visible) d.hide(); });

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

head_('§16.3 地块视觉层级：地形背景层 ~95% + 放置型道具标志右下→左下');
{
  const { POTIONS } = await import('../src/data/potions.js');
  const tileIdx = 1;
  const tile = gs.map.outerTiles[tileIdx];
  const saved = { terrain: tile.terrain, contentState: tile.contentState };

  const flagsOf = (idx) => findAll(mapView.tileEls.get(idx),
    (el) => el._classes && el._classes.has('tile-flag'));
  const wrapOf = (idx) => findAll(mapView.tileEls.get(idx),
    (el) => el._classes && el._classes.has('tile-flags'))[0];

  // 1) 地形 = 背景层，面积约 95%
  tile.terrain = 'terrain_grass';
  tile.contentState = {};
  EventBus.emit(GE.TILE_UPDATED, { tileIdx });
  const tileEl = mapView.tileEls.get(tileIdx);
  const bg = findAll(tileEl, (el) => el._classes && el._classes.has('tile-terrain-bg'))[0];
  assert(!!bg, '地形作为独立背景层渲染（.tile-terrain-bg）');
  const sideRatio = parseFloat(bg?.style.width) / 100;
  const areaRatio = sideRatio * (parseFloat(bg?.style.height) / 100);
  assert(areaRatio > 0.93 && areaRatio < 0.97,
    `地形背景层面积占比约 95%（实测 ${(areaRatio * 100).toFixed(1)}%）`, { sideRatio, areaRatio });
  assert(bg?.getAttribute('data-terrain') === 'terrain_grass', '地形层绑定当前地形 id');
  assert(bg?.style.backgroundImage?.includes('tile_grass.png'), '地形层使用地形 PNG 素材', bg?.style.backgroundImage);
  assert(!findAll(tileEl, (el) => el._classes && el._classes.has('tile-terrain')).length,
    '旧右下角地形小图标已移除（不再占用标志位）');

  // 2) 无放置型道具 → 无标志
  assert(flagsOf(tileIdx).length === 0, '无放置型道具 → 无标志');

  // 2.1) 单个标志接近 20%
  tile.contentState = { placedItems: [{ itemId: 'item_trap' }] };
  EventBus.emit(GE.TILE_UPDATED, { tileIdx });
  const flags1 = flagsOf(tileIdx);
  const ratio1 = parseFloat(flags1[0]?.getAttribute('data-size-ratio'));
  assert(flags1.length === 1 && ratio1 >= 0.18 && ratio1 <= 0.20,
    `单个标志接近 20%（实测 ${(ratio1 * 100).toFixed(1)}%）`, ratio1);

  // 3) 两个放置型道具：右下→左下、6%~20%、不重叠
  tile.contentState = { placedItems: [{ itemId: 'item_trap' }, { itemId: 'item_incense' }] };
  EventBus.emit(GE.TILE_UPDATED, { tileIdx });
  const flags2 = flagsOf(tileIdx);
  const wrap2 = wrapOf(tileIdx);
  assert(flags2.length === 2, `两个放置型道具 → 两个标志（实测 ${flags2.length}）`);
  assert(wrap2?.style.flexDirection === 'row-reverse', '标志容器 row-reverse（首项右下角，后续向左排）');
  assert(wrap2?.style.right && wrap2?.style.bottom, '标志容器贴右下角（right + bottom 锚定）');
  assert(flags2[0]?.getAttribute('data-item-id') === 'item_trap', '第一个标志 = 第一个放置道具（最右）');
  const ratios2 = flags2.map((f) => parseFloat(f.getAttribute('data-size-ratio')));
  assert(ratios2.every((r) => r >= 0.06 && r <= 0.20),
    '单个标志占比落在 6%~20%', ratios2);
  const tileWidth = parseFloat(tileEl.style.width);
  const gap2 = parseFloat(wrap2?.style.gap) || 0;
  const total2 = flags2.reduce((s, f) => s + parseFloat(f.style.width), 0) + gap2 * (flags2.length - 1);
  assert(total2 <= tileWidth * 0.96, '多个标志沿底边排列不重叠（累计宽度 ≤ 格宽）', { total2, tileWidth });

  // 供后续用例模拟「物品库新增放置型道具」
  POTIONS.__smoke_placed_a = { name: '烟雾测试放置物A', emoji: '🧪', useEffect: { type: 'placed_smoke_a' } };
  POTIONS.__smoke_placed_b = { name: '烟雾测试放置物B', emoji: '🧴', useEffect: { type: 'placed_smoke_b' } };
  POTIONS.__smoke_placed_c = { name: '烟雾测试放置物C', emoji: '🪆', useEffect: { type: 'placed_smoke_c' } };
  POTIONS.__smoke_placed_d = { name: '烟雾测试放置物D', emoji: '🎯', useEffect: { type: 'placed_smoke_d' } };

  // 4) 数量多 → 单个标志更小；非放置型道具（草药）不出标志
  tile.contentState = { placedItems: [
    { itemId: 'item_trap' }, { itemId: 'item_incense' },
    { itemId: '__smoke_placed_a' }, { itemId: '__smoke_placed_b' },
    { itemId: '__smoke_placed_c' }, { itemId: '__smoke_placed_d' },
    { itemId: 'item_herb' },
  ] };
  EventBus.emit(GE.TILE_UPDATED, { tileIdx });
  const flags6 = flagsOf(tileIdx);
  assert(flags6.length === 6, `6 个放置型道具 → 6 个标志（非放置型物品被过滤，实测 ${flags6.length}）`);
  const ratio6 = parseFloat(flags6[0]?.getAttribute('data-size-ratio'));
  assert(ratio6 < ratios2[0] && ratio6 >= 0.06 && ratio6 <= 0.20,
    '数量多时单个标志更小且仍在 6%~20%', { ratio2: ratios2[0], ratio6 });

  // 5) 数据驱动：新增 useEffect.type 以 placed_ 开头的道具自动出标志
  tile.contentState = { placedItems: [{ itemId: '__smoke_placed_a' }] };
  EventBus.emit(GE.TILE_UPDATED, { tileIdx });
  const flagsNew = flagsOf(tileIdx);
  assert(flagsNew.length === 1 && flagsNew[0].getAttribute('data-item-id') === '__smoke_placed_a',
    '新增 placed_ 类型数据自动出标志（未写死道具 id）');

  // 清理：删掉测试数据并恢复该地块
  for (const k of ['__smoke_placed_a', '__smoke_placed_b', '__smoke_placed_c', '__smoke_placed_d']) delete POTIONS[k];
  tile.terrain = saved.terrain;
  tile.contentState = saved.contentState;
  EventBus.emit(GE.TILE_UPDATED, { tileIdx });
  assert(flagsOf(tileIdx).length === 0, '恢复后无放置道具 → 标志清空');
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

head_('§16.4 InfoPanel：1/4 宽 + 动态 tab（按选中对象生成）+ 面板栈接线');
{
  const tile = gs.map.outerTiles[2];
  const saved = {
    terrain: tile.terrain, states: tile.states, placedItems: tile.contentState?.placedItems,
    contentId: tile.contentId, contentState: tile.contentState, px: gs.player.x,
  };
  // 基准：无地形、无状态、玩家不在该格 → 只有「地块内容」
  tile.contentId = null;
  tile.contentState = {};
  tile.terrain = 'terrain_none';
  tile.states = [];
  gs.player.x = 0;
  infoPanel.selectTile(2);
  assert(infoPanel._panelOpen === true, '滑入后 emit UI_PANEL_OPEN(info)');
  assert(director.openPanels.includes('info'), 'openPanels 栈含 info', director.openPanels);
  let labels = (infoPanel._currentTabs || []).map((t) => t.label).join('/');
  assert(labels === '地块内容', `无地形且无单位 → 只有地块内容（实测 ${labels}）`);

  // 有地形（地形视为状态）→ 状态 tab 出现在第 2 位
  tile.terrain = 'terrain_grass';
  infoPanel._renderBody();
  labels = (infoPanel._currentTabs || []).map((t) => t.label).join('/');
  assert(labels === '地块内容/状态', `有地形 → 出现状态且顺位第 2（实测 ${labels}）`);

  // 玩家在该格（有单位）→ 单位 tab 出现在第 3 位；顺位固定 地块内容→状态→单位
  gs.player.x = 2;
  infoPanel._renderBody();
  labels = (infoPanel._currentTabs || []).map((t) => t.label).join('/');
  assert(labels === '地块内容/状态/单位', `有单位 → 出现单位且顺位第 3（实测 ${labels}）`);

  // 已选 tab 因对象变化消失 → 自动回落到合法的「地块内容」
  buttonsWithText(infoPanel.root, '单位')[0].click();
  assert(infoPanel.activeTabIdx === 2, '点单位 tab → activeTabIdx=2', infoPanel.activeTabIdx);
  gs.player.x = 0;
  infoPanel._renderBody();
  assert(infoPanel.activeTabIdx === 0, '单位消失后自动落回地块内容（activeTabIdx=0）', infoPanel.activeTabIdx);
  assert(!hasText(infoPanel.tabsWrap, '单位'), '单位 tab 已移除');

  // 点精灵 → 只有「祈福」，不显示「地块内容」
  infoPanel.showBlessTab();
  labels = (infoPanel._currentTabs || []).map((t) => t.label).join('/');
  assert(labels === '祈福', `祈福模式 → 只有祈福 tab（实测 ${labels}）`);
  assert(!hasText(infoPanel.tabsWrap, '地块内容'), '祈福模式不显示地块内容 tab');

  // 外框固定尺寸（§16.4：top/bottom 双锚点 + overflow hidden，尺寸不随 tab 数变化）
  assert(infoPanel.root.style.top === '76px' && infoPanel.root.style.bottom === '100px'
    && infoPanel.root.style.overflow === 'hidden', '外框 top/bottom 锚定且 overflow:hidden（尺寸不随内容变化）');

  tile.terrain = saved.terrain;
  tile.states = saved.states;
  tile.contentId = saved.contentId;
  tile.contentState = saved.contentState;
  gs.player.x = saved.px;
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

head_('§16.16 VehiclePanel：每行 3 张卡片 + 卡片直显描述 + 单击装/卸/替换（无二次确认）');
{
  const VEHICLES = (await import('../src/data/vehicles.js')).VEHICLES;
  gs.vehicle.nextInstanceId = 1;
  gs.vehicle.available = [
    { instanceId: 1, vehicleId: 'vehicle_wheel', usageLeft: 3 },
    { instanceId: 2, vehicleId: 'vehicle_broom', usageLeft: 3 },
    { instanceId: 3, vehicleId: 'vehicle_chance', usageLeft: Infinity },
  ];
  gs.vehicle.nextInstanceId = 4;
  gs.vehicle.current = null;
  EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'vehicle' });

  let dlgShows = 0;
  const countDialog = () => { dlgShows++; };
  EventBus.on(GE.DIALOG_SHOW, countDialog);

  const cardOf = (id) => vehiclePanel.cardEls.find((c) => c.getAttribute('data-vehicle-id') === id);
  const descOf = (card) => card.children.find((c) => c.classList?.contains('vehicle-desc'));

  // 结构与布局
  assert(vehiclePanel.helper?.visible === true, 'OPEN(vehicle) → 显示');
  assert(String(vehiclePanel.invEl.style.gridTemplateColumns).includes('repeat(3'),
    '卡片栅格每行最多 3 张、每张 minmax(0,1fr)（≈1/3 宽，最后一行左对齐）',
    vehiclePanel.invEl.style.gridTemplateColumns);
  assert(vehiclePanel.cardEls.length === 3, '3 辆载具 → 3 张卡片', vehiclePanel.cardEls.length);
  assert(buttonsWithText(vehiclePanel.helper.root, '装载').length === 0, '无「装载」按钮');
  assert(buttonsWithText(vehiclePanel.helper.root, '卸下').length === 0, '无「卸下」按钮');
  assert(!hasText(vehiclePanel.helper.root, '当前装备槽') && !hasText(vehiclePanel.helper.root, '（空）'),
    '无「当前装载中载具」格子');
  assert(hasText(vehiclePanel.helper.root, '徒步跋涉'), '未装载 → 顶部显示「当前：徒步跋涉」');

  // 卡片内直达描述（不需要点开）
  const wheelCard = cardOf('vehicle_wheel');
  const desc = descOf(wheelCard);
  assert(!!desc, '卡片直接渲染描述块（无需点开）');
  assert(desc._text === VEHICLES.vehicle_wheel.description,
    '描述逐字取数据层 ITEMS[id].description', desc._text);
  assert(desc.style.whiteSpace === 'pre-line', '描述保留原有换行（white-space: pre-line）');
  assert(desc.style.WebkitLineClamp === '4' && desc.style.overflow === 'hidden',
    '超长描述卡内 4 行截断 + 省略号，不撑破 1/3 栅格', desc.style.WebkitLineClamp);
  assert(hasText(wheelCard, '剩余 ×3'), '卡片显示剩余使用次数');
  assert(hasText(wheelCard, VEHICLES.vehicle_wheel.name), '卡片显示载具名称');
  assert(wheelCard.style.minHeight === '150px', '卡片最小高度固定，长描述不撑破栅格', wheelCard.style.minHeight);
  assert(wheelCard.style.border === '3px solid #b8a888', '未装载卡片为普通描边');

  // ① 单击装载（无确认 / 无弹窗）
  wheelCard.click();
  assert(gs.vehicle.current?.vehicleId === 'vehicle_wheel', '单击卡片一次 → 装载');
  assert(dlgShows === 0 && !hasText(vehiclePanel.helper.root, '你确定这么做？'),
    '装载全程无弹窗、无二次确认', dlgShows);
  assert(cardOf('vehicle_wheel').style.border === '3px solid #3fa34d',
    '当前载具卡片绿色边框高亮', cardOf('vehicle_wheel').style.border);
  assert(cardOf('vehicle_broom').style.border === '3px solid #b8a888', '非当前载具保持普通描边');
  assert(hasText(vehiclePanel.helper.root, '当前：') && hasText(vehiclePanel.helper.root, VEHICLES.vehicle_wheel.name),
    '顶部状态行显示当前载具');
  assert(vehiclePanel.cardEls.every((c) => c.getAttribute('data-current')
    === (c.getAttribute('data-vehicle-id') === 'vehicle_wheel' ? '1' : '0')), 'data-current 只标记当前载具');

  // ② 再点同一张 → 卸下（回到徒步），无确认
  cardOf('vehicle_wheel').click();
  assert(gs.vehicle.current === null, '再点已装载的那张一次 → 卸下');
  assert(dlgShows === 0, '卸下全程无弹窗、无二次确认', dlgShows);
  assert(hasText(vehiclePanel.helper.root, '徒步跋涉'), '卸下后顶部回到「徒步跋涉」');
  assert(cardOf('vehicle_wheel').style.border === '3px solid #b8a888', '卸下后绿框消失');
  assert(gs.vehicle.available.find((a) => a.vehicleId === 'vehicle_wheel')?.usageLeft === 3,
    '卸下后剩余次数同步回库存条目');

  // ③ 已装载 A 时点 B → 一次即替换（绿框移动），无确认
  cardOf('vehicle_wheel').click();
  assert(gs.vehicle.current?.vehicleId === 'vehicle_wheel', '先装载轮子');
  cardOf('vehicle_broom').click();
  assert(gs.vehicle.current?.vehicleId === 'vehicle_broom', '已装载时点另一张一次 → 替换');
  assert(dlgShows === 0, '替换全程无弹窗、无二次确认', dlgShows);
  assert(cardOf('vehicle_broom').style.border === '3px solid #3fa34d', '替换后绿框移到新载具');
  assert(cardOf('vehicle_wheel').style.border === '3px solid #b8a888', '替换后旧载具绿框移除');
  assert(gs.vehicle.available.find((a) => a.vehicleId === 'vehicle_wheel')?.usageLeft === 3,
    '替换时旧载具剩余次数也同步回库存');
  assert(hasText(vehiclePanel.helper.root, VEHICLES.vehicle_broom.name), '顶部状态行切换到新载具');

  // ④ 同一次点击只结算一次：同一事件对象重复派发不出现「装了又卸」
  const broomCard = cardOf('vehicle_broom');
  const dupEv = { type: 'click', target: broomCard, preventDefault() {}, stopPropagation() {} };
  broomCard.dispatchEvent(dupEv);
  broomCard.dispatchEvent(dupEv);
  assert(gs.vehicle.current === null && dlgShows === 0,
    '同一事件对象重复派发 → 只结算一次（无抖动）', gs.vehicle.current);

  // ⑤ hover / 按下反馈
  const chanceCard = cardOf('vehicle_chance');
  chanceCard.dispatchEvent({ type: 'mouseenter' });
  assert(chanceCard.style.background === '#fff8dc', 'hover → 背景高亮反馈');
  chanceCard.dispatchEvent({ type: 'mousedown' });
  assert(chanceCard.style.transform === 'scale(0.975)', '按下 → 缩放反馈');
  chanceCard.dispatchEvent({ type: 'mouseup' });
  chanceCard.dispatchEvent({ type: 'mouseleave' });
  assert(chanceCard.style.transform === 'scale(1)' && chanceCard.style.background === 'rgba(255,255,255,0.85)',
    '松开 / 移出 → 恢复默认');

  // ⑥ 同名载具 = 两个独立实例：两张卡、各自次数、绿框只标当前那一件
  gs.vehicle.available = [
    { instanceId: 10, vehicleId: 'vehicle_wheel', usageLeft: 2 },
    { instanceId: 11, vehicleId: 'vehicle_wheel', usageLeft: 3 },
  ];
  gs.vehicle.current = null;
  EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'vehicle' });
  const cardOfInst = (id) => vehiclePanel.cardEls.find((c) => c.getAttribute('data-instance-id') === String(id));

  assert(vehiclePanel.cardEls.length === 2, '同名两件 → 两张独立卡片', vehiclePanel.cardEls.length);
  assert(cardOfInst(10) && cardOfInst(11) && cardOfInst(10) !== cardOfInst(11),
    '两张卡片各自带 data-instance-id');
  assert(hasText(cardOfInst(10), '剩余 ×2') && hasText(cardOfInst(11), '剩余 ×3'),
    '两张同名卡各自显示自己的剩余次数');
  assert(cardOfInst(10).style.border === '3px solid #b8a888' && cardOfInst(11).style.border === '3px solid #b8a888',
    '未装载时两件都是普通描边');

  cardOfInst(10).click();
  assert(gs.vehicle.current?.instanceId === 10, '点第一件 → 装载第一件');
  assert(cardOfInst(10).style.border === '3px solid #3fa34d', '绿框只标第一件');
  assert(cardOfInst(11).style.border === '3px solid #b8a888', '同名第二件不被误标为当前');

  // 已装载第一件时点同名第二件 → 替换；第一件回列表且次数保留
  cardOfInst(11).click();
  assert(gs.vehicle.current?.instanceId === 11, '点同名另一件 → 替换为第二件');
  assert(cardOfInst(11).style.border === '3px solid #3fa34d' && cardOfInst(10).style.border === '3px solid #b8a888',
    '替换后绿框移到第二件');
  assert(gs.vehicle.available.find((a) => a.instanceId === 10)?.usageLeft === 2,
    '第一件回到列表且剩余次数保留');
  assert(gs.vehicle.available.find((a) => a.instanceId === 11)?.usageLeft === 3,
    '第二件剩余次数独立（未被第一件的次数覆盖）');

  cardOfInst(11).click();
  assert(gs.vehicle.current === null, '再点已装载那件 → 卸下');
  assert(gs.vehicle.available.find((a) => a.instanceId === 11)?.usageLeft === 3,
    '卸下后仍是同一实例（instanceId 不变、次数保持）');

  EventBus.off(GE.DIALOG_SHOW, countDialog);
  hideAllDialogs();
  gs.vehicle.current = null;
  gs.vehicle.available = [];
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
  const stageChildren = shopPanel.gridEl.parentNode.children;
  assert(shopPanel.refreshBtn.parentNode === shopPanel.gridEl.parentNode
    && stageChildren.indexOf(shopPanel.refreshBtn) < stageChildren.indexOf(shopPanel.gridEl),
    '刷新按钮位于第一行第一个商品左侧（同一行、在网格之前）');
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

  // 1) 功能选项与文档完全一致：[购买][售卖] 切换 + 第一行左侧刷新 + 右下离开 + 右上✖，不多不少
  const tabLabels = shopPanel.tabBtns.map((b) => b._text);
  assert(JSON.stringify(tabLabels) === JSON.stringify(['购买', '售卖']),
    '切换按钮恰为 [购买, 售卖]（出售/购买互换位置）', tabLabels);
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
  // 选一个带展示词条且不可售的物品，同时校验词条徽章
  const unsellableId = 'grimoire_grain_full';
  assert(!isSellable(unsellableId) && (ITEMS[unsellableId]?.traits || []).length > 0,
    '前置：词条物品存在且不可售', unsellableId);
  gs.inventory.items.push({ itemId: unsellableId, qty: 1 });
  EventBus.emit(GE.INVENTORY_CHANGE, {});
  shopPanel.tabBtns[1].click();   // 售卖
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
  const traitBadges = findAll(shopPanel.detailEl, (el) => el.classList && el.classList.contains('trait-badge'));
  assert(traitBadges.length > 0, '详情显示展示词条徽章（trait-badge）', traitBadges.length);

  // 5.1) 售卖分类栏：与背包共用 CategoryBar（同分组 / 同顺序 / 同选中态），可筛选（§16.21）
  const unsellableBackup = gs.inventory.items.filter((e) => e.itemId !== unsellableId);
  gs.inventory.items = [
    { itemId: 'item_wheat', qty: 3 },
    { itemId: unsellableId, qty: 1 },
  ];
  EventBus.emit(GE.INVENTORY_CHANGE, {});
  buttonsWithText(shopPanel.root, '✖')[0].click();   // 关详情弹窗
  assert(shopPanel.catBarEl && shopPanel.catBarEl.style.display === 'block', '售卖 tab 显示分类栏');
  assert(shopPanel.catBarEl.children.length === 1
    && shopPanel.catBarEl.children[0].classList.contains('tab-bar'),
    '分类栏复用背包同一 DOM（.tab-bar）', shopPanel.catBarEl.children.length);
  const catBtns = shopPanel.catBarBtns;
  assert(catBtns.length === 8, '分类栏 8 个分组（与背包一致）', catBtns.length);
  assert(catBtns.every((b) => b.classList.contains('tab-btn')),
    '分类按钮复用背包样式（.tab-btn）');
  const sellCatLabels = catBtns.map((b) => b._text);
  const invCatLabels = inventoryPanel.tabBtns.map((b) => b._text);
  assert(JSON.stringify(sellCatLabels) === JSON.stringify(CATEGORY_TABS.map((t) => t.label)),
    '售卖分类分组/顺序与共用定义一致', sellCatLabels);
  assert(JSON.stringify(sellCatLabels) === JSON.stringify(invCatLabels),
    '售卖分类与背包分类逐项一致（防漂移）', { sell: sellCatLabels, inv: invCatLabels });
  assert(catBtns[0].classList.contains('active'), '默认「总览」选中态');
  assert(catBtns.filter((c) => c.classList.contains('active')).length === 1, '分类栏选中态唯一');

  catBtns[5].click();   // 产物（点击后分类栏重建，选中态取新按钮）
  assert(shopPanel.sellCat === 5, '点击分类 → 分类索引切换', shopPanel.sellCat);
  assert(shopPanel.catBarBtns[5].classList.contains('active'), '点击分类 → 选中态切换');
  assert(shopPanel.gridEl.children.length === 1, '产物分类仅显示 1 个可售物品格', shopPanel.gridEl.children.length);

  // 5.1.1) 刷新按钮只属于购买页：售卖 tab 必须消失（不是禁用/灰化）（§16.21）
  assert(shopPanel.refreshBtn === null, '售卖 tab 无刷新按钮节点', shopPanel.refreshBtn);
  assert(!hasText(shopPanel.root, '刷新'), '售卖 tab 不残留「刷新」文案');

  // 5.2) 售卖数量：- / 输入 / + / 最大，确认才成交；购买无数量选择（§16.21）
  const goldBeforeQty = gs.player.gold;
  shopPanel.gridEl.children[0].onclick();
  const qtyInput = findAll(shopPanel.detailEl, (el) => el.getAttribute('type') === 'number')[0];
  assert(!!qtyInput && qtyInput.value === '1', '售卖详情含数量输入，默认 1', qtyInput?.value);
  const plusBtn = buttonsWithText(shopPanel.detailEl, '+')[0];
  const maxBtn = buttonsWithText(shopPanel.detailEl, '最大')[0];
  assert(!!plusBtn && !!maxBtn, '数量步进器含 + 与「最大」');
  plusBtn.click();
  assert(qtyInput.value === '2', '点击 + → 数量 2');
  maxBtn.click();
  assert(qtyInput.value === '3', '点击「最大」→ 数量 3（上限=该堆数量）');
  buttonsWithText(shopPanel.detailEl, '售卖')[0].click();
  assert(gs.player.gold === goldBeforeQty + 3 * 2, '一次卖出 3 个小麦 → +6 金币',
    { before: goldBeforeQty, after: gs.player.gold });
  gs.inventory.items = unsellableBackup;
  EventBus.emit(GE.INVENTORY_CHANGE, {});
  shopPanel.tabBtns[0].click();   // 回购买
  assert(shopPanel.catBarEl.style.display === 'none', '购买 tab 不显示分类栏');
  assert(!!shopPanel.refreshBtn && shopPanel.refreshBtn.style.display !== 'none',
    '切回购买页 → 刷新按钮重新出现');
  assert(shopPanel.stageEl.children[0] === shopPanel.refreshBtn,
    '刷新按钮仍在第一行第一个商品左侧（stage 首子元素）');

  // 6) 层级链（2026-11-06 新规则）：面板/遮罩 ≥5000 > 信息区 100 > HUD 与容量条 80 > 地图 ≤50；
  //    功能区/快捷栏 5600 夹在面板与商店遮罩之间。打开新界面要能遮挡左上角 HUD，且 HUD 不拦截鼠标。
  const shopMaskZ = Number(shopPanel.root.style.zIndex);
  const topBarZ = Number(topBar.root.style.zIndex);
  assert(shopMaskZ >= 5000 && shopMaskZ > topBarZ,
    '商店遮罩层级高于 TopBar（遮罩 ≥5000 > HUD 80）', { shop: shopMaskZ, topBar: topBarZ });
  assert(shopPanel.root.style.position === 'fixed' && shopPanel.root.style.inset === '0',
    '商店遮罩全屏铺满（打开时覆盖左上角 HUD 区域）',
    { position: shopPanel.root.style.position, inset: shopPanel.root.style.inset });
  assert(String(topBar.root.style.pointerEvents) === 'none',
    'HUD 根不拦截鼠标（pointer-events:none → 点击左上角命中遮罩）', topBar.root.style.pointerEvents);
  assert(Number(inventoryPanel.mask.style.zIndex) > topBarZ,
    '背包面板层级高于 TopBar', { panel: inventoryPanel.mask.style.zIndex, topBar: topBarZ });
  assert(Number(infoPanel.root.style.zIndex) > topBarZ,
    '信息区层级高于 HUD 与容量条（100 > 80）',
    { info: infoPanel.root.style.zIndex, topBar: topBarZ });
  assert(Number(funcBar.root.style.zIndex) > shopMaskZ
    && Number(funcBar.root.style.zIndex) < Number(inventoryPanel.mask.style.zIndex),
    '功能区 5600 高于商店遮罩、低于面板 6000', funcBar.root.style.zIndex);
  assert(Number(hotBar.wrapEl.style.zIndex) > shopMaskZ
    && Number(hotBar.wrapEl.style.zIndex) < Number(inventoryPanel.mask.style.zIndex),
    '快捷栏 5600 高于商店遮罩、低于面板 6000', hotBar.wrapEl.style.zIndex);
  assert(Number(settingsPanel.mask.style.zIndex) > shopMaskZ,
    '设置面板层级高于商店（二级嵌套可见）');

  // 6.1) 「离开」：文字恒为「离开」，首点只把灰底变红底（不离开），再点才离开；点别处取消
  assert(shopPanel.leaveBtn._text === '离开' && shopPanel.leaveBtn.style.color === '#fff'
    && shopPanel.leaveBtn.style.background === '#9a9488',
    '离开按钮初始：文字「离开」+ 灰底白字');
  shopPanel.leaveBtn.click();
  assert(shopPanel.visible === true && shopPanel.leaveBtn._text === '离开',
    '首次点击不离开且文字不变（仍为「离开」）', shopPanel.leaveBtn._text);
  assert(shopPanel.leaveBtn.style.background.includes('ff7b7b') && shopPanel.leaveBtn.style.color === '#fff',
    '首次点击 → 仅底色变红，文字不动');
  shopPanel.root.dispatchEvent({ type: 'click' });
  assert(shopPanel.leaveBtn._text === '离开' && shopPanel.leaveBtn.style.background === '#9a9488',
    '点击别处 → 取消本次点击、恢复灰底（文字仍「离开」）');
  shopPanel.leaveBtn.click();
  assert(shopPanel.leaveBtn._text === '离开' && shopPanel.leaveBtn.style.background.includes('ff7b7b'),
    '再次进入红色待确认态，文字仍「离开」');
  shopPanel.leaveBtn.click();
  assert(shopPanel.visible === false, '第二次点击「离开」→ 关闭商店');

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
  assert(shopPanel.visible === true, '魔法商店「离开」第一次点击不关闭');
  shopPanel.leaveBtn.click();
  assert(shopPanel.visible === false, '魔法商店「离开」二次确认后关闭');
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

head_('§16.10 睡觉：先文字弹窗 → 弹窗内二次确认 → 同一 tick 换日 → 1.5s 淡出；P 键同链路');
{
  const ConfirmAction = await import('../src/ui/ConfirmAction.js');
  const { DialogBox } = await import('../src/ui/DialogBox.js');
  const dlg = trackDlg(new DialogBox());
  dlg.mount();
  dlg.confirmFadeMs = 30; // 冒烟加速；真实 1.5 秒
  director.dialogBox = dlg;
  const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

  gs.player.stamina = 5;
  const dayBefore = gs.day;

  // ① 点睡觉 → 先出现文字弹窗（取消 / 睡觉），未换日；图标旁不得有行内提示
  director.requestSleep();
  assert(dlg.visible, '点睡觉 → 出现文字弹窗');
  assert(dlg.titleEl._text === '睡觉', '弹窗标题为「睡觉」', dlg.titleEl._text);
  assert((dlg.contentEl._text || '').includes('行动力尚未耗尽'), '正文提示行动力尚未耗尽');
  assert(dlg._opts.map((o) => o.label).join('/') === '取消/睡觉', '弹窗选项为 取消 / 睡觉');
  assert(gs.day === dayBefore, '弹窗出现时未换日');
  assert(!hasText(funcBar.root, ConfirmAction.CONFIRM_TEXT), '睡觉图标旁无行内「你确定这么做？」');

  // ② 弹窗内点「睡觉」一次 → 待确认（底色 + 弹窗内提示），仍不换日
  dlg._optBtns[1].click();
  assert(ConfirmAction.isArmed(dlg._optBtns[1]) && gs.day === dayBefore, '点「睡觉」一次 → 待确认、不换日');
  assert(dlg._optBtns[1].style.background === ConfirmAction.CONFIRM_ARM_BG, '待确认按钮底色改变');
  assert(dlg._hintEl.style.display === 'block' && dlg._hintEl._text === ConfirmAction.CONFIRM_TEXT,
    '弹窗内出现「你确定这么做？」');
  // 点别处 → 取消待确认并复原（弹窗保持打开）
  ConfirmAction.handleOutsideClick(funcBar.root);
  assert(!ConfirmAction.isArmed(dlg._optBtns[1]) && gs.day === dayBefore, '点别处 → 取消待确认、不换日');
  assert(dlg._hintEl.style.display === 'none', '取消后提示隐藏');
  assert(dlg._selectedIdx === -1, '取消后内部选中态归零（不残留旧选项）', dlg._selectedIdx);

  // ③ 取消后再点一次 → 必须重新待确认（不能跳过 arm 直接睡），再点一次才换日
  dlg._optBtns[1].click();
  assert(ConfirmAction.isArmed(dlg._optBtns[1]) && gs.day === dayBefore,
    '取消后再点一次「睡觉」→ 重新待确认、不换日');
  dlg._optBtns[1].click();
  assert(gs.day === dayBefore + 1, '第二次点「睡觉」→ 同一 tick 立即换日');
  assert(dlg.visible === true && dlg.mask.style.opacity === '0' && dlg.mask.style.pointerEvents === 'none',
    '生效后弹窗淡出中且不可再点');
  await sleepMs(80);
  assert(dlg.visible === false, '淡出结束 → 弹窗关闭');

  // ④ 点「取消」→ 单击关闭（safe 选项）、不换日
  gs.player.stamina = 5;
  const dayCancel = gs.day;
  director.requestSleep();
  dlg._optBtns[0].click();
  assert(gs.day === dayCancel, '点取消 → 不换日');
  await sleepMs(80);
  assert(dlg.visible === false, '点取消 → 单击关闭弹窗');

  // ⑤ P 键同链路：先弹窗 → 弹窗内两次点「睡觉」
  gs.player.stamina = 5;
  const dayKb = gs.day;
  inputManager._dispatchAction('sleep');
  assert(dlg.visible && gs.day === dayKb, 'P 键 → 同样先出现文字弹窗，不换日');
  dlg._optBtns[1].click();
  assert(gs.day === dayKb && ConfirmAction.isArmed(dlg._optBtns[1]), 'P 链路：第一次点睡觉 → 待确认、不换日');
  dlg._optBtns[1].click();
  assert(gs.day === dayKb + 1, 'P 链路：第二次点睡觉 → 同一 tick 换日');
  await sleepMs(80);
  assert(dlg.visible === false, 'P 链路淡出结束关闭');

  // ⑥ 行动力耗尽 → 无弹窗直接睡（保留旧规则）
  gs.player.stamina = 0;
  const dayEmpty = gs.day;
  const r = director.requestSleep();
  assert(r === true && gs.day === dayEmpty + 1, '行动力耗尽 → 无弹窗直接睡');
  assert(dlg.visible === false, '行动力耗尽 → 没有弹窗');

  // ⑦ P 键 gating：有面板打开时 _dispatchAction('sleep') 无反应
  gs.player.stamina = 5;
  EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'inventory' });
  const dayBefore2 = gs.day;
  inputManager._dispatchAction('sleep');
  assert(gs.day === dayBefore2 && !dlg.visible, '有界面打开时 P 无效');
  EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'inventory' });
  dlg.hide();
  director.dialogBox = null;
}

head_('统一二次确认 ConfirmAction：1.5s 淡出 / 淡出期锁定 / 点别处取消');
{
  const ConfirmAction = await import('../src/ui/ConfirmAction.js');
  assert(ConfirmAction.CONFIRM_FADE_MS === 1500, '淡出时长是常量 1.5 秒（全项目唯一）');
  const btn = new FakeEl('button');
  const hint = new FakeEl('div');
  const target = new FakeEl('div');
  let hits = 0; let faded = 0;

  // ① 首次 = 待确认：底色 + 仅调用方指定的弹窗内提示，不自动在按钮旁生成任何文案
  ConfirmAction.arm(btn);
  assert(ConfirmAction.isArmed(btn) && btn.style.background === ConfirmAction.CONFIRM_ARM_BG,
    'arm → 待确认底色变化');
  assert(btn._classes.has('confirm-armed'), 'arm → confirm-armed 类');
  assert(btn.children.length === 0, '不传 hintEl → 不在按钮上自动创建行内提示');
  ConfirmAction.disarm(btn);

  // 显式 disarm 也走同一复位通知（点别处 / ESC / 显式调用只有一个入口）
  let disarmHits = 0;
  const offDisarm = ConfirmAction.onDisarm(() => { disarmHits++; });
  ConfirmAction.arm(btn);
  ConfirmAction.disarm(btn);
  assert(disarmHits === 1, 'disarm 显式调用 → 触发 onDisarm 复位通知', disarmHits);
  offDisarm();

  ConfirmAction.arm(btn, { hintEl: hint });
  assert(hint.style.display === 'block' && hint._text === ConfirmAction.CONFIRM_TEXT,
    '传入弹窗提示元素 → 才显示「你确定这么做？」');
  assert(hits === 0, 'arm 阶段不执行业务');

  // ② 点别处 = 取消并复原
  ConfirmAction.handleOutsideClick(target);
  assert(!ConfirmAction.isArmed(btn) && btn.style.background === '', '点别处 → 取消并复原');

  // ③ 二次 = 同一 tick 执行，随后目标 1.5 秒淡出（冒烟 30ms）
  ConfirmAction.arm(btn, { hintEl: hint });
  const ok = ConfirmAction.trigger(btn, () => { hits++; }, {
    fadeTarget: target, onFaded: () => { faded++; }, fadeMs: 30,
  });
  assert(ok === true && hits === 1, 'trigger → 同一 tick 执行业务（不延迟）');
  assert(target.style.opacity === '0' && target.style.pointerEvents === 'none',
    '淡出目标透明度归零且不可再点');
  assert(ConfirmAction.isConfirming(btn) && btn.style.pointerEvents === 'none', '淡出期间按钮锁定');
  assert(ConfirmAction.trigger(btn, () => { hits++; }, { fadeTarget: target, fadeMs: 30 }) === false,
    '淡出期间重复点击无效');

  await new Promise((r) => setTimeout(r, 80));
  assert(faded === 1 && hits === 1, '淡出结束 → onFaded 触发一次，业务不重复');
  assert(!ConfirmAction.isConfirming(btn) && btn.style.pointerEvents === '', '淡出结束 → 按钮复原可再点');
}

head_('二次确认三态：取消后必须重新 arm（禁止跳过待确认直接执行）');
{
  const ConfirmAction = await import('../src/ui/ConfirmAction.js');
  const { DialogBox } = await import('../src/ui/DialogBox.js');
  const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
  const dlg = trackDlg(new DialogBox());
  dlg.mount();
  dlg.confirmFadeMs = 30;
  director.dialogBox = dlg;

  let picks = 0;
  const showDialog = () => EventBus.emit(GE.DIALOG_SHOW, {
    title: '三态测试',
    content: '点选项',
    options: [
      { label: '取消', safe: true, onSelect: () => {} },
      { label: '执行', onSelect: () => { picks++; } },
    ],
  });

  // A) arm → 点弹窗内容区取消（视觉复位）→ 再点一次：必须重新 arm
  showDialog();
  dlg._optBtns[1].click();
  assert(ConfirmAction.isArmed(dlg._optBtns[1]) && picks === 0, 'A1 首次点击 → 待确认、不执行');
  ConfirmAction.handleOutsideClick(dlg.contentEl);
  assert(!ConfirmAction.isArmed(dlg._optBtns[1]) && dlg._selectedIdx === -1,
    'A2 点内容区 → 取消且内部选中态归零（不只是视觉复位）', dlg._selectedIdx);
  dlg.mask.click(); // 同一手势的 click：只取消，不关闭弹窗
  assert(dlg.visible === true, 'A3 取消手势的 click 不关闭弹窗');
  dlg._optBtns[1].click();
  assert(ConfirmAction.isArmed(dlg._optBtns[1]) && picks === 0, 'A4 取消后再点一次 → 重新 arm、不执行');
  dlg._optBtns[1].click();
  assert(picks === 1 && dlg._confirming === true, 'A5 再点一次 → 执行且仅一次');
  await sleepMs(80);
  assert(dlg.visible === false && dlg._selectedIdx === -1, 'A6 执行后关闭并复位');

  // B) arm → ESC → 重新打开 → 点一次仍只 arm
  showDialog();
  dlg._optBtns[1].click();
  assert(ConfirmAction.isArmed(dlg._optBtns[1]) && picks === 1, 'B1 arm 后、ESC 前不执行');
  dlg._keyHandler({ key: 'Escape', preventDefault() {} });
  assert(dlg.visible === false && picks === 1 && dlg._selectedIdx === -1,
    'B2 ESC → 关闭、复位、不执行');
  showDialog();
  dlg._optBtns[1].click();
  assert(ConfirmAction.isArmed(dlg._optBtns[1]) && picks === 1, 'B3 ESC 取消后重开 → 点一次只 arm');
  dlg._optBtns[1].click();
  assert(picks === 2, 'B4 再点 → 执行一次');
  await sleepMs(80);

  // C) 连续 5 次 arm/取消 → 始终不执行；取消后再点仍从 arm 开始
  showDialog();
  let ok = true;
  for (let k = 0; k < 5; k++) {
    dlg._optBtns[1].click();
    ok = ok && ConfirmAction.isArmed(dlg._optBtns[1]) && dlg._confirming === false;
    ConfirmAction.handleOutsideClick(dlg.contentEl);
    ok = ok && !ConfirmAction.isArmed(dlg._optBtns[1]) && dlg._selectedIdx === -1 && dlg._confirming === false;
    dlg.mask.click();
  }
  assert(ok && picks === 2 && dlg.visible === true, 'C1 连续 5 次 arm/取消 → 始终不执行、弹窗不关');
  dlg._optBtns[1].click();
  assert(ConfirmAction.isArmed(dlg._optBtns[1]) && picks === 2, 'C2 5 次取消后点一次 → 仍只 arm');
  dlg._optBtns[1].click();
  assert(picks === 3, 'C3 再点 → 执行一次');
  await sleepMs(80);

  // D) 设置面板「清空此槽」同链路（同一 DialogBox 状态机）
  let cleared = 0;
  EventBus.emit(GE.DIALOG_SHOW, {
    title: '🗂️ Slot 2',
    content: '已存在存档',
    options: [
      { label: '📂 读取此存档', onSelect: () => {} },
      { label: '💾 覆盖存档', onSelect: () => {} },
      { label: '🗑️ 清空此槽', onSelect: () => { cleared++; } },
      { label: '取消', onSelect: () => {} },
    ],
  });
  dlg._optBtns[2].click();
  assert(ConfirmAction.isArmed(dlg._optBtns[2]) && cleared === 0, 'D1 清空此槽首次点击 → 待确认、不清空');
  ConfirmAction.handleOutsideClick(dlg.contentEl);
  assert(!ConfirmAction.isArmed(dlg._optBtns[2]) && dlg._selectedIdx === -1 && cleared === 0,
    'D2 点别处 → 取消、不清空');
  dlg.mask.click();
  dlg._optBtns[2].click();
  assert(ConfirmAction.isArmed(dlg._optBtns[2]) && cleared === 0, 'D3 取消后再点 → 重新 arm、不清空');
  dlg._optBtns[2].click();
  assert(cleared === 1, 'D4 再点 → 清空一次');
  await sleepMs(80);
  assert(dlg.visible === false, 'D5 清空后弹窗关闭');

  // E) 执行后不残留：新弹窗点一次仍然只 arm
  showDialog();
  dlg._optBtns[1].click();
  assert(ConfirmAction.isArmed(dlg._optBtns[1]) && picks === 3, 'E1 执行后新弹窗 → 点一次只 arm');
  dlg.hide();
  director.dialogBox = null;
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
  assert(wheatSlot.length >= 1, '产物类物品格存在');
  // L-06 / §16.15：试图拖拽不可放置物品 → 拖拽被取消（preventDefault，不触发拖拽）并弹窗提示
  {
    let cancelled = false;
    const toastsL06 = [];
    const onToastL06 = (p) => toastsL06.push(String(p.text || ''));
    EventBus.on(GE.TOAST_SHOW, onToastL06);
    wheatSlot[0].dispatchEvent({ type: 'dragstart', preventDefault() { cancelled = true; } });
    EventBus.off(GE.TOAST_SHOW, onToastL06);
    assert(cancelled, 'L-06：产物类物品拖拽被取消（不触发拖拽）');
    assert(toastsL06.some((t) => t.includes('不可放置')), 'L-06：试图拖拽不可放置物品弹窗提示');
  }

  // dragstart：背包自动关闭 + 全局拖拽标记
  const dt = {};
  facSlots[0].dispatchEvent({
    type: 'dragstart', preventDefault() {},
    dataTransfer: { setData: (k, v) => { dt[k] = v; }, effectAllowed: '' },
  });
  assert(dt['text/plain'] === facDef.id, 'dragstart 携带物品 id');
  assert(window.__invDrag === true, 'dragstart 置全局拖拽标记');
  // B-01：hide 延迟到下一帧（同步 hide 会移除拖拽源 → 浏览器取消 drag）
  assert(inventoryPanel.visible === true, 'B-01：dragstart 时背包不同步隐藏（拖拽不被取消）');

  // 拖拽期间地图平移被抑制
  const transformBefore = mapView.root.style.transform;
  mapView.root.dispatchEvent({ type: 'mousedown', button: 0, clientX: 100, clientY: 100, preventDefault() {} });
  window.dispatchEvent({ type: 'mousemove', clientX: 320, clientY: 300 });
  assert(mapView._drag === null && mapView.root.style.transform === transformBefore,
    '拖背包格期间地图不触发拖拽平移');
  facSlots[0].dispatchEvent({ type: 'dragend' });
  assert(window.__invDrag === false, 'dragend 复位拖拽标记');
  await new Promise((r) => setTimeout(r, 20));
  assert(inventoryPanel.visible === false, 'B-01：下一帧背包隐藏露出地图');

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
  const tile = gs.map.outerTiles[2];
  const savedTerrain = tile.terrain;
  tile.terrain = 'terrain_grass'; // 地形视为状态 → 状态 tab 才会出现
  infoPanel.selectTile(2);
  assert(infoPanel.mode === 'tile', 'selectTile 后为 tile 模式', infoPanel.mode);
  // 点「状态」tab → activeTabIdx 变化且渲染状态内容
  buttonsWithText(infoPanel.root, '状态')[0].click();
  assert(infoPanel.activeTabIdx === 1, '点状态 tab → activeTabIdx=1', infoPanel.activeTabIdx);
  assert(hasText(infoPanel.root, '草地：'), '状态 tab 渲染地形行（中文名 + 词条描述）');
  assert(!hasText(infoPanel.root, 'terrain_grass'), '地形行不露原始 id');
  assert(!hasText(infoPanel.root, 'tile idx ='), '调试文案已移除');
  // 点回「地块内容」
  buttonsWithText(infoPanel.root, '地块内容')[0].click();
  assert(infoPanel.activeTabIdx === 0, '点地块内容 tab → activeTabIdx=0');
  tile.terrain = savedTerrain;
  EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'info' });
}

head_('第 11 批：InfoPanel 技能详情只渲染一套（防重复 + 无 ⚡ 提示行）');
{
  const { SKILLS } = await import('../src/data/characters.js');
  const tile = gs.map.outerTiles[2];
  const saved = { id: tile.contentId, st: tile.contentState };

  // 连携技：标题 / 描述 / 冷却只出现一套，且无 ⚡ 提示行、无「使用技能卡」死按钮
  tile.contentId = 'skill_link_shift';
  tile.contentState = {};
  infoPanel.selectTile(2);
  const linkNameNodes = findAll(infoPanel.root, (el) => el._text === SKILLS.skill_link_shift.name);
  assert(linkNameNodes.length === 1,
    `连携技详情标题只出现一套（实测 ${linkNameNodes.length} 套）`);
  const cooldownRows = findAll(infoPanel.root, (el) => el._text && el._text.includes('冷却：'));
  assert(cooldownRows.length === 1, `连携技冷却只出现一行（实测 ${cooldownRows.length} 行）`);
  assert(!hasText(infoPanel.root, '⚡ 连携技：放置后满足解锁条件时'), '不再出现 ⚡ 连携技提示行');
  assert(!hasText(infoPanel.root, '⚡ 使用技能卡'), '连携技地块不出现「使用技能卡」死按钮');

  // 主动技能：详情同样只一套，且没有任何手动使用入口（挑描述行数最多的一条，覆盖多行分支）
  const activeSkill = Object.values(SKILLS)
    .filter((s) => !s.isLinkSkill && s.id.startsWith('skill_'))
    .sort((a, b) => String(b.description).split('\n').length - String(a.description).split('\n').length)[0];
  tile.contentId = activeSkill.id;
  tile.contentState = {};
  infoPanel.selectTile(2);
  const activeNameNodes = findAll(infoPanel.root, (el) => el._text === activeSkill.name);
  assert(activeNameNodes.length === 1,
    `主动技能详情标题只出现一套（实测 ${activeNameNodes.length} 套）`);
  const activeLines = String(activeSkill.description).split('\n').filter(Boolean);
  const activeDescRows = findAll(infoPanel.root, (el) => el._classes && el._classes.has('facility-desc-row'));
  assert(activeDescRows.length === activeLines.length,
    `主动技能描述行数与数据一致（实测 ${activeDescRows.length} 行 / 数据 ${activeLines.length} 行）`);
  for (const ln of activeLines) {
    const n = findAll(infoPanel.root, (el) => el._text === ln).length;
    assert(n === 1, `主动技能描述行「${ln.slice(0, 14)}…」只出现一次（实测 ${n} 次）`);
  }
  assert(!hasText(infoPanel.root, '使用技能卡') && !hasText(infoPanel.root, '使用技能'),
    '主动技能信息区没有任何「使用技能」手动入口');

  // 天赋：详情只渲染一套（RolePanel 技能展示页）
  const { TALENTS } = await import('../src/data/talents.js');
  const savedRoleId = rolePanel.selectedRoleId;
  const talent = Object.values(TALENTS).find((t) => t.roleId === savedRoleId) || Object.values(TALENTS)[0];
  rolePanel.selectedRoleId = talent.roleId;
  rolePanel._refresh();
  const talentNameCount = findAll(rolePanel.helper.root, (el) => el._text === talent.name).length;
  const talentDescCount = findAll(rolePanel.helper.root, (el) => el._text === talent.description).length;
  assert(talentNameCount === 1, `天赋标题只出现一套（实测 ${talentNameCount} 套）`);
  assert(talentDescCount === 1, `天赋描述只出现一段（实测 ${talentDescCount} 段）`);
  rolePanel.selectedRoleId = savedRoleId;
  rolePanel._refresh();

  tile.contentId = saved.id;
  tile.contentState = saved.st;
  EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'info' });
}

head_('第 12 批：信息区固定操作区（按钮在滚动区外）+ 生物实例状态徽章');
{
  const tile = gs.map.outerTiles[2];
  const saved = { id: tile.contentId, st: tile.contentState, terrain: tile.terrain, px: gs.player.x };

  // ── A) 长内容鸡舍：操作按钮必须全部落在固定操作区（滚动容器之外） ──
  tile.contentId = 'facility_henhouse';
  tile.contentState = { eggStored: 8, eggStoredGolden: 3, doorOpen: true, henhouseFeed: {} };
  tile.terrain = 'terrain_grass';
  InventorySystem.addItem(gs, 'item_rice_straw', 2);
  InventorySystem.addItem(gs, 'item_wheat', 2);
  gs.player.x = 2; // 身处该格 → 最长的内容分支（鸡蛋/优质蛋/投放饲料）
  infoPanel.selectTile(2);
  assert(infoPanel.actionWrap.style.display === 'flex', '有操作选项 → 固定操作区显示');
  const doorBtns = buttonsWithText(infoPanel.actionWrap, '🚪');
  assert(doorBtns.length === 1, '鸡舍「开门/关门」选项存在（数据层有 action、渲染未丢）', doorBtns.length);
  const contentBtns = findAll(infoPanel.root, (el) => el._classes && el._classes.has('action-btn'));
  assert(contentBtns.length > 0 && contentBtns.every((b) => infoPanel.actionWrap.contains(b)),
    `地块内容操作按钮全部在固定操作区（${contentBtns.length} 个）`);
  assert(contentBtns.every((b) => !infoPanel.bodyWrap.contains(b)),
    '滚动容器内没有任何操作按钮（不会被长正文挤出视野/裁切）');
  assert(infoPanel.bodyWrap.style.overflowY === 'auto' && infoPanel.bodyWrap.style.minHeight === '0',
    '正文是唯一滚动区（overflowY:auto + minHeight:0）');
  assert(infoPanel.actionWrap.style.flexShrink === '0', '固定操作区不参与正文压缩（常驻可见）');
  assert(hasText(infoPanel.bodyWrap, '【进入时】'), '长内容时正文仍保留设施描述（可滚动查看）');
  const beforeDoor = tile.contentState.doorOpen;
  doorBtns[0].click();
  assert(tile.contentState.doorOpen === !beforeDoor, '点开门/关门 → 鸡舍门状态翻转（按钮可点）');

  // ── B) 技能地块不产生任何操作按钮（技能只展示，无手动入口） ──
  const { SKILLS } = await import('../src/data/characters.js');
  const activeSkill = Object.values(SKILLS).find((s) => !s.isLinkSkill && s.id.startsWith('skill_'));
  tile.contentId = activeSkill.id;
  tile.contentState = {};
  infoPanel.selectTile(2);
  const skillBtns = findAll(infoPanel.root, (el) => el._classes && el._classes.has('action-btn'));
  assert(skillBtns.length === 0,
    `技能地块没有任何操作按钮（实测 ${skillBtns.map((b) => b.textContent.trim()).join('|') || '0 个'}）`);
  assert(infoPanel.actionWrap.style.display === 'none', '技能地块固定操作区不显示（无操作可做）');

  // ── C) 生物实例状态徽章：已投喂 vs 饥饿 必须不同 ──
  const cell = gs.map.fence[0];
  const savedFenceCreatures = cell.creatures;
  const savedGsCreatures = gs.creatures.slice();
  const mkChick = (id, fed) => ({
    id, kind: 'chick', hp: 50, maxHp: 50, atk: 0, growth: 0, growthMax: 100,
    mood: 0, stage: 'chick', category: 'friendly', lastFed: fed, activeBuffs: [],
  });
  cell.creatures = ['t12_fed', 't12_hungry'];
  gs.creatures.push(mkChick('t12_fed', true), mkChick('t12_hungry', false));
  EventBus.emit(GE.FENCE_TILE_CLICKED, { fenceIdx: 0 });
  assert(infoPanel.mode === 'fence', '点栅栏内地块 → fence 模式');
  const fenceLabels = (infoPanel._currentTabs || []).map((t) => t.label).join('/');
  assert(fenceLabels.includes('单位'), `有生物 → 单位 tab 出现（实测 ${fenceLabels}）`);
  buttonsWithText(infoPanel.root, '单位')[0].click();
  const cards = findAll(infoPanel.root, (el) => el._listeners && el._listeners.click && el.tagName === 'DIV'
    && el.attributes && el.attributes.title && ['小鸡'].includes(el.attributes.title));
  assert(cards.length === 2, '栅栏格显示两只小鸡（实例列表）', cards.length);

  cards[0].click();
  assert(infoPanel.creatureDetailId === 't12_fed', '点第 1 只 → 打开该实例详情');
  const fedBadges = findAll(infoPanel.root, (el) => el._classes && el._classes.has('state-badge'));
  assert(fedBadges.length === 1 && fedBadges[0]._text.includes('已投喂'),
    `已投喂个体显示【已投喂】徽章（实测 ${fedBadges.map((b) => b._text).join('|')}）`);
  assert(!hasText(infoPanel.root, '饥饿'), '已投喂个体不显示【饥饿】');

  // 返回列表 → 点第 2 只（饥饿）→ 徽章不同
  buttonsWithText(infoPanel.root, '←')[0].click();
  // 返回后重新取卡片（列表已重绘）
  const cards2 = findAll(infoPanel.root, (el) => el._listeners && el._listeners.click && el.tagName === 'DIV'
    && el.attributes && el.attributes.title && ['小鸡'].includes(el.attributes.title));
  cards2[1].click();
  assert(infoPanel.creatureDetailId === 't12_hungry', '点第 2 只 → 打开另一实例');
  const hungryBadges = findAll(infoPanel.root, (el) => el._classes && el._classes.has('state-badge'));
  assert(hungryBadges.length === 1 && hungryBadges[0]._text.includes('饥饿'),
    `饥饿个体显示【饥饿】徽章（实测 ${hungryBadges.map((b) => b._text).join('|')}）`);
  assert(!hasText(infoPanel.root, '已投喂'), '饥饿个体不显示【已投喂】');

  // 状态变化 → 详情徽章实时刷新（模拟跨日结算：lastFed 翻转 + CREATURE_DEFEATED 通知）
  const target = gs.creatures.find((c) => c.id === 't12_hungry');
  target.lastFed = true;
  EventBus.emit(GE.CREATURE_DEFEATED, { creature: target });
  const afterBadges = findAll(infoPanel.root, (el) => el._classes && el._classes.has('state-badge'));
  assert(afterBadges.length === 1 && afterBadges[0]._text.includes('已投喂'),
    '状态变为已投喂后徽章随之刷新（无需重开面板）');

  // ── 还原 ──
  cell.creatures = savedFenceCreatures;
  gs.creatures.length = 0;
  gs.creatures.push(...savedGsCreatures);
  infoPanel.creatureDetailId = null;
  tile.contentId = saved.id;
  tile.contentState = saved.st;
  tile.terrain = saved.terrain;
  gs.player.x = saved.px;
  infoPanel.selectTile(2);
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

head_('第 10 批任务 B：VehiclePanel 交互全程无二次确认（点别处/无弹窗）');
{
  const { DialogBox } = await import('../src/ui/DialogBox.js');
  const vd = trackDlg(new DialogBox());
  vd.mount();
  vd.confirmFadeMs = 30;
  director.dialogBox = vd;
  const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

  let dlgShows = 0;
  const onShow = () => { dlgShows++; };
  EventBus.on(GE.DIALOG_SHOW, onShow);

  gs.vehicle.available = [
    { instanceId: 20, vehicleId: 'vehicle_wheel', usageLeft: 2 },
    { instanceId: 21, vehicleId: 'vehicle_broom', usageLeft: 3 },
  ];
  gs.vehicle.current = null;
  EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'vehicle' });

  const cardOf = (id) => vehiclePanel.cardEls.find((c) => c.getAttribute('data-vehicle-id') === id);

  // 连续：装载 → 卸下 → 装载 → 替换，每一步都只结算一次
  cardOf('vehicle_wheel').click();
  assert(gs.vehicle.current?.vehicleId === 'vehicle_wheel', '单击装载（立即生效）');
  cardOf('vehicle_wheel').click();
  assert(gs.vehicle.current === null, '再点同一张卸下（立即生效）');
  cardOf('vehicle_wheel').click();
  cardOf('vehicle_broom').click();
  assert(gs.vehicle.current?.vehicleId === 'vehicle_broom', '已装载时点别的替换（立即生效）');
  await sleepMs(60);

  assert(dlgShows === 0 && vd.visible === false, '全程未发 DIALOG_SHOW、无弹窗', dlgShows);
  assert(!hasText(vehiclePanel.helper.root, '你确定这么做？'), '无待确认行内文案');
  assert(vehiclePanel.cardEls.filter((c) => c.style.border === '3px solid #3fa34d').length === 1,
    '同一时刻只有一张卡片是绿色边框');
  assert(buttonsWithText(vehiclePanel.helper.root, '卸下').length === 0
    && buttonsWithText(vehiclePanel.helper.root, '装载').length === 0, '仍无装载 / 卸下按钮');

  EventBus.off(GE.DIALOG_SHOW, onShow);
  gs.vehicle.current = null;
  gs.vehicle.available = [];
  EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'vehicle' });
  director.dialogBox = null;
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
// 第 11 批：§16.4 选项模式 —— 数字键 1~6 + 两段式确认（选中→再点确认）
// ════════════════════════════════════════════════════════════
head_('第 11 批 §16.4：DialogBox 选项两段式 + 数字键等效 + 弹窗期间数字键不抢 HotBar');
{
  const { DialogBox } = await import('../src/ui/DialogBox.js');
  const dlg = trackDlg(new DialogBox());
  dlg.mount();
  dlg.confirmFadeMs = 30; // 冒烟加速（文档口径仍为 2 秒，见 CONFIRM_FADE_MS）
  director.dialogBox = dlg; // InputManager 数字键 gating 依赖（镜像 main.js）

  const key = (k) => window.dispatchEvent({ type: 'keydown', key: k, preventDefault() {} });
  const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

  // ── 1) 第一次点击 = 选中（浅绿底 + 下方小字），不触发结果 ──
  let picked = null;
  EventBus.emit(GE.DIALOG_SHOW, {
    title: '测试选项',
    content: '选一个',
    options: [
      { label: '甲', onSelect: () => { picked = '甲'; } },
      { label: '乙', onSelect: () => { picked = '乙'; } },
      { label: '丙', onSelect: () => { picked = '丙'; } },
    ],
  });
  assert(dlg.visible === true && dlg._optBtns.length === 3, 'DIALOG_SHOW → 3 个选项按钮');
  dlg._optBtns[0].click();
  assert(dlg._selectedIdx === 0, '第一次点击 → 选中（未触发结果）', dlg._selectedIdx);
  assert(dlg._optBtns[0].style.background === '#d9efdc', '选中项浅绿色背景');
  assert(dlg._hintEl.style.display === 'block' && dlg._hintEl._text === '你确定这么做？',
    '选中后下方出现小字「你确定这么做？」');
  assert(picked === null && dlg.visible === true, '选中阶段不触发 onSelect、弹窗保留');

  // ── 2) 点击别处 = 取消选中（不关闭） ──
  dlg.mask.click();
  assert(dlg._selectedIdx === -1 && dlg.visible === true, '点遮罩 → 取消选中且不关闭');
  assert(dlg._optBtns[0].style.background === '' && dlg._hintEl.style.display === 'none',
    '取消后背景与小字复位');

  // ── 3) 数字键选择 = 鼠标等效；再按一次 = 确认（同一 tick 立即执行） ──
  key('2');
  assert(dlg._selectedIdx === 1, '数字键 2 → 选中第 2 项');
  key('3');
  assert(dlg._selectedIdx === 2, '数字键 3 → 切换选中到第 3 项');
  key('3');
  assert(dlg._confirming === true, '再按已选数字键 → 进入确认');
  assert(picked === '丙', '确认后同一 tick 立即触发 onSelect（不延迟、不先复原）', picked);
  assert(dlg._optBtns[2].style.background === '#f7e6a8', '确认项淡金色背景');
  assert(dlg._optBtns[2].classList.contains('dialog-opt-flash'), '确认项闪烁类已加');
  assert(dlg.mask.style.pointerEvents === 'none', '淡出期间整卡不可再点');
  key('1');
  assert(dlg._selectedIdx === 2, '确认动画期间其他数字键无效', dlg._selectedIdx);

  // ── 4) 1.5 秒（冒烟 30ms）淡出后才关闭（业务已在第 3 步当场生效） ──
  assert(dlg.visible === true && dlg.mask.style.opacity === '0', '淡出中：卡片仍在、透明度归零');
  await sleepMs(500);
  assert(dlg.visible === false, '淡出结束 → 弹窗关闭', { visible: dlg.visible, confirming: dlg._confirming });
  assert(picked === '丙', '执行业务在淡出前已完成，不被动画拦截', picked);

  // ── 5) 弹窗打开时数字键不抢 HotBar；关闭后恢复 ──
  inputManager.bind();
  let hotbarSel = null;
  const onSel = (p) => { hotbarSel = p; };
  EventBus.on(GE.HOTBAR_SELECT_SLOT, onSel);
  EventBus.emit(GE.DIALOG_SHOW, {
    title: '门禁测试',
    options: [{ label: '唯一项', onSelect: () => { picked = '唯一项'; } }],
  });
  key('1');
  assert(hotbarSel === null && dlg._selectedIdx === 0, '弹窗开时按 1 → 只选选项，不 emit HOTBAR_SELECT_SLOT');
  dlg.hide();
  key('1');
  assert(hotbarSel && hotbarSel.slotIdx === 0, '弹窗关后按 1 → HotBar 选中恢复', hotbarSel);
  EventBus.off(GE.HOTBAR_SELECT_SLOT, onSel);
  inputManager.unbind();

  // ── 6) ESC 关闭沿用 ──
  EventBus.emit(GE.DIALOG_SHOW, { title: 'ESC 测试', options: [{ label: '好', onSelect: () => {} }] });
  key('Escape');
  assert(dlg.visible === false, 'ESC → 关闭弹窗');
}

// ════════════════════════════════════════════════════════════
head_('第 12 批：弹窗连点重入 / ESC 归弹窗 / drop 复位拖拽标记');
{
  const { DialogBox } = await import('../src/ui/DialogBox.js');
  const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
  const dlg2 = trackDlg(new DialogBox());
  dlg2.mount();
  dlg2.confirmFadeMs = 30;
  const prevDlg = director.dialogBox;
  director.dialogBox = dlg2;

  // ── 1) 连点重入：第一个弹窗确认途中被第二个 DIALOG_SHOW 覆盖 ──
  let pickedA = null, pickedB = null;
  EventBus.emit(GE.DIALOG_SHOW, {
    title: '第一个',
    options: [{ label: '甲', onSelect: () => { pickedA = '甲'; } }],
  });
  dlg2._optBtns[0].click();
  dlg2._optBtns[0].click(); // 进入确认（计时器在途）
  assert(dlg2._confirming === true, '第一个弹窗进入确认');
  assert(pickedA === '甲', '旧弹窗确认已当场执行（同一 tick）');
  EventBus.emit(GE.DIALOG_SHOW, {
    title: '第二个',
    options: [{ label: '乙', onSelect: () => { pickedB = '乙'; } }],
  });
  assert(dlg2.visible === true && dlg2._confirming === false && dlg2.titleEl._text === '第二个',
    '第二个弹窗覆盖第一个（确认态复位）');
  await sleepMs(500); // 越过旧淡出计时器时间窗
  assert(dlg2.visible === true && pickedA === '甲',
    '旧淡出计时器被清理：不关新弹窗（旧业务已生效）');
  dlg2._optBtns[0].click();
  dlg2._optBtns[0].click();
  await sleepMs(500);
  assert(dlg2.visible === false && pickedB === '乙', '新弹窗自身确认链路正常');

  // ── 2) 键盘监听不叠加：show/hide 一轮后 window keydown 监听数量还原 ──
  const kdBefore = (winListeners['keydown'] || []).length;
  EventBus.emit(GE.DIALOG_SHOW, { title: '监听', options: [{ label: '好', onSelect: () => {} }] });
  dlg2.hide();
  assert((winListeners['keydown'] || []).length === kdBefore,
    'show/hide 一轮后 keydown 监听无残留', { before: kdBefore, after: (winListeners['keydown'] || []).length });

  // ── 3) 弹窗打开时 ESC 归弹窗：不叠加打开设置（镜像 main.js：先 bind 输入，后弹弹窗）──
  inputManager.bind();
  EventBus.emit(GE.DIALOG_SHOW, { title: 'ESC 门禁', options: [{ label: '好', onSelect: () => {} }] });
  assert(dlg2.visible === true, '弹窗已打开');
  const stackBefore = [...director.openPanels];
  const settingsBefore = settingsPanel.visible;
  window.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {} });
  assert(dlg2.visible === false, 'ESC → 弹窗关闭');
  assert(settingsPanel.visible === settingsBefore
      && director.openPanels.join(',') === stackBefore.join(','),
    'ESC 关弹窗不再叠加打开设置/动面板栈（状态不错乱）',
    { settings: settingsPanel.visible, stack: director.openPanels });
  inputManager.unbind();

  // ── 4) drop 兜底复位全局拖拽标记（地图 / HotBar）──
  window.__invDrag = true;
  mapView.root.dispatchEvent({
    type: 'drop', preventDefault() {},
    dataTransfer: { getData: () => '' }, clientX: 0, clientY: 0,
  });
  assert(window.__invDrag === false, '地图 drop 后拖拽标记复位（平移不会被永久抑制）');
  window.__invDrag = true;
  hotBar.slotEls[0].dispatchEvent({
    type: 'drop', preventDefault() {},
    dataTransfer: { getData: () => '' },
  });
  assert(window.__invDrag === false, 'HotBar drop 后拖拽标记复位');

  director.dialogBox = prevDlg;
}

// ════════════════════════════════════════════════════════════
head_('第 13 批 波 2：UI 修复验证（门控 / 信息区 / 商店 / 建造 / 编队 / 连携 / 出货箱）');
{
  const { HookDispatcher } = await import('../src/core/HookDispatcher.js');
  const { LinkSkillSystem, WINDOW_MS } = await import('../src/systems/LinkSkillSystem.js');
  const { getRealtimeClock } = await import('../src/systems/RealtimeClock.js');
  const { DialogBox } = await import('../src/ui/DialogBox.js');

  // ── S-01 / S-02 / M-01：界面打开时 WASD / 空格 / 数字键失效（§16.20） ──
  EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'inventory' }); // 防御性：确保从干净状态开始
  EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'info' });
  inputManager.bind();
  EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'inventory' });
  const x0 = gs.player.x;
  window.dispatchEvent({ type: 'keydown', key: 'd', preventDefault() {} });
  assert(gs.player.x === x0, 'S-01：背包打开时按 D 不移动（§16.20）');
  gs.player.stamina = 8;
  gs.player.gold = 10;
  const blessN0 = gs.team.dailyBlessCount || 0;
  window.dispatchEvent({ type: 'keydown', key: ' ', preventDefault() {} });
  assert((gs.team.dailyBlessCount || 0) === blessN0, 'S-02：界面打开时按空格不祈福（§16.20）');
  let selW2 = null;
  const onSelW2 = (p) => { selW2 = p; };
  EventBus.on(GE.HOTBAR_SELECT_SLOT, onSelW2);
  window.dispatchEvent({ type: 'keydown', key: '1', preventDefault() {} });
  assert(selW2 === null, 'M-01：界面打开时按 1 不触发 HotBar 选中');
  EventBus.off(GE.HOTBAR_SELECT_SLOT, onSelW2);
  EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'inventory' });

  // ── M-02：弹窗打开时 P 不顶替弹窗（§16.10） ──
  const dlgW2 = trackDlg(new DialogBox());
  dlgW2.mount();
  const prevDlgW2 = director.dialogBox;
  director.dialogBox = dlgW2;
  const dialogsW2 = [];
  const onDlgW2 = (p) => dialogsW2.push(p);
  EventBus.on(GE.DIALOG_SHOW, onDlgW2);
  gs.player.stamina = 5;
  EventBus.emit(GE.DIALOG_SHOW, { title: '已有弹窗', options: [{ label: '好的', onSelect: () => {} }] });
  window.dispatchEvent({ type: 'keydown', key: 'p', preventDefault() {} });
  assert(dialogsW2.length === 1 && dlgW2.titleEl._text === '已有弹窗',
    'M-02：弹窗打开时按 P 不顶替弹窗（不弹睡觉确认）');
  dlgW2.hide();
  EventBus.off(GE.DIALOG_SHOW, onDlgW2);
  director.dialogBox = prevDlgW2;
  inputManager.unbind();

  // ── S-03：信息面板地块内容描述回退物品库（def.description） ──
  // 测试后期 8 格均已占用 → 直接覆写固定地块（本块为最后一块，无副作用）
  const evtTile = gs.map.outerTiles[0];
  evtTile.contentId = 'resource_event';
  evtTile.contentState = {}; evtTile.dailyFlags = {}; evtTile.states = [];
  infoPanel.selectTile(evtTile.idx);
  buttonsWithText(infoPanel.root, '地块内容')[0].click();
  assert(hasText(infoPanel.root, '遇到随机事件'), 'S-03：事件点描述回退物品库（遇到随机事件）');
  assert(!hasText(infoPanel.root, '（词条未配置）'), 'S-03：不再出现「（词条未配置）」');
  const cornTile = gs.map.outerTiles[1];
  cornTile.contentId = 'facility_corn';
  cornTile.contentState = {}; cornTile.dailyFlags = {}; cornTile.states = [];
  infoPanel.selectTile(cornTile.idx);
  buttonsWithText(infoPanel.root, '地块内容')[0].click();
  assert(hasText(infoPanel.root, '获得玉米 ×1'), 'S-03：玉米描述回退物品库（获得玉米 ×1）');

  // ── L-02：帐篷描述用物品库文案（无「放回背包」） ──
  const tentTile = gs.map.outerTiles[3];
  tentTile.contentId = 'facility_tent';
  tentTile.contentState = {}; tentTile.dailyFlags = {}; tentTile.states = [];
  infoPanel.selectTile(tentTile.idx);
  buttonsWithText(infoPanel.root, '地块内容')[0].click();
  assert(!hasText(infoPanel.root, '放回背包') && hasText(infoPanel.root, '改为回满行动力'),
    'L-02：帐篷描述 = 物品库文案（无「放回背包」旧文案）');
  EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'info' });

  // ── M-03：踩商店格不自动打开商店（§16.21 改为点击进入） ──
  const shopTileW2 = gs.map.outerTiles[4];
  shopTileW2.contentId = 'resource_shop';
  shopTileW2.contentState = {}; shopTileW2.dailyFlags = {}; shopTileW2.states = [];
  HookDispatcher.fire('onEnter', { gs, tileIdx: shopTileW2.idx });
  assert(shopPanel.visible === false, 'M-03：踩商店格不自动打开商店（由信息区点击进入）');

  // ── M-04：离开商店格自动关闭商店 ──
  EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'shop', tileIdx: shopTileW2.idx });
  assert(shopPanel.visible === true, 'M-04 前置：商店已打开');
  EventBus.emit(GE.MOVE, {
    fromIdx: shopTileW2.idx, toIdx: (shopTileW2.idx + 1) % 8, direction: 'right', path: [],
  });
  assert(shopPanel.visible === false, 'M-04：离开商店格自动关闭商店（§16.21）');

  // ── M-05：建造模式下 ESC 只退出建造 ──
  BuildSystem.enterBuildMode(gs);
  assert(gs.buildMode === true, 'M-05 前置：已进入建造模式');
  director.handleESC();
  assert(gs.buildMode === false && settingsPanel.visible === false,
    'M-05：建造模式下 ESC 只退出建造模式（不打开设置）');

  // ── M-07：进入建造模式默认选中 1 号位 ──
  window.__gameDirector = director; // HotBar._getCurrentGS 依赖（镜像 main.js）
  BuildSystem.enterBuildMode(gs);
  assert(hotBar.selectedSlotIdx === 0, 'M-07：进入建造模式默认选中 1 号位');
  BuildSystem.exitBuildMode(gs);
  assert(hotBar.selectedSlotIdx === null, 'M-07：退出建造模式清空选中');
  window.__gameDirector = null;

  // ── M-06：快捷编队打开时 ✕ / 遮罩先关二级（§16.20） ──
  teamPanel.helper.show();
  teamPanel._quickEditMode = true;
  let quickClosedW2 = false;
  const origCloseQuickW2 = teamPanel._closeQuick;
  teamPanel._closeQuick = () => { quickClosedW2 = true; teamPanel._quickEditMode = false; };
  const maskW2 = teamPanel.helper.root; // helper root 即 panel-mask
  maskW2.onclick({ target: maskW2 });
  assert(quickClosedW2 && maskW2.style.display === 'flex',
    'M-06：快捷编队打开时点 ✕/遮罩 先关二级、不关整个面板');
  teamPanel._closeQuick = origCloseQuickW2;
  teamPanel.helper.hide();

  // ── M-08：选项模式放信息区（§16.4） ──
  const dlgPos = trackDlg(new DialogBox());
  dlgPos.mount();
  dlgPos.show({ title: '位置测试', options: [{ label: '甲', onSelect: () => {} }] });
  assert(dlgPos.box.style.right === '20px' && dlgPos.box.style.transform === 'translate(0, -50%)',
    'M-08：弹窗卡片定位信息区（右侧、垂直居中，与 InfoPanel 一致）');
  assert(dlgPos.mask.style.backgroundColor === 'rgba(0,0,0,0)', 'M-08：遮罩透明不压暗主界面');
  dlgPos.mask.click();
  assert(dlgPos._selectedIdx === -1, 'M-08：点击别处仍取消选中');
  dlgPos.hide();

  // ── M-09：连携排队不计时（§12.5 窗口自成为队首起算） ──
  gs.linkSkillQueue = [];
  gs.linkSkillCooldowns = gs.linkSkillCooldowns || {};
  // 裁定 5：连携技必须放置才可入队（用格 2/3，测后还原）
  const savedRolesM9 = (gs.team.groups[0].roles || []).slice();
  gs.team.groups[0].roles = ['yumo', 'luyouyou'];
  const tA = gs.map.outerTiles[2], tB = gs.map.outerTiles[3];
  const savedA = { id: tA.contentId, st: tA.contentState };
  const savedB = { id: tB.contentId, st: tB.contentState };
  tA.contentId = 'skill_link_yumo_drain';
  LinkSkillSystem.onSkillCardPlaced(gs, 2, 'skill_link_yumo_drain');
  tB.contentId = 'skill_link_luyouyou_rise_wind';
  LinkSkillSystem.onSkillCardPlaced(gs, 3, 'skill_link_luyouyou_rise_wind');
  LinkSkillSystem.enqueue(gs, { tileIdx: 2, skillId: 'skill_link_yumo_drain' });
  LinkSkillSystem.enqueue(gs, { tileIdx: 3, skillId: 'skill_link_luyouyou_rise_wind' });
  const qe1 = gs.linkSkillQueue[0];
  const qe2 = gs.linkSkillQueue[1];
  assert(qe1 && qe1.expireAtMs > Date.now(), 'M-09：队首开始 8 秒窗口');
  assert(qe1 && qe1.expireAtMs - Date.now() > 7500 && qe1.expireAtMs - Date.now() <= 8000,
    `M-09：窗口时长 8000ms（实测 ${qe1 ? qe1.expireAtMs - Date.now() : '?'}ms）`);
  assert(qe2 && qe2.expireAtMs === null, 'M-09：排队条目不计时（§12.5）');
  qe1.expireAtMs = Date.now() - 10;
  LinkSkillSystem.pruneExpired(gs);
  assert(gs.linkSkillQueue.length === 1
    && gs.linkSkillQueue[0].skillId === 'skill_link_luyouyou_rise_wind'
    && gs.linkSkillQueue[0].expireAtMs > Date.now(),
    'M-09：队首过期后新队首开始计时');
  gs.linkSkillQueue = [];
  // 还原地块与编队（避免影响后续用例）
  tA.contentId = savedA.id; tA.contentState = savedA.st;
  tB.contentId = savedB.id; tB.contentState = savedB.st;
  delete gs.linkSkillCounters['2|skill_link_yumo_drain'];
  delete gs.linkSkillCounters['3|skill_link_luyouyou_rise_wind'];
  delete gs.linkSkillCooldowns['2|skill_link_yumo_drain'];
  delete gs.linkSkillCooldowns['3|skill_link_luyouyou_rise_wind'];
  gs.team.groups[0].roles = savedRolesM9;

  // ── 连携窗口圆形计时环：队首从满圈逆时针消减到 0 → 窗口消失（§12.5 / §16.18） ──
  {
    const realDateNow = Date.now;
    let fakeNow = realDateNow();
    Date.now = () => fakeNow;
    const tR1 = gs.map.outerTiles[2], tR2 = gs.map.outerTiles[3];
    const savedR1 = { id: tR1.contentId, st: tR1.contentState };
    const savedR2 = { id: tR2.contentId, st: tR2.contentState };
    const savedRolesRing = (gs.team.groups[0].roles || []).slice();
    try {
      const clock = getRealtimeClock(() => gs);
      const C = 2 * Math.PI * 33; // 环半径 33（外缘 33 + 6/2 = 36 = 窗口半径）
      const ringLen = (i) => parseFloat(linkSkillUI._rings[i].circle.getAttribute('stroke-dasharray'));

      gs.linkSkillQueue = [];
      gs.team.groups[0].roles = ['yumo', 'luyouyou'];
      tR1.contentId = 'skill_link_yumo_drain';
      LinkSkillSystem.onSkillCardPlaced(gs, 2, 'skill_link_yumo_drain');
      tR2.contentId = 'skill_link_luyouyou_rise_wind';
      LinkSkillSystem.onSkillCardPlaced(gs, 3, 'skill_link_luyouyou_rise_wind');
      LinkSkillSystem.enqueue(gs, { tileIdx: 2, skillId: 'skill_link_yumo_drain' });
      LinkSkillSystem.enqueue(gs, { tileIdx: 3, skillId: 'skill_link_luyouyou_rise_wind' });

      assert(linkSkillUI._rings.length === 2, '每个连携窗口各有一条圆形计时环', linkSkillUI._rings.length);
      const ringCircle = linkSkillUI._rings[0].circle;
      const ringSvg = ringCircle.parentNode;
      const winBox = linkSkillUI.listEl.children[0];
      assert(ringCircle.getAttribute('stroke') === '#ffffff'
        && ringCircle.getAttribute('stroke-width') === '6',
        '计时环为白色 6px 圆环（已加粗）', ringCircle.getAttribute('stroke-width'));
      // 环与窗口严格同尺寸：画布 = 窗口 72px，外径 = 2r + 环宽 = 72，正好压在窗口边界上
      assert(ringSvg.getAttribute('width') === '72' && ringSvg.getAttribute('height') === '72'
        && ringSvg.getAttribute('viewBox') === '0 0 72 72',
        '环画布与窗口尺寸一致（无外扩）', `${ringSvg.getAttribute('width')}×${ringSvg.getAttribute('height')}`);
      const ringOuterD = parseFloat(ringCircle.getAttribute('r')) * 2 + parseFloat(ringCircle.getAttribute('stroke-width'));
      assert(ringOuterD === 72 && winBox.style.width === '72px' && winBox.style.height === '72px',
        '环外径 = 窗口直径（正好压在窗口边界上）', { ringOuterD, w: winBox.style.width });
      assert(winBox.style.overflow === 'hidden' && winBox.style.border === 'none',
        '底板裁在圆环内（无外边框、溢出隐藏）');
      const idxBadge = winBox.children.find((c) => c._text === '1');
      assert(idxBadge && !String(idxBadge.style.top).startsWith('-') && !String(idxBadge.style.right).startsWith('-'),
        '序号角标收在窗口内，不被圆环或裁剪切掉',
        idxBadge ? { top: idxBadge.style.top, right: idxBadge.style.right } : null);
      const nameEl = winBox.children.find((c) => c._text === '汲取');
      assert(nameEl && nameEl.style.maxWidth === '42px',
        '技能名收在加粗圆环内侧，不被圆环压住', nameEl?.style?.maxWidth);

      // 排队第二位不计时：满圈
      fakeNow += 3600;
      clock.advance(40);
      assert(Math.abs(ringLen(1) - C) < 1, '排队条目不计时：环保持满圈', ringLen(1));

      // 队首先推进到剩 4 秒：约半圈
      const head1 = gs.linkSkillQueue[0];
      head1.expireAtMs = fakeNow + WINDOW_MS / 2;
      clock.advance(40);
      const half = ringLen(0);
      assert(half > C * 0.45 && half < C * 0.55,
        `队首环按剩余时间递减（剩 4s ≈ 半圈，实测 ${half.toFixed(1)}/${C.toFixed(1)}）`, half);

      // 再过一帧（40ms）：只少一小段，证明逐帧推进而非 200ms 跳一格
      fakeNow += 40;
      clock.advance(40);
      const smooth = half - ringLen(0);
      assert(smooth > 0.5 && smooth < C * 0.02,
        '环随渲染帧平滑推进（单帧约减 0.5% 圈）', smooth);

      // 窗口耗尽：环归零 → 逻辑出队、后续前移
      fakeNow = head1.expireAtMs + 10;
      linkSkillUI._updateRings();
      assert(ringLen(0) < 0.1, '队首 8 秒耗尽时环转满一圈归空', ringLen(0));
      LinkSkillSystem.pruneExpired(gs);
      assert(gs.linkSkillQueue.length === 1 && gs.linkSkillQueue[0].skillId === 'skill_link_luyouyou_rise_wind',
        '环归空 → 该窗口出队、后续连携前移', gs.linkSkillQueue.map((e) => e.skillId));
      assert(linkSkillUI._rings.length === 1 && Math.abs(ringLen(0) - C) < 1,
        '前移后的新队首重新从满圈开始计时', { count: linkSkillUI._rings.length, len: ringLen(0) });

      // 最后一个窗口也耗尽 → 连携区隐藏
      const head2 = gs.linkSkillQueue[0];
      fakeNow = head2.expireAtMs + 10;
      linkSkillUI._updateRings();
      LinkSkillSystem.pruneExpired(gs);
      assert(gs.linkSkillQueue.length === 0 && linkSkillUI.visible === false
        && linkSkillUI.root.style.display === 'none',
        '所有窗口耗尽后连携区隐藏（窗口消失）',
        { q: gs.linkSkillQueue.length, visible: linkSkillUI.visible });
    } finally {
      Date.now = realDateNow;
      gs.linkSkillQueue = [];
      linkSkillUI._reRender();
      tR1.contentId = savedR1.id; tR1.contentState = savedR1.st;
      tR2.contentId = savedR2.id; tR2.contentState = savedR2.st;
      delete gs.linkSkillCounters['2|skill_link_yumo_drain'];
      delete gs.linkSkillCounters['3|skill_link_luyouyou_rise_wind'];
      delete gs.linkSkillCooldowns['2|skill_link_yumo_drain'];
      delete gs.linkSkillCooldowns['3|skill_link_luyouyou_rise_wind'];
      gs.team.groups[0].roles = savedRolesRing;
    }
  }

  // ── M-10：出货箱显示条目实际价值（郁金香随机价） ──
  const outboxBackup = gs.inventory.outbox;
  gs.inventory.outbox = [{ itemId: 'facility_tulip', qty: 1, value: 7 }];
  EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'inventory' });
  assert(hasText(inventoryPanel.outboxGridEl, '🪙7'), 'M-10：出货箱显示条目实际价值（郁金香 7）');
  EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'inventory' });
  gs.inventory.outbox = outboxBackup;

  // ── L-01：无残留 Phase 文案（玉米受祝福占位 toast 已移除） ──
  const toastsW2 = [];
  const onToastW2 = (p) => toastsW2.push(String(p.text || ''));
  EventBus.on(GE.TOAST_SHOW, onToastW2);
  HookDispatcher.fire('onBlessed', { gs, tileIdx: cornTile.idx });
  assert(!toastsW2.some((t) => t.includes('Phase')), 'L-01：玉米受祝福无残留 Phase 文案');
  EventBus.off(GE.TOAST_SHOW, onToastW2);
}

// ════════════════════════════════════════════════════════════
head_('第 14 批：信息区不阻塞快捷键（§16.4）+ 魔法商店先选项后进店（§11.2 / §16.22）');
{
  const { DialogBox } = await import('../src/ui/DialogBox.js');
  const { HookDispatcher } = await import('../src/core/HookDispatcher.js');

  // 干净起点
  for (const p of ['info', 'inventory', 'role', 'team', 'forge', 'vehicle', 'task', 'codex', 'shop', 'settings']) {
    EventBus.emit(GE.UI_PANEL_CLOSE, { panel: p });
  }
  if (gs.buildMode) BuildSystem.exitBuildMode(gs);
  // 前序用例的 DialogBox 实例仍订阅 DIALOG_SHOW，可能残留 visible → 全部关闭后再测
  hideAllDialogs();
  assert(director.openPanels.length === 0, '前置：面板栈为空', director.openPanels);

  // ── 信息区打开时：WASD / 1~0 / 空格 / Tab 全部可用 ──
  infoPanel.selectTile(2);
  assert(infoPanel.visible && director.openPanels.includes('info'), '前置：信息区已打开（栈含 info）', director.openPanels);
  inputManager.bind();

  gs.uiState.lastMoveAt = 0;
  gs.player.x = 0;
  const x0 = gs.player.x;
  window.dispatchEvent({ type: 'keydown', key: 'd', preventDefault() {} });
  assert(gs.player.x !== x0, 'T1-1：信息区打开时 WASD 可移动', { x0, x1: gs.player.x });
  assert(infoPanel.visible, 'T1-2：移动后信息区仍显示（未被误关）');

  let selT1 = null;
  const onSelT1 = (p) => { selT1 = p; };
  EventBus.on(GE.HOTBAR_SELECT_SLOT, onSelT1);
  window.dispatchEvent({ type: 'keydown', key: '1', preventDefault() {} });
  EventBus.off(GE.HOTBAR_SELECT_SLOT, onSelT1);
  assert(selT1 && selT1.slotIdx === 0, 'T1-3：信息区打开时数字键 1 可选中快捷栏', selT1);

  gs.player.stamina = 8;
  gs.player.gold = 10;
  gs.uiState.blessing = false;
  const stamina0 = gs.player.stamina;
  window.dispatchEvent({ type: 'keydown', key: ' ', preventDefault() {} });
  assert(gs.player.stamina < stamina0 && gs.uiState.blessing === true,
    'T1-4：信息区打开时空格可祈福（扣行动力并进入祈福演出）', { stamina0, now: gs.player.stamina });
  gs.uiState.blessing = false; // 清理（本脚本未挂 BlessAnimation，不会自动 commit）

  window.dispatchEvent({ type: 'keydown', key: 'tab', preventDefault() {} });
  assert(gs.buildMode === true, 'T1-5：信息区打开时 Tab 可进入建造模式');
  BuildSystem.exitBuildMode(gs);

  // ── ESC：只关信息区，不打开设置 ──
  infoPanel.selectTile(2);
  assert(director.openPanels.includes('info'), '前置：ESC 测试前信息区在栈中');
  window.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {} });
  assert(infoPanel.visible === false && settingsPanel.visible === false && director.openPanels.length === 0,
    'T1-6：ESC 只关闭信息区，不打开设置', { stack: director.openPanels });

  // ── 封锁未放松：真模态（背包 / 剧情事件）仍禁止移动 ──
  EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'inventory' });
  gs.uiState.lastMoveAt = 0;
  const xb = gs.player.x;
  window.dispatchEvent({ type: 'keydown', key: 'd', preventDefault() {} });
  assert(gs.player.x === xb, 'T1-7：背包（真模态）打开时 WASD 仍被封锁');
  EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'inventory' });

  const dlgT1 = trackDlg(new DialogBox());
  dlgT1.mount();
  const prevDlgT1 = director.dialogBox;
  director.dialogBox = dlgT1;
  dlgT1.show({ title: '封锁校验', options: [{ label: '好', onSelect: () => {} }] });
  const xd = gs.player.x;
  window.dispatchEvent({ type: 'keydown', key: 'd', preventDefault() {} });
  assert(gs.player.x === xd, 'T1-8：剧情/事件弹窗期间 WASD 仍被封锁');
  dlgT1.hide();
  director.dialogBox = prevDlgT1;
  inputManager.unbind();

  // ── 魔法商店：踩格不自动进店，信息区「进入魔法商店」点击进入 ──
  const magicTile = gs.map.outerTiles[5];
  magicTile.contentId = 'resource_magic_shop';
  magicTile.contentState = {};
  magicTile.dailyFlags = {};
  magicTile.states = [];
  HookDispatcher.fire('onEnter', { gs, tileIdx: magicTile.idx });
  assert(shopPanel.visible === false, 'T2-1：踩魔法商店格不自动打开商店（与普通商店一致）');

  gs.player.x = magicTile.idx;
  infoPanel.selectTile(magicTile.idx);
  const magicBtns = buttonsWithText(infoPanel.root, '进入魔法商店');
  assert(magicBtns.length === 1, 'T2-2：信息区地块内容 tab 有「进入魔法商店」功能选项');
  magicBtns[0].click();
  assert(shopPanel.visible === true && shopPanel.kind === 'magic',
    'T2-3：点击功能选项后才打开魔法商店', { visible: shopPanel.visible, kind: shopPanel.kind });

  EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'shop' });
  assert(shopPanel.visible === false && !director.openPanels.includes('shop'), 'T2-4：关闭后栈内无魔法商店残留');

  // 同回合再点：提示清晰 + 不残留栈条目
  const toastsT2 = [];
  const onToastT2 = (p) => toastsT2.push(String(p.text || ''));
  EventBus.on(GE.TOAST_SHOW, onToastT2);
  infoPanel.selectTile(magicTile.idx);
  buttonsWithText(infoPanel.root, '进入魔法商店')[0].click();
  await new Promise((r) => setTimeout(r, 0));
  EventBus.off(GE.TOAST_SHOW, onToastT2);
  assert(shopPanel.visible === false, 'T2-5：本回合已进过 → 不再打开商店面板');
  assert(toastsT2.some((t) => t.includes('本回合已离开')), 'T2-6：无法进入时有清晰提示', toastsT2);
  assert(!director.openPanels.includes('shop') && director.openPanels.length === 0,
    'T2-7：进入失败不残留面板栈条目（输入不锁死）', director.openPanels);
}

// ════════════════════════════════════════════════════════════
head_('第 15 批：同键二次按下 = ESC（专属快捷键页面）');
{
  const { DialogBox } = await import('../src/ui/DialogBox.js');

  // 干净起点
  for (const p of ['info', 'inventory', 'role', 'team', 'forge', 'vehicle', 'task', 'codex', 'shop', 'settings']) {
    EventBus.emit(GE.UI_PANEL_CLOSE, { panel: p });
  }
  if (gs.buildMode) BuildSystem.exitBuildMode(gs);
  hideAllDialogs();
  assert(director.openPanels.length === 0, '前置：面板栈为空', director.openPanels);

  const shortcutPanels = [
    ['b', 'inventory', () => inventoryPanel.visible],
    ['c', 'role', () => rolePanel.helper.visible],
    ['l', 'team', () => teamPanel.helper.visible],
    ['f', 'forge', () => forgePanel.helper.visible],
    ['t', 'vehicle', () => vehiclePanel.helper.visible],
    ['j', 'task', () => taskPanel.helper.visible],
    ['k', 'codex', () => codexPanel.helper.visible],
  ];
  const key = (k) => window.dispatchEvent({ type: 'keydown', key: k, preventDefault() {} });

  inputManager.bind();
  // ── 每个有专属键的页面：开 → 同键 → 关 ──
  for (const [k, panelKey, isVisible] of shortcutPanels) {
    key(k);
    assert(isVisible() && director.openPanels.includes(panelKey),
      `K-${panelKey}-1：按 ${k.toUpperCase()} 打开 ${panelKey}`, director.openPanels);
    key(k);
    assert(!isVisible() && !director.openPanels.includes(panelKey),
      `K-${panelKey}-2：再按 ${k.toUpperCase()} 关闭 ${panelKey}（等同 ESC）`, director.openPanels);
  }

  // ── 跨面板：不误关下层，只按栈顶判断 ──
  key('b');
  assert(inventoryPanel.visible && director.openPanels.includes('inventory'), '跨-1 背包已打开');
  key('c');
  assert(rolePanel.helper.visible && !inventoryPanel.visible && !director.openPanels.includes('inventory'),
    '跨-2 背包开着按 C → 正常切换到角色页（背包被中央关闭，不误判为同键）', director.openPanels);
  key('b');
  assert(inventoryPanel.visible && !rolePanel.helper.visible
    && director.openPanels[director.openPanels.length - 1] === 'inventory',
    '跨-3 角色页按 B → 切回背包而非误关角色', director.openPanels);
  key('b');
  assert(!inventoryPanel.visible && director.openPanels.length === 0, '跨-4 背包为栈顶时再按 B 才关闭');

  // ── 剧情 / 事件期间仍被拦 ──
  const dlgK = trackDlg(new DialogBox());
  dlgK.mount();
  const prevDlgK = director.dialogBox;
  director.dialogBox = dlgK;
  dlgK.show({ title: '剧情封锁', options: [{ label: '继续', onSelect: () => {} }] });
  key('b');
  assert(!inventoryPanel.visible && director.openPanels.length === 0 &&
    !director.openPanels.includes('inventory'), '门控-1 剧情/事件期间按 B 被拦截', director.openPanels);
  dlgK.hide();
  director.dialogBox = prevDlgK;

  // ── 建造模式：不误触发同键关闭 ──
  BuildSystem.enterBuildMode(gs);
  key('b');
  assert(inventoryPanel.visible && gs.buildMode === false,
    '门控-2 建造模式按 B 正常打开背包（退出建造，不误判为关闭）', { buildMode: gs.buildMode });
  key('b');
  assert(!inventoryPanel.visible && director.openPanels.length === 0,
    '门控-3 再按 B 关闭背包（同键关闭在探索模式生效）', director.openPanels);
  inputManager.unbind();
}

// ════════════════════════════════════════════════════════════
console.log(`\nsmoke-ui 结果：${pass} 通过 / ${fail} 失败（共 ${pass + fail}）`);
process.exit(fail > 0 ? 1 : 0);
