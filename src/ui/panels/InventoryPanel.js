// src/ui/panels/InventoryPanel.js
// Phase 2B 背包面板：B 键打开 / ESC / B / 遮罩关闭
//   - 左上 tab 切换（8 tab）
//   - 左中物品列表（emoji 为主，右下数量小字）
//   - 右下出货箱 2×6 网格（12 格）
//   - 点击背包物品 → 弹出"放入出货箱"按钮 → InventorySystem.addToOutbox
//   - 点击出货箱格子 → InventorySystem.moveItemBetween 取回
//   - 出货箱满 12 种时 InventorySystem 内部会 Toast，UI 不用重复
//
// 订阅来源：GE.INVENTORY_CHANGE / GE.STATE_RESET / GE.UI_PANEL_OPEN(关闭互斥)
// 设计文档 §9 分类规则：
//   Tab 0 总览（flat list）
//   Tab 1 设施（facility_* 开头）
//   Tab 2 资源（resource_* 开头）
//   Tab 3 技能（skill_*，Phase 3 才创建，静态空）
//   Tab 4 地形（terrains 类，Phase 3，静态空）
//   Tab 5 产物（ITEMS 表，item_* 开头）
//   Tab 6 道具（消耗品，Phase 3，静态空）
//   Tab 7 杂物（其他）

import { EventBus } from '../../core/EventBus.js';
import { GE } from '../../core/GameEvents.js';
import { Assets } from '../../core/Assets.js';
import { ITEMS } from '../../data/items.js';
import { InventorySystem } from '../../systems/InventorySystem.js';
import { OUTBOX_SLOTS } from '../../utils/constants.js';
import { createEl, qs, clearChildren } from '../dom.js';

/** 8 个 tab 定义：label + 匹配函数（返回 true 表示该物品属于此 tab） */
const TABS = [
  { id: 'all',      label: '总览',  match: () => true },
  { id: 'facility', label: '设施',  match: id => id.startsWith('facility_') },
  { id: 'resource', label: '资源',  match: id => id.startsWith('resource_') },
  { id: 'skill',    label: '技能',  match: id => id.startsWith('skill_'),        phaseReady: false },
  { id: 'terrain',  label: '地形',  match: id => false,                          phaseReady: false },
  { id: 'item',     label: '产物',  match: id => id.startsWith('item_') },
  { id: 'consum',   label: '道具',  match: id => false,                          phaseReady: false },
  { id: 'misc',     label: '杂物',  match: id => !(
    id.startsWith('facility_') || id.startsWith('resource_') ||
    id.startsWith('item_') || id.startsWith('skill_')
  )},
];

export class InventoryPanel {
  constructor(director) {
    this.director = director;
    this.mask = null;
    this.panel = null;
    this.bodyWrap = null;         // 主内容容器（左右两列）
    this.tabBar = null;
    this.tabBtns = [];
    this.listEl = null;          // 左：背包物品列表 DOM
    this.outboxGridEl = null;    // 右：出货箱 2×6 容器
    this.selectedTabIdx = 0;
    this.selectedInventoryItemId = null; // 选中的背包物品（准备放入出货箱）
    this.visible = false;
  }

  /** 挂载：不打开，只构建 DOM */
  mount(parent = qs('body')) {
    // 遮罩
    this.mask = createEl('div', {
      class: ['panel-mask', 'inventory-mask'],
      parent,
      onclick: (e) => {
        if (e.target === this.mask) this.hide();
      },
    });

    // 面板
    this.panel = createEl('div', {
      class: ['panel-card', 'inventory-panel'],
      parent: this.mask,
    });

    // Header
    const header = createEl('div', { class: 'inventory-header', parent: this.panel });
    createEl('div', { class: 'inventory-title', text: '🎒 背包（B 切换）', parent: header });
    createEl('button', {
      class: 'inventory-close',
      text: '✖',
      parent: header,
      onclick: () => this.hide(),
    });

    // Tab bar
    this.tabBar = createEl('div', { class: 'tab-bar', parent: this.panel });
    this.tabBtns = [];
    TABS.forEach((t, i) => {
      const btn = createEl('button', {
        class: ['tab-btn', i === 0 ? 'active' : ''],
        text: t.label,
        attrs: { 'data-tab': i },
        onclick: () => this._switchTab(i),
        parent: this.tabBar,
      });
      this.tabBtns.push(btn);
    });

    // Body：左（背包） 右（出货箱）
    this.bodyWrap = createEl('div', { class: 'inventory-body', parent: this.panel });
    const leftCol = createEl('div', { class: 'inventory-left', parent: this.bodyWrap });
    const rightCol = createEl('div', { class: 'inventory-right', parent: this.bodyWrap });

    // 背包标题
    createEl('div', {
      style: { fontSize: '13px', color: '#7b6a56' },
      text: '📦 背包物品（点击选中 → 右下出货）',
      parent: leftCol,
    });

    // 物品列表容器（滚动）
    this.listEl = createEl('div', { class: 'inventory-list', parent: leftCol });

    // 出货箱标题
    createEl('div', { class: 'outbox-title', text: '📦 出货箱（满 12 种）', parent: rightCol });

    // 出货箱格子容器
    this.outboxGridEl = createEl('div', { class: 'outbox-grid', parent: rightCol });

    // 订阅事件
    this._subscribeEvents();

    // 初始隐藏
    this.mask.style.display = 'none';
  }

  /** 订阅 EventBus */
  _subscribeEvents() {
    EventBus.on(GE.INVENTORY_CHANGE, () => {
      if (this.visible) this._reRender();
    });
    EventBus.on(GE.STATE_RESET, () => {
      if (this.visible) this._reRender();
    });
    // 设置面板打开时关闭背包（互斥）
    EventBus.on(GE.UI_PANEL_OPEN, ({ panel }) => {
      if (panel === 'settings' && this.visible) this.hide();
    });
    // InputManager 里 ESC 多按会发 UI_PANEL_CLOSE('inventory')
    EventBus.on(GE.UI_PANEL_CLOSE, ({ panel }) => {
      if (panel === 'inventory' && this.visible) this.hide();
    });
    // 背包打开
    EventBus.on(GE.UI_PANEL_OPEN, ({ panel }) => {
      if (panel === 'inventory') this.toggle(); // 已开则关
    });
  }

  /** 打开 */
  show() {
    if (!this.mask) return;
    if (this.visible) return;
    this.visible = true;
    this.mask.style.display = 'flex';
    this.mask.classList.add('visible');
    this.selectedInventoryItemId = null;
    // 追踪 activePanel
    const gs = this._getGS();
    if (gs) { gs.uiState = gs.uiState || {}; gs.uiState.activePanel = 'inventory'; }
    this._reRender();
  }

  /** 关闭 */
  hide() {
    if (!this.mask) return;
    if (!this.visible) return;
    this.visible = false;
    this.mask.classList.remove('visible');
    this.mask.style.display = 'none';
    this.selectedInventoryItemId = null;
    const gs = this._getGS();
    if (gs && gs.uiState && gs.uiState.activePanel === 'inventory') {
      gs.uiState.activePanel = null;
    }
    EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'inventory' });
  }

  /** 切换开关 */
  toggle() {
    if (this.visible) this.hide();
    else this.show();
  }

  /** 切换 tab */
  _switchTab(idx) {
    if (idx < 0 || idx >= TABS.length) return;
    this.selectedTabIdx = idx;
    this.tabBtns.forEach((b, i) => {
      if (i === idx) b.classList.add('active');
      else b.classList.remove('active');
    });
    this.selectedInventoryItemId = null;
    this._renderList();
  }

  /** 全量重渲染 */
  _reRender() {
    this._renderList();
    this._renderOutbox();
  }

  /** 渲染左：背包物品列表（按 tab 过滤） */
  _renderList() {
    clearChildren(this.listEl);
    const gs = this._getGS();
    if (!gs) return;

    const tabDef = TABS[this.selectedTabIdx];

    if (tabDef.phaseReady === false) {
      createEl('div', {
        style: {
          padding: '40px 20px', textAlign: 'center',
          color: '#b0a090', fontSize: '14px',
        },
        text: '✨ 该分类将在后续阶段开放 ✨',
        parent: this.listEl,
      });
      this._renderActionWrap(null);
      return;
    }

    const list = (gs.inventory && gs.inventory.items || [])
      .filter(entry => tabDef.match(entry.itemId));

    if (list.length === 0) {
      createEl('div', {
        style: {
          padding: '40px 20px', textAlign: 'center',
          color: '#b0a090', fontSize: '14px',
        },
        text: '（暂无物品）',
        parent: this.listEl,
      });
      this._renderActionWrap(null);
      return;
    }

    // 网格容器
    const grid = createEl('div', { class: 'item-grid', parent: this.listEl });
    for (const entry of list) {
      const slot = createEl('div', {
        class: ['item-slot', this.selectedInventoryItemId === entry.itemId ? 'selected' : ''],
        attrs: { 'data-item': entry.itemId },
        parent: grid,
      });

      const emoji = this._resolveEmoji(entry.itemId);
      const name = this._resolveName(entry.itemId);

      createEl('div', { class: 'item-name', text: name, parent: slot });
      createEl('div', { class: 'item-emoji', text: emoji, parent: slot });
      if (entry.qty > 1) {
        createEl('div', { class: 'item-qty', text: `×${entry.qty}`, parent: slot });
      }

      // 点击：选中/取消选中（两步式）
      slot.addEventListener('click', () => {
        const gsRef = this._getGS();
        if (!gsRef) return;
        // toggle 选中
        if (this.selectedInventoryItemId === entry.itemId) {
          this.selectedInventoryItemId = null;
        } else {
          this.selectedInventoryItemId = entry.itemId;
        }
        this._renderList(); // 刷新
      });
    }

    // 下方 action 按钮区（两步式：先选再放）
    this._renderActionWrap(this.selectedInventoryItemId);
  }

  /** 渲染列表下方的"放入出货箱"两步式按钮区 */
  _renderActionWrap(selectedItemId) {
    // 先移除旧的 actionWrap（如果存在）
    let wrap = this.listEl.querySelector('.inv-action-wrap');
    if (wrap) wrap.remove();

    wrap = createEl('div', {
      class: 'inv-action-wrap',
      parent: this.listEl,
      style: {
        display: 'flex',
        gap: '8px',
        padding: '10px 0 4px',
        borderTop: '2px dashed #b8a888',
        marginTop: '6px',
      },
    });

    if (!selectedItemId) {
      createEl('div', {
        style: { color: '#b0a090', fontSize: '12px' },
        text: '← 点选一个物品',
        parent: wrap,
      });
      return;
    }

    const gs = this._getGS();
    const entry = gs?.inventory?.items?.find(i => i.itemId === selectedItemId);
    if (!entry || entry.qty <= 0) {
      // 选中的 entry 已空（比如外部 addItem/removeItem 后），自动取消选中
      this.selectedInventoryItemId = null;
      this._renderActionWrap(null);
      return;
    }

    const emoji = this._resolveEmoji(selectedItemId);
    const name = this._resolveName(selectedItemId);

    createEl('div', {
      style: {
        flex: '1', fontSize: '13px', color: '#5a4a3a', fontWeight: '600',
        display: 'flex', alignItems: 'center', gap: '6px',
      },
      html: `<span style="font-size:20px;line-height:1;font-family:Segoe UI Emoji,Apple Color Emoji,sans-serif">${emoji}</span> ${name} ×${entry.qty}`,
      parent: wrap,
    });

    createEl('button', {
      class: 'action-btn',
      style: { fontSize: '13px', padding: '6px 10px' },
      text: '✅ 放入出货箱',
      parent: wrap,
      onclick: () => {
        const gsRef = this._getGS();
        if (!gsRef || !this.selectedInventoryItemId) return;
        // 两步式：真移动
        const ok = InventorySystem.moveItemBetween(gsRef, 'items', 'outbox', this.selectedInventoryItemId, 1);
        if (ok) {
          // 成功后自动取消选中并刷新
          this.selectedInventoryItemId = null;
          this._renderList();
          this._renderOutbox();
        } else {
          // 出货箱满（InventorySystem 内部会 Toast）
          this.selectedInventoryItemId = null;
          this._renderList();
        }
      },
    });

    createEl('button', {
      class: 'action-btn',
      style: { fontSize: '13px', padding: '6px 10px', background: '#e5dfd0', borderColor: '#888' },
      text: '❌ 取消',
      parent: wrap,
      onclick: () => {
        this.selectedInventoryItemId = null;
        this._renderList();
      },
    });
  }

  /** 渲染右：出货箱 2×6 网格 */
  _renderOutbox() {
    clearChildren(this.outboxGridEl);
    const gs = this._getGS();
    const outbox = gs?.inventory?.outbox || [];

    // 按顺序渲染 12 格（格子不足的补空槽）
    for (let i = 0; i < OUTBOX_SLOTS; i++) {
      const entry = outbox[i];
      const slot = createEl('div', {
        class: ['item-slot', entry ? '' : 'empty'],
        parent: this.outboxGridEl,
      });

      if (entry) {
        const emoji = this._resolveEmoji(entry.itemId);
        const name = this._resolveName(entry.itemId);
        createEl('div', { class: 'item-name', text: name, parent: slot });
        createEl('div', { class: 'item-emoji', text: emoji, parent: slot });
        if (entry.qty > 1) {
          createEl('div', { class: 'item-qty', text: `×${entry.qty}`, parent: slot });
        }
        // 点击：取回 1 件回背包
        slot.addEventListener('click', () => {
          InventorySystem.moveItemBetween(gs, 'outbox', 'items', entry.itemId, 1);
        });
      } else {
        createEl('div', {
          style: { color: '#b0a090', fontSize: '12px' },
          text: '—',
          parent: slot,
        });
      }
    }
  }

  /** 从 GameDirector 取当前 GS */
  _getGS() {
    if (this.director && this.director.getGS) return this.director.getGS();
    if (window.__gameDirector && window.__gameDirector.getGS) {
      return window.__gameDirector.getGS();
    }
    return null;
  }

  /** 为某个 itemId 找 emoji */
  _resolveEmoji(itemId) {
    if (!itemId) return '❓';
    // 先查 ITEMS 表（产物品）
    const itemDef = ITEMS[itemId];
    if (itemDef && itemDef.emoji) return itemDef.emoji;
    // facility / resource / terrain
    return Assets.getEmoji('facilities', itemId)
      || Assets.getEmoji('resources', itemId)
      || Assets.getEmoji('items', itemId)
      || '❓';
  }

  /** 为某个 itemId 找中文名 */
  _resolveName(itemId) {
    if (!itemId) return '未知';
    const itemDef = ITEMS[itemId];
    if (itemDef && itemDef.name) return itemDef.name;
    // 设施/资源表（facilities / resources）
    // 本 Phase 内联一张 name map 作为 fallback
    const nameMap = {
      facility_home: '家', facility_tent: '帐篷',
      facility_wheat: '麦田', facility_rice: '稻田', facility_potato: '土豆田',
      facility_tulip: '郁金香', facility_strawberry: '草莓田', facility_pea: '豌豆架',
      facility_henhouse: '鸡舍', facility_slimehouse: '史莱姆屋',
      resource_event: '事件格', resource_reward: '奖励格',
      resource_hunt: '狩猎格', resource_shop: '商店', resource_bus: '巴士站',
    };
    return nameMap[itemId] || itemId;
  }
}

export default InventoryPanel;
