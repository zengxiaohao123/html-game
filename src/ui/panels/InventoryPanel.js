// src/ui/panels/InventoryPanel.js
// 第 5 批 UI 对齐（§16.15 背包页面 + §16.14 背包放置按钮）
//   ▸ 面板：非全屏占大半个屏幕，四周留一点背景可见；内容不会撑大
//   ▸ 顶部：8 tab —— 总览/设施/资源/技能/地形/产物/道具/杂物（总览含全部，其余互斥）
//   ▸ 左：  该分类物品图标格（无文字，iconEl 渲染 + 固定空槽渲染）
//   ▸ 右上：详情卡（图标 + 名称 + 数量 + 单价/总价值 + 描述 + 合成材料）
//   ▸ 右中：行动区（固定存在，点物品才激活；滑块默认 1 + min/-1/+1/max 四按钮 + 确认/取消）
//   ▸ 右下：出货箱 2×6 共 12 格（不同物品各占一格、同物品自动叠放；固定渲染，空格也画）
//   ▸ 交互：左键点物品（背包 or 出货箱）→ 行动区激活选数量 → 确认（背包选中=放入出货箱，出货箱选中=取回）
//   ▸ §16.14：建造模式下背包里可放置物品（地块内容类）有「放置」按钮，点击关背包走 pendingPlaceContentId 流程
//   ▸ UI_PANEL_OPEN('inventory') 幂等显示：已显示只刷新，绝不 toggle 关闭
//
// 订阅：GE.INVENTORY_CHANGE / GE.STATE_RESET / GE.UI_PANEL_OPEN/ CLOSE('inventory') / GE.UI_MODE_CHANGE

import { EventBus } from '../../core/EventBus.js';
import { GE } from '../../core/GameEvents.js';
import { Assets } from '../../core/Assets.js';
import { ITEMS } from '../../data/items.js';
import { SKILLS } from '../../data/characters.js';
import { POTIONS } from '../../data/potions.js';
import { UseItemSystem } from '../../systems/UseItemSystem.js';
import { ItemTargeting } from '../../systems/ItemTargeting.js';
import { getDef as getFacilityDef } from '../../data/facilities.js';
import { InventorySystem } from '../../systems/InventorySystem.js';
import { OUTBOX_SLOTS } from '../../utils/constants.js';
import { getAllRecipes } from '../../data/recipes.js';
import { createEl, qs, iconEl } from '../dom.js';
import { renderTraitBadges } from '../TraitBadges.js';

/** 8 个 tab 定义 —— 以 task-briefs §9 为准，示意图只参考排版不参考文字 */
// 分类以「物品库」的 tier1/tier2 为准，不再靠 id 前缀猜。
// 前缀法会把载具、消耗道具混进「产物」，物品库扩充后会持续失准。
const tier2Is = (t) => (id) => ITEMS[id]?.tier2 === t;
const tier1Is = (t) => (id) => ITEMS[id]?.tier1 === t;
const TABS = [
  { id: 'all',      label: '总览',  match: () => true },
  { id: 'facility', label: '设施',  match: tier2Is('设施') },
  { id: 'resource', label: '资源',  match: tier2Is('资源') },
  { id: 'skill',    label: '技能',  match: tier2Is('技能') },
  { id: 'terrain',  label: '地形',  match: tier1Is('地形') },
  { id: 'item',     label: '产物',  match: tier1Is('产物') },
  { id: 'consum',   label: '道具',  match: tier1Is('道具') },
  { id: 'misc',     label: '杂物',  match: tier1Is('杂物') },
];

export class InventoryPanel {
  constructor(director) {
    this.director = director;
    this.mask = null;
    this.panel = null;
    this.tabBar = null;
    this.tabBtns = [];
    this.listEl = null;          // 左：背包大网格（固定宽高）
    this.detailEl = null;        // 右上：详情卡（固定宽高）
    this.actionEl = null;        // 右中：行动区（固定存在，点物品才激活）
    this.outboxGridEl = null;    // 右下：出货箱 12 格（固定宽高）
    this.actionQtyLabel = null;  // 行动区当前数量显示 DOM（缓存，render 时复用）
    this.selectedTabIdx = 0;
    this.selectedItemId = null;  // 当前选中 itemId
    this.selectedFrom = null;    // 'items' | 'outbox'
    this.currentQty = 1;         // 行动区当前数量
    this.maxQty = 1;             // 行动区数量上限
    this.visible = false;
  }

  // ─────────────────────── 构建 DOM（固定布局，内容不会撑大） ───────────────────────
  mount(parent = qs('body')) {
    // 全屏遮罩（黑色半透明）：层级 6000，高于左上角 HUD / 容量条（80）与商店（5500）；
    // 低于设置（6200）/ 连接技能（6500）/ 剧情对话框（9000）。
    this.mask = createEl('div', {
      class: ['panel-mask', 'inventory-mask'],
      style: { zIndex: 6000 },
      parent,
      onclick: (e) => { if (e.target === this.mask) this.hide(); },
    });

    this.panel = createEl('div', {
      class: ['panel-card', 'inventory-panel'],
      parent: this.mask,
    });

    // Header
    const header = createEl('div', { class: 'inventory-header', parent: this.panel });
    createEl('div', { class: 'inventory-title', text: '🎒 背包（B）', parent: header });
    createEl('button', {
      class: 'inventory-close', text: '✖', parent: header,
      onclick: () => this.hide(),
    });

    // 主 body：左列（tabBar + 背包网格） / 右列（详情卡 + 行动区 + 出货箱）
    const body = createEl('div', { class: 'inv-body', parent: this.panel });
    const leftCol = createEl('div', { class: 'inv-left', parent: body });
    const rightCol = createEl('div', { class: 'inv-right', parent: body });

    // Tab bar —— 隶属于左侧部分（不是横跨整个面板顶部）
    const tabBarWrap = createEl('div', { class: 'inv-left-top', parent: leftCol });
    this.tabBar = createEl('div', { class: 'tab-bar', parent: tabBarWrap });
    TABS.forEach((t, i) => {
      this.tabBtns.push(createEl('button', {
        class: ['tab-btn', i === 0 ? 'active' : ''],
        text: t.label, attrs: { 'data-tab': i }, parent: this.tabBar,
        onclick: () => this._switchTab(i),
      }));
    });

    // 左：tab bar 下方是背包大网格
    this.listEl = createEl('div', { class: 'inv-grid-wrap', parent: leftCol });

    // 右：上半（融为一体，内部左右分栏）+ 下半（出货箱）
    // 内联抬高右上区（详情新增数量/合成材料行，200px 不够）
    const rightTop = createEl('div', { class: 'inv-right-top', style: { flex: '0 0 252px' }, parent: rightCol });
    this.detailEl = createEl('div', { class: 'inv-right-top-left', parent: rightTop });
    this.actionEl = createEl('div', { class: 'inv-right-top-right', parent: rightTop });

    // 右下：出货箱 —— 标题木条 + 木框 + 格子
    const outboxWrap = createEl('div', { class: 'inv-outbox-wrap', parent: rightCol });
    createEl('div', { class: 'inv-outbox-title', text: '📦 出货箱', parent: outboxWrap });
    const outboxFrame = createEl('div', { class: 'inv-outbox-frame', parent: outboxWrap });
    this.outboxGridEl = createEl('div', { class: 'outbox-grid', parent: outboxFrame });

    this._subscribeEvents();
    this.mask.style.display = 'none';
  }

  // ─────────────────────── 事件订阅 ───────────────────────
  _subscribeEvents() {
    EventBus.on(GE.INVENTORY_CHANGE, () => this.visible && this._reRender());
    EventBus.on(GE.STATE_RESET, () => this.visible && this._reRender());
    EventBus.on(GE.UI_PANEL_OPEN, ({ panel }) => {
      if (panel === 'settings' && this.visible) this.hide();
      // 幂等显示：已显示只刷新内容，绝不 toggle 关闭（开新面板关旧面板由 GameDirector 中央处理）
      if (panel === 'inventory') {
        if (this.visible) this._reRender();
        else this.show();
      }
    });
    EventBus.on(GE.UI_PANEL_CLOSE, ({ panel }) => {
      if (panel === 'inventory' && this.visible) this.hide();
    });
    // Tab 切换探索/建造模式时实时刷新（物品"放入出货箱/放置"两种行为依赖当前模式）
    EventBus.on(GE.UI_MODE_CHANGE, () => this.visible && this._reRender());
  }

  // ─────────────────────── 开关 ───────────────────────
  show() {
    if (!this.mask || this.visible) return;
    this.visible = true;
    this.mask.style.display = 'flex';
    this.mask.classList.add('visible');
    const gs = this._getGS();
    if (gs) { gs.uiState = gs.uiState || {}; gs.uiState.activePanel = 'inventory'; }
    this.selectedItemId = null;
    this.selectedFrom = null;
    this.currentQty = 1;
    this.maxQty = 1;
    this._reRender();
  }

  hide() {
    if (!this.mask || !this.visible) return;
    this.visible = false;
    this.mask.classList.remove('visible');
    this.mask.style.display = 'none';
    const gs = this._getGS();
    if (gs && gs.uiState && gs.uiState.activePanel === 'inventory') gs.uiState.activePanel = null;
    EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'inventory' });
  }

  _switchTab(idx) {
    if (idx < 0 || idx >= TABS.length) return;
    this.selectedTabIdx = idx;
    this.tabBtns.forEach((b, i) => i === idx ? b.classList.add('active') : b.classList.remove('active'));
    this.selectedItemId = null;
    this.selectedFrom = null;
    this.currentQty = 1;
    this.maxQty = 1;
    this._reRender();
  }

  _reRender() {
    this._renderList();
    this._renderDetail();
    this._renderActionZone();
    this._renderOutbox();
  }

  // ─────────────────────── 左：背包大网格（固定高度，空槽也渲染） ───────────────────────
  _renderList() {
    this.listEl.innerHTML = '';
    const gs = this._getGS();
    if (!gs) return;

    const tabDef = TABS[this.selectedTabIdx];
    if (tabDef.phaseReady === false) {
      createEl('div', {
        style: { padding: '60px 20px', textAlign: 'center', color: '#b0a090', fontSize: '14px' },
        text: '✨ 该分类将在后续阶段开放 ✨',
        parent: this.listEl,
      });
      return;
    }

    const list = (gs.inventory?.items || []).filter(e => tabDef.match(e.itemId));

    const grid = createEl('div', { class: 'inv-big-grid', parent: this.listEl });
    if (list.length === 0) {
      // 即使没物品，也渲染几行空槽保持固定布局（用户要求"固定空间和空白"）
      for (let i = 0; i < 15; i++) {
        const emptySlot = createEl('div', { class: ['inv-big-slot', 'empty'], parent: grid });
        emptySlot.style.visibility = 'hidden'; // 占位但不可见（实际不可点击）
      }
      return;
    }

    for (const entry of list) {
      const slot = createEl('div', {
        class: [
          'inv-big-slot',
          this.selectedItemId === entry.itemId && this.selectedFrom === 'items' ? 'selected' : '',
        ],
        parent: grid,
      });

      const name = this._resolveName(entry.itemId);
      // §16.15：左侧物品图标格，无文字（iconEl 渲染）
      const iconWrap = createEl('div', { class: 'inv-big-emoji', parent: slot });
      iconWrap.appendChild(this._iconElFor(entry.itemId, '38px'));
      // 数量角标：右下角常驻（数量为 1 也显示），pointer-events:none 不影响格子点击
      createEl('div', { class: 'inv-big-qty', text: `×${entry.qty}`, parent: slot });
      slot.title = `${name} ×${entry.qty}`;

      // 拖拽放置（§16.15）：仅地块内容类物品可拖（产物、道具等不触发拖拽）；
      // 拖拽开始时背包自动关闭露出地图，拖到目标地块松开即放置（每次只放 1 个，见 MapView drop → placeContent）
      if (this._isPlaceable(entry.itemId)) {
        slot.setAttribute('draggable', 'true');
        slot.addEventListener('dragstart', (e) => {
          if (e.dataTransfer) {
            e.dataTransfer.setData('text/plain', entry.itemId);
            e.dataTransfer.effectAllowed = 'move';
          }
          // 第 9 批：全局拖拽标记——拖背包格期间 MapView 不得触发拖拽平移
          window.__invDrag = true;
          // 背包自动关闭露出地图。
          // B-01：同步 hide() 会移除拖拽源节点 → 浏览器立即取消 drag（dragend 紧随 dragstart）。
          // 延迟到下一帧再隐藏，保证 drag 会话成立。
          setTimeout(() => this.hide(), 0);
        });
        slot.addEventListener('dragend', () => { window.__invDrag = false; });
      } else {
        // L-06 / §16.15：产物、工具等不可放置物品"不触发拖拽并给出弹窗提示"——
        //   让浏览器发起 drag 手势以便在 dragstart 拦截，随即 preventDefault 取消拖拽并提示。
        slot.setAttribute('draggable', 'true');
        slot.addEventListener('dragstart', (e) => {
          e.preventDefault();
          const def = ITEMS[entry.itemId];
          EventBus.emit(GE.TOAST_SHOW, {
            text: `❌ ${def?.name || entry.itemId} 不可放置到地块`,
            duration: 2000,
          });
        });
      }

      slot.addEventListener('click', (e) => {
        e.stopPropagation();
        this._activateAction('items', entry.itemId, entry.qty);
      });
    }
  }

  // ─────────────────────── 右上：详情卡（固定高度，没选中物品也占位） ───────────────────────
  _renderDetail() {
    this.detailEl.innerHTML = '';

    if (!this.selectedItemId) {
      createEl('div', {
        class: 'inv-detail-empty',
        parent: this.detailEl,
        text: '← 点击左侧 / 右下物品查看详情',
      });
      return;
    }

    const entry = this._findEntry(this.selectedFrom, this.selectedItemId);
    if (!entry) {
      this.selectedItemId = null;
      return this._renderDetail();
    }

    const ITEM = ITEMS[this.selectedItemId];
    const name = this._resolveName(this.selectedItemId);
    // value 查找：entry.value（郁金香动态 value）> ITEMS[].value（静态）> facilities value
    let value = entry.value;
    if (value === undefined || value === null || typeof value !== 'number') {
      value = ITEM?.value;
      if (typeof value !== 'number') {
        const fd = getFacilityDef(this.selectedItemId);
        if (fd && typeof fd.value === 'number') value = fd.value;
      }
    }
    const desc = ITEM?.description || '（暂无描述）';

    // ══ 详情左半：上半行（图标左 + 价值行整体居右） + 描述 ══
    const topRow = createEl('div', { class: 'inv-detail-toprow', parent: this.detailEl });

    // 左：大图标（iconEl 渲染）
    const emojiWrap = createEl('div', { class: 'inv-detail-emoji', parent: topRow });
    emojiWrap.appendChild(this._iconElFor(this.selectedItemId, '46px'));

    // 右：名称 + 数量 + 价值两行（整组居右）
    const rightCol = createEl('div', { class: 'inv-detail-value-col', parent: topRow });
    createEl('div', { class: 'inv-detail-name', text: name, parent: rightCol });
    createEl('div', {
      class: 'inv-value-line',
      parent: rightCol,
      html: `<span class="inv-value-icon">📦</span><span class="inv-value-num">数量 ×${entry.qty}</span>`,
    });

    if (typeof value === 'number') {
      createEl('div', {
        class: 'inv-value-line',
        parent: rightCol,
        html: `<span class="inv-value-icon">🪙</span><span class="inv-value-num">${value}</span>`,
      });
      createEl('div', {
        class: 'inv-value-line',
        parent: rightCol,
        html: `<span class="inv-value-icon">💰</span><span class="inv-value-num">${value * entry.qty}</span>`,
      });
    } else {
      createEl('div', {
        class: 'inv-value-line',
        parent: rightCol,
        html: `<span class="inv-value-icon">🪙</span><span class="inv-value-num">—</span>`,
      });
    }

    // 显性词条：统一徽章入口，不混入描述正文
    renderTraitBadges(this.detailEl, ITEM?.traits);

    // 描述（topRow 下方独立一行；white-space: pre-line 保留数据里的换行）
    createEl('div', { class: 'inv-detail-desc', text: desc, parent: this.detailEl });

    // ── §16.15 右上：合成材料（能合成该物品的配方所需材料）──
    const fromRecipes = getAllRecipes().filter(rc => rc.outputs.some(o => o.itemId === this.selectedItemId));
    createEl('div', {
      style: { fontSize: '11px', fontWeight: '700', color: '#5a4a3a', marginTop: '4px', flexShrink: '0' },
      text: '🧾 合成材料',
      parent: this.detailEl,
    });
    if (fromRecipes.length === 0) {
      createEl('div', { style: { fontSize: '11px', color: '#b0a090', flexShrink: '0' }, text: '—', parent: this.detailEl });
    } else {
      for (const rc of fromRecipes) {
        const row = createEl('div', {
          style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px', fontSize: '11px', color: '#4a3a2a', flexShrink: '0' },
          parent: this.detailEl,
        });
        rc.ingredients.forEach((inp, i) => {
          if (i > 0) createEl('span', { text: '+', parent: row });
          row.appendChild(this._iconElFor(inp.itemId, '14px'));
          createEl('span', { text: `${this._resolveName(inp.itemId)}×${inp.qty}`, parent: row });
        });
      }
    }

    // ── 消耗道具：使用 / 指向使用（v0.5 §14.1 使用型 / 放置型）──
    const potion = POTIONS[this.selectedItemId];
    if (potion?.useEffect) {
      const needTarget = ItemTargeting.needsTarget(this.selectedItemId);
      const isPlaced = potion.useEffect.type.startsWith('placed_');
      const label = needTarget
        ? (isPlaced ? `📦 选择地块放置（${potion.name}）` : `🎯 选择地块使用（${potion.name}）`)
        : `✅ 使用 ${potion.name}`;
      const btn = createEl('button', {
        class: ['action-btn'],
        style: {
          marginTop: '8px', width: '100%', fontSize: '13px',
          background: needTarget ? '#fff3d0' : '#e8ffe8',
          border: needTarget ? '2px solid #d9a441' : undefined,
        },
        text: label,
        parent: this.detailEl,
      });
      btn.onclick = () => {
        const gs = this.director.getGS();
        if (needTarget) {
          // 需要指定地块：先关背包，回到地图点选（ESC 可取消）
          this.hide();
          ItemTargeting.start(gs, this.selectedItemId);
          return;
        }
        const res = UseItemSystem.useItem(gs, this.selectedItemId, { tileIdx: gs.player.x });
        if (res.ok) this._reRender();
      };
    }
  }

  // ─────────────────────── 右中：行动区（固定存在，点物品才激活） ───────────────────────
  _renderActionZone() {
    this.actionEl.innerHTML = '';

    if (!this.selectedItemId) {
      createEl('div', {
        class: 'inv-action-empty',
        parent: this.actionEl,
        text: '（未选中物品）',
      });
      return;
    }

    const entry = this._findEntry(this.selectedFrom, this.selectedItemId);
    if (!entry) {
      this.selectedItemId = null;
      return this._renderActionZone();
    }

    const label = this.selectedFrom === 'items' ? '放入出货箱' : '取回背包';

    // ── §16.14：建造模式 + 从背包选中可放置物品（地块内容类）→「放置」按钮，替代 slider 链路 ──
    // 可放置判定对齐 BuildSystem.placeContent：facility_ / resource_ / skill_ / terrain_（地形走 placeTerrain 通道）
    const gs = this._getGS();
    if (gs?.buildMode === true && this.selectedFrom === 'items' && this._isPlaceable(this.selectedItemId)) {
      createEl('button', {
        class: 'action-btn',
        style: { display: 'block', width: '100%', marginTop: '12px', background: '#ffe099', color: '#5a4a3a', fontSize: '15px' },
        text: '🛠️ 放置到地图（点地块）',
        parent: this.actionEl,
        onclick: () => {
          if (!gs.uiState) gs.uiState = {};
          gs.uiState.pendingPlaceContentId = this.selectedItemId;
          EventBus.emit(GE.TOAST_SHOW, { text: '🖱️ 请点外圈地块放置…', duration: 2500 });
          this.hide();
        },
      });
      return; // 跳过原版 slider 链路
    }

    // ── slider 行动区（探索模式 / 从出货箱选中 / 建造模式选中不可放置物品） ──
    // 当前数量显示（大数字，slider 实时联动）
    this.actionQtyLabel = createEl('div', {
      class: 'inv-action-qty',
      parent: this.actionEl,
      text: String(this.currentQty),
    });

    // Slider（range）：1 到 maxQty，实时绑定到 actionQtyLabel + 金色填充
    const slider = createEl('input', {
      attrs: { type: 'range', min: 1, max: this.maxQty, value: this.currentQty },
      class: 'inv-action-slider',
      parent: this.actionEl,
    });
    const pct = (v) => ((Number(v) - 1) / (this.maxQty - 1)) * 100;
    slider.style.setProperty('--slider-percent', pct(this.currentQty) + '%');
    slider.addEventListener('input', () => {
      const v = Number(slider.value);
      this.currentQty = v;
      if (this.actionQtyLabel) this.actionQtyLabel.textContent = String(v);
      slider.style.setProperty('--slider-percent', pct(v) + '%');
    });

    // 4 个数量调整按钮：min / -1 / +1 / max（调完同步 slider）
    const btnRow = createEl('div', { class: 'inv-action-btns', parent: this.actionEl });
    const mkBtn = (text, vFn) => createEl('button', {
      class: 'inv-step-btn', text, parent: btnRow,
      onclick: () => {
        const v = vFn();
        this._setQty(v);
        // 同步 slider + 金色填充
        slider.value = this.currentQty;
        slider.style.setProperty('--slider-percent', pct(this.currentQty) + '%');
      },
    });
    mkBtn('min', () => 1);
    mkBtn('-1', () => Math.max(1, this.currentQty - 1));
    mkBtn('+1', () => Math.min(this.maxQty, this.currentQty + 1));
    mkBtn('max', () => this.maxQty);

    // 操作按钮行
    const actionRow = createEl('div', { class: 'inv-action-confirm', parent: this.actionEl });
    createEl('button', {
      class: ['action-btn', 'cancel'],
      text: '❌ 取消',
      parent: actionRow,
      onclick: () => {
        this.selectedItemId = null;
        this.selectedFrom = null;
        this.currentQty = 1;
        this.maxQty = 1;
        this._reRender();
      },
    });
    createEl('button', {
      class: 'action-btn',
      text: `✅ ${label}`,
      parent: actionRow,
      onclick: () => {
        const gs = this._getGS();
        if (!gs) return;
        InventorySystem.moveItemBetween(
          gs,
          this.selectedFrom,
          this.selectedFrom === 'items' ? 'outbox' : 'items',
          this.selectedItemId,
          this.currentQty,
        );
        // 清空选中状态，让 UI 回到"未选中"
        this.selectedItemId = null;
        this.selectedFrom = null;
        this.currentQty = 1;
        this.maxQty = 1;
        this._reRender();
      },
    });
  }

  /** 行动区按钮点击：更新数量显示 */
  _setQty(v) {
    if (!Number.isFinite(v) || v < 1) v = 1;
    if (v > this.maxQty) v = this.maxQty;
    this.currentQty = v;
    // 只更新 label 文字，不重渲染整个面板（避免行动区交互闪烁）
    if (this.actionQtyLabel) this.actionQtyLabel.textContent = String(v);
  }

  /** 点物品激活行动区（只更新 selected 状态 + 重渲染详情/行动） */
  _activateAction(from, itemId, maxQty) {
    this.selectedItemId = itemId;
    this.selectedFrom = from;
    this.maxQty = maxQty;
    this.currentQty = 1; // 默认从 1 开始（每次选物品默认只搬 1 个，玩家再调整）
    this._reRender();
  }

  // ─────────────────────── 右下：出货箱 12 格（固定，空格也画） ───────────────────────
  _renderOutbox() {
    this.outboxGridEl.innerHTML = '';
    const gs = this._getGS();
    const outbox = gs?.inventory?.outbox || [];

    for (let i = 0; i < OUTBOX_SLOTS; i++) {
      const entry = outbox[i];
      const slot = createEl('div', {
        class: ['inv-outbox-slot', entry ? '' : 'empty'],
        parent: this.outboxGridEl,
      });

      if (entry) {
        const iconWrap = createEl('div', { class: 'inv-big-emoji', parent: slot });
        iconWrap.appendChild(this._iconElFor(entry.itemId, '22px'));
        if (entry.qty > 1) createEl('div', { class: 'inv-big-qty', text: `×${entry.qty}`, parent: slot });

        // M-10：优先显示条目实际价值（如郁金香每日随机价），回退物品库静态价值
        const ITEM = ITEMS[entry.itemId];
        const val = (typeof entry.value === 'number')
          ? entry.value
          : (ITEM && typeof ITEM.value === 'number' ? ITEM.value : null);
        if (val !== null) {
          createEl('div', {
            class: 'inv-outbox-value',
            text: `🪙${val}`,
            parent: slot,
          });
        }

        slot.addEventListener('click', (e) => {
          e.stopPropagation();
          this._activateAction('outbox', entry.itemId, entry.qty);
        });
      } else {
        createEl('div', {
          style: { fontSize: '16px', color: '#b0a090' },
          text: '—',
          parent: slot,
        });
      }
    }
  }

  // ─────────────────────── 工具 ───────────────────────
  _findEntry(from, itemId) {
    const gs = this._getGS();
    if (!gs) return null;
    const list = from === 'outbox'
      ? (gs.inventory?.outbox || [])
      : (gs.inventory?.items || []);
    return list.find(e => e && e.itemId === itemId);
  }

  _getGS() {
    if (this.director?.getGS) return this.director.getGS();
    if (window.__gameDirector?.getGS) return window.__gameDirector.getGS();
    return null;
  }

  /** §16.14 可放置判定（对齐 BuildSystem.placeContent 的前缀校验） */
  _isPlaceable(itemId) {
    return /^(facility_|resource_|skill_|terrain_)/.test(itemId || '');
  }

  /** 物品图标（iconEl）：group 按物品库 tier1/tier2 归类，原 emoji 作回退 */
  _iconElFor(itemId, size) {
    const d = ITEMS[itemId];
    const group = d?.tier2 === '设施' ? 'facilities'
      : d?.tier2 === '资源' ? 'resources'
      : d?.tier1 === '地形' ? 'terrains'
      : 'items';
    return iconEl(group, itemId, { size, def: d || undefined, fallback: this._resolveEmoji(itemId) });
  }

  _resolveEmoji(itemId) {
    if (!itemId) return '❓';
    // 郁金香等带动态 value 的产物：直接查 ITEMS
    const d = ITEMS[itemId];
    if (d?.emoji) return d.emoji;
    // 设施（facility_*） / 资源（resource_*）
    const facilityEmoji = Assets.getEmoji('facilities', itemId);
    if (facilityEmoji !== '❓') return facilityEmoji;
    const resourceEmoji = Assets.getEmoji('resources', itemId);
    if (resourceEmoji !== '❓') return resourceEmoji;
    // 技能卡（skill_*）：从 SKILLS 数组查
    if (itemId.startsWith('skill_')) {
      const skill = SKILLS?.[itemId];
      if (skill?.emoji) return skill.emoji;
    }
    // items 兜底
    return Assets.getEmoji('items', itemId) || '❓';
  }

  _resolveName(itemId) {
    if (!itemId) return '未知';
    const d = ITEMS[itemId];
    if (d?.name) return d.name;
    // 优先从 facilities.js 读设施/资源名（单一数据源，避免硬编码漂移）
    const fd = getFacilityDef(itemId);
    if (fd?.name) return fd.name;
    return itemId;
  }
}

export default InventoryPanel;
