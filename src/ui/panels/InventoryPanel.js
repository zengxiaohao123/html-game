// src/ui/panels/InventoryPanel.js
// Phase 2B 最终版 v2（按 ui-inventory.png 排版 v2）
//   ▸ 面板：居中 92vw × 86vh，四周留一点背景可见；内容不会撑大
//   ▸ 顶部：8 tab 横排
//   ▸ 左：  大网格（emoji + 右下 qty + 固定空槽渲染）
//   ▸ 右上：详情卡（大 emoji + 名称 + 单价/总价值两行图标化 + 简短描述）
//   ▸ 右中：行动区（固定存在，点物品才激活；min/-1/+1/max 四按钮 + 确认/取消）
//   ▸ 右下：出货箱 2×6 共 12 格（固定渲染，空格也画）
//   ▸ 交互：左键点物品（背包 or 出货箱）→ 右上行动区激活选数量（min/-1/+1/max）→ 确认
//
// 订阅：GE.INVENTORY_CHANGE / GE.STATE_RESET / GE.UI_PANEL_OPEN/ CLOSE('inventory')

import { EventBus } from '../../core/EventBus.js';
import { GE } from '../../core/GameEvents.js';
import { Assets } from '../../core/Assets.js';
import { ITEMS } from '../../data/items.js';
import { SKILLS } from '../../data/characters.js';
import { getDef as getFacilityDef } from '../../data/facilities.js';
import { InventorySystem } from '../../systems/InventorySystem.js';
import { OUTBOX_SLOTS } from '../../utils/constants.js';
import { createEl, qs } from '../dom.js';

/** 8 个 tab 定义 —— 以 task-briefs §9 为准，示意图只参考排版不参考文字 */
const TABS = [
  { id: 'all',      label: '总览',  match: () => true },
  { id: 'facility', label: '设施',  match: id => id.startsWith('facility_') },
  { id: 'resource', label: '资源',  match: id => id.startsWith('resource_') },
  { id: 'skill',    label: '技能',  match: id => id.startsWith('skill_') },
  { id: 'terrain',  label: '地形',  match: id => id.startsWith('terrain_') },
  { id: 'item',     label: '产物',  match: id => id.startsWith('item_') },
  { id: 'consum',   label: '道具',  match: id => ['collectible_','grimoire_','potion_'].some(p => id.startsWith(p)) },
  { id: 'misc',     label: '杂物',  match: id => !(
    id.startsWith('facility_') || id.startsWith('resource_') ||
    id.startsWith('item_') || id.startsWith('skill_') ||
    id.startsWith('terrain_') || ['collectible_','grimoire_','potion_'].some(p => id.startsWith(p))
  )},
];

/** 简短描述字典（UI 用） */
const DESCRIPTIONS = {
  facility_home:      '唯一且永恒，不可被替换。经过/进入获得金币，睡觉时行动力回满。',
  facility_tent:      '可被替换，替换时原内容自动回背包。',
  facility_wheat:     '最基础的农作物。每日产出小麦，草地相邻加成。',
  facility_rice:      '每日产出稻草，草地/水面相邻有额外加成。',
  facility_potato:    '每日自动储存土豆，进入时一次性取走。',
  facility_tulip:     '每日价值随机波动，运气成分较重。',
  facility_strawberry:'经过时储存草莓，积累满后一次性取走。',
  facility_pea:       '使用技能时自动储存豌豆，积累满后取走。',
  facility_henhouse:  '鸡舍：后续 Phase 接入生物系统。',
  facility_slimehouse:'史莱姆屋：后续 Phase 接入生物系统。',
  resource_event:     '🎲 触发随机事件（Phase 5）。',
  resource_reward:    '🎁 随机奖励（Phase 5）。',
  resource_hunt:      '🏹 狩猎点（Phase 3）。',
  resource_shop:      '🛒 商店（Phase 4）。',
  resource_bus:       '🚌 行动力 +1、获得轮子。',
  item_wheat:         '最基础的农作物，可以喂鸡，也可以卖金币。',
  item_rice_straw:    '稻田产出的稻草。',
  item_potato:        '土豆。',
  item_strawberry:    '草莓。',
  item_pea:           '豌豆。',
  item_egg:           '鸡蛋。',
  item_raw_meat:      '生肉。',
  item_slime_gel:     '史莱姆胶。',
  item_wheel:         '轮子。',
};

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
    // 全屏遮罩（黑色半透明，盖除了 TopBar 外的所有东西）
    this.mask = createEl('div', {
      class: ['panel-mask', 'inventory-mask'],
      parent,
      onclick: (e) => { if (e.target === this.mask) this.hide(); },
    });

    this.panel = createEl('div', {
      class: ['panel-card', 'inventory-panel'],
      parent: this.mask,
    });

    // Header
    const header = createEl('div', { class: 'inventory-header', parent: this.panel });
    createEl('div', { class: 'inventory-title', text: '🎒 背包（B 切换）', parent: header });
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
    const rightTop = createEl('div', { class: 'inv-right-top', parent: rightCol });
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
      if (panel === 'inventory') this.toggle();
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

  toggle() { this.visible ? this.hide() : this.show(); }

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

      const emoji = this._resolveEmoji(entry.itemId);
      const name = this._resolveName(entry.itemId);
      createEl('div', { class: 'inv-big-emoji', text: emoji, parent: slot });
      createEl('div', { class: 'inv-big-qty', text: `×${entry.qty}`, parent: slot });
      slot.title = `${name} ×${entry.qty}`;

      // 拖拽放置（探索/建造模式都有效，长按拖到地图即放置）
      slot.setAttribute('draggable', 'true');
      slot.addEventListener('dragstart', (e) => {
        if (e.dataTransfer) {
          e.dataTransfer.setData('text/plain', entry.itemId);
          e.dataTransfer.effectAllowed = 'move';
        }
        // 背包自动关闭露出地图
        this.hide();
      });

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
    const emoji = this._resolveEmoji(this.selectedItemId);
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
    const desc = DESCRIPTIONS[this.selectedItemId] || '（暂无描述）';

    // ══ 详情左半：上半行（emoji 左 + 价值行整体居右） + 描述 ══
    const topRow = createEl('div', { class: 'inv-detail-toprow', parent: this.detailEl });

    // 左：大 emoji
    createEl('div', { class: 'inv-detail-emoji', text: emoji, parent: topRow });

    // 右：名称 + 价值两行（整组居右）
    const rightCol = createEl('div', { class: 'inv-detail-value-col', parent: topRow });
    createEl('div', { class: 'inv-detail-name', text: name, parent: rightCol });

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

    // 描述（topRow 下方独立一行）
    createEl('div', { class: 'inv-detail-desc', text: desc, parent: this.detailEl });
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

    // ── 建造模式 + 从背包选中 → 渲染"放置到地图"按钮，替代 slider 链路 ──
    const gs = this._getGS();
    if (gs?.buildMode === true && this.selectedFrom === 'items') {
      // 天赋不可放置
      if (this.selectedItemId.startsWith('talent_')) {
        createEl('div', {
          style: { textAlign: 'center', color: '#c0392b', fontSize: '14px', marginTop: '16px' },
          text: '🚫 天赋不可放置到地图上',
          parent: this.actionEl,
        });
        return;
      }
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

    // ── 原版 slider 行动区（探索模式 / 从出货箱选中） ──
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
        const emoji = this._resolveEmoji(entry.itemId);
        createEl('div', { class: 'inv-big-emoji', text: emoji, parent: slot });
        if (entry.qty > 1) createEl('div', { class: 'inv-big-qty', text: `×${entry.qty}`, parent: slot });

        const ITEM = ITEMS[entry.itemId];
        if (ITEM && typeof ITEM.value === 'number') {
          createEl('div', {
            class: 'inv-outbox-value',
            text: `🪙${ITEM.value}`,
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
