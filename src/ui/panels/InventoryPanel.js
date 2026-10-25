// src/ui/panels/InventoryPanel.js
// Phase 2B 最终版（按 ui-inventory.png 排版重写）
//   顶部：8 tab 横排（总览/设施/资源/技能/地形/产物/道具/杂物）
//   左：  大网格（emoji 大图标 + 右下 qty 小字 + hover tooltip 名称）
//   右上：详情卡（大 emoji + 名称 + 🪙 价值/个 + 简短描述）
//   右下：出货箱 2×6 共 12 格
//   交互：左键点物品（背包 or 出货箱）→ Slider popup（默认=1，min=1，max=当前 qty）→
//         点击"放入 N 个"/"取回 N 个"按钮 → InventorySystem.moveItemBetween
//
// 订阅：GE.INVENTORY_CHANGE / GE.STATE_RESET / GE.UI_PANEL_OPEN/ CLOSE('inventory')

import { EventBus } from '../../core/EventBus.js';
import { GE } from '../../core/GameEvents.js';
import { Assets } from '../../core/Assets.js';
import { ITEMS } from '../../data/items.js';
import { InventorySystem } from '../../systems/InventorySystem.js';
import { OUTBOX_SLOTS } from '../../utils/constants.js';
import { createEl, qs } from '../dom.js';

/** 8 个 tab 定义 —— 以 task-briefs §9 为准，示意图只参考排版不参考文字 */
const TABS = [
  { id: 'all',      label: '总览',  match: () => true },
  { id: 'facility', label: '设施',  match: id => id.startsWith('facility_') },
  { id: 'resource', label: '资源',  match: id => id.startsWith('resource_') },
  { id: 'skill',    label: '技能',  match: id => false, phaseReady: false },
  { id: 'terrain',  label: '地形',  match: id => false, phaseReady: false },
  { id: 'item',     label: '产物',  match: id => id.startsWith('item_') },
  { id: 'consum',   label: '道具',  match: id => false, phaseReady: false },
  { id: 'misc',     label: '杂物',  match: id => !(
    id.startsWith('facility_') || id.startsWith('resource_') ||
    id.startsWith('item_') || id.startsWith('skill_')
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
  item_rice_straw:    '稻田产出的稻草，价值 1 金币/个。',
  item_potato:        '土豆：价值 2 金币/个。',
  item_strawberry:    '草莓：价值 2 金币/个。',
  item_pea:           '豌豆：价值 2 金币/个。',
  item_egg:           '鸡蛋：价值 3 金币/个。',
  item_raw_meat:      '生肉：价值 5 金币/个。',
  item_slime_gel:     '史莱姆胶：价值 4 金币/个。',
  item_wheel:         '轮子：价值 5 金币/个。',
};

export class InventoryPanel {
  constructor(director) {
    this.director = director;
    this.mask = null;
    this.panel = null;
    this.tabBar = null;
    this.tabBtns = [];
    this.listEl = null;          // 左：背包大网格
    this.detailEl = null;        // 右上：详情卡
    this.outboxGridEl = null;    // 右下：出货箱 12 格
    this.selectedTabIdx = 0;
    this.selectedItemId = null;  // 右上详情卡正在显示的 itemId
    this.selectedFrom = null;    // 'items' | 'outbox'
    this.sliderPopup = null;     // 当前打开的 Slider popup DOM（同一时间只开一个）
    this.visible = false;
  }

  // ─────────────────────── 构建 DOM ───────────────────────
  mount(parent = qs('body')) {
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

    // Tab bar
    this.tabBar = createEl('div', { class: 'tab-bar', parent: this.panel });
    TABS.forEach((t, i) => {
      this.tabBtns.push(createEl('button', {
        class: ['tab-btn', i === 0 ? 'active' : ''],
        text: t.label, attrs: { 'data-tab': i }, parent: this.tabBar,
        onclick: () => this._switchTab(i),
      }));
    });

    // 主 body：3 块 —— 左大网格 + 右侧（上：详情 / 下：出货箱）
    const body = createEl('div', { class: 'inv-body', parent: this.panel });
    const leftCol = createEl('div', { class: 'inv-left', parent: body });
    const rightCol = createEl('div', { class: 'inv-right', parent: body });
    this.listEl = createEl('div', { class: 'inv-grid-wrap', parent: leftCol });

    // 右上详情卡
    this.detailEl = createEl('div', { class: 'inv-detail-card', parent: rightCol });

    // 右下出货箱
    const outboxWrap = createEl('div', { class: 'inv-outbox-wrap', parent: rightCol });
    createEl('div', { class: 'inv-outbox-title', text: '📦 出货箱（12 格，次日自动卖金币）', parent: outboxWrap });
    this.outboxGridEl = createEl('div', { class: 'outbox-grid', parent: outboxWrap });

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
  }

  // ─────────────────────── 开关 ───────────────────────
  show() {
    if (!this.mask || this.visible) return;
    this.visible = true;
    this.mask.style.display = 'flex';
    this.mask.classList.add('visible');
    const gs = this._getGS();
    if (gs) { gs.uiState = gs.uiState || {}; gs.uiState.activePanel = 'inventory'; }
    this._closeSlider();
    this.selectedItemId = null;
    this.selectedFrom = null;
    this._reRender();
  }

  hide() {
    if (!this.mask || !this.visible) return;
    this.visible = false;
    this.mask.classList.remove('visible');
    this.mask.style.display = 'none';
    this._closeSlider();
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
    this._closeSlider();
    this._reRender();
  }

  _reRender() {
    this._renderList();
    this._renderDetail();
    this._renderOutbox();
  }

  // ─────────────────────── 左：背包大网格 ───────────────────────
  _renderList() {
    this.listEl.innerHTML = '';
    this._closeSlider();
    const gs = this._getGS();
    if (!gs) return;

    const tabDef = TABS[this.selectedTabIdx];
    if (tabDef.phaseReady === false) {
      this.listEl.innerHTML = '<div style="padding:60px 20px;text-align:center;color:#b0a090;font-size:14px">✨ 该分类将在后续阶段开放 ✨</div>';
      return;
    }

    const list = (gs.inventory?.items || []).filter(e => tabDef.match(e.itemId));

    if (list.length === 0) {
      this.listEl.innerHTML = '<div style="padding:60px 20px;text-align:center;color:#b0a090;font-size:14px">（该分类下没有物品）</div>';
      return;
    }

    const grid = createEl('div', { class: 'inv-big-grid', parent: this.listEl });
    for (const entry of list) {
      const slot = createEl('div', {
        class: ['inv-big-slot', this.selectedItemId === entry.itemId && this.selectedFrom === 'items' ? 'selected' : ''],
        parent: grid,
      });

      const emoji = this._resolveEmoji(entry.itemId);
      const name = this._resolveName(entry.itemId);
      createEl('div', { class: 'inv-big-emoji', text: emoji, parent: slot });
      createEl('div', { class: 'inv-big-qty', text: `×${entry.qty}`, parent: slot });
      slot.title = `${name} ×${entry.qty}`;

      slot.addEventListener('click', (e) => {
        e.stopPropagation();
        this._showDetail(entry.itemId, 'items');
        this._openSlider(slot, 'items', entry.itemId, entry.qty, entry.qty);
      });
    }
  }

  // ─────────────────────── 右上：详情卡 ───────────────────────
  _renderDetail() {
    this.detailEl.innerHTML = '';
    if (!this.selectedItemId) {
      createEl('div', {
        style: { padding: '20px', textAlign: 'center', color: '#b0a090', fontSize: '13px' },
        text: '点击左侧物品查看详情',
        parent: this.detailEl,
      });
      return;
    }
    const entry = this._findEntry(this.selectedFrom, this.selectedItemId);
    if (!entry) {
      this.selectedItemId = null;
      return this._renderDetail();
    }
    const gs = this._getGS();
    const ITEM = ITEMS[this.selectedItemId];
    const emoji = this._resolveEmoji(this.selectedItemId);
    const name = this._resolveName(this.selectedItemId);
    const value = ITEM?.value;
    const desc = DESCRIPTIONS[this.selectedItemId] || '（暂无描述）';

    createEl('div', {
      style: {
        textAlign: 'center', fontSize: '52px', lineHeight: '1.1',
        fontFamily: '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif',
      },
      text: emoji,
      parent: this.detailEl,
    });
    createEl('div', {
      style: { textAlign: 'center', fontSize: '18px', fontWeight: '700', color: '#3a2e20', marginTop: '4px' },
      text: name, parent: this.detailEl,
    });
    if (typeof value === 'number') {
      createEl('div', {
        style: { textAlign: 'center', fontSize: '13px', color: '#8a6a3a', marginTop: '2px' },
        text: `🪙 价值 ${value}/个  ·  ×${entry.qty} = ${value * entry.qty}`,
        parent: this.detailEl,
      });
    }
    createEl('div', {
      style: {
        marginTop: '10px', fontSize: '13px', color: '#5a4a3a',
        lineHeight: '1.55', textAlign: 'left',
        padding: '8px 10px', background: 'rgba(255,255,255,0.55)',
        borderLeft: '3px solid #e8a900', borderRadius: '4px',
      },
      text: desc, parent: this.detailEl,
    });

    // 底部按钮区（方向提示）
    const dirHint = this.selectedFrom === 'items' ? '📦 点击左网格物品 → 选数量 → 放入出货箱'
      : '📦 点击右出货箱格子 → 选数量 → 取回背包';
    createEl('div', {
      style: { marginTop: '10px', fontSize: '11px', color: '#b0a090', textAlign: 'center', fontStyle: 'italic' },
      text: dirHint, parent: this.detailEl,
    });
  }

  // ─────────────────────── 右下：出货箱 12 格 ───────────────────────
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
          this._showDetail(entry.itemId, 'outbox');
          this._openSlider(slot, 'outbox', entry.itemId, entry.qty, entry.qty);
        });
      }
    }
  }

  /** 显示右上详情卡（不弹 slider） */
  _showDetail(itemId, from) {
    this.selectedItemId = itemId;
    this.selectedFrom = from;
    this._renderDetail();
    // 刷新左网格 selected 态
    this._renderList();
  }

  // ─────────────────────── Slider popup ───────────────────────
  /**
   * 在 slot 旁边弹出 Slider popup。
   * @param {HTMLElement} anchorSlot 锚点 slot DOM（用来定位 popup）
   * @param {'items'|'outbox'} from 从哪一边拿
   * @param {string} itemId 物品 id
   * @param {number} max 当前 qty
   * @param {number} defaultValue  slider 默认值（通常=1）
   */
  _openSlider(anchorSlot, from, itemId, max, defaultValue = 1) {
    this._closeSlider();
    if (max <= 0) return;

    const rect = anchorSlot.getBoundingClientRect();
    const popup = createEl('div', {
      class: ['inv-slider-popup'],
      style: {
        position: 'fixed',
        left: `${rect.right + 6}px`,
        top: `${rect.top}px`,
        zIndex: 9500,
      },
      parent: document.body,
    });

    const label = from === 'items' ? `放入出货箱` : `取回背包`;
    const emoji = this._resolveEmoji(itemId);
    const name = this._resolveName(itemId);

    // 标题
    createEl('div', {
      style: { fontWeight: '700', fontSize: '13px', marginBottom: '6px', color: '#3a2e20' },
      text: `${emoji} ${name} — ${label}`,
      parent: popup,
    });

    // Slider
    const slider = createEl('input', {
      attrs: { type: 'range', min: 1, max, value: Math.min(defaultValue, max) },
      style: { width: '180px' },
      parent: popup,
    });
    const valLabel = createEl('div', {
      style: { fontSize: '20px', fontWeight: '700', color: '#e8a900', textAlign: 'center', margin: '4px 0' },
      text: `${Math.min(defaultValue, max)}`,
      parent: popup,
    });
    slider.addEventListener('input', () => { valLabel.textContent = slider.value; });

    // 快捷按钮行：×1 / ×5 / ×半 / ×全
    const quickRow = createEl('div', {
      style: { display: 'flex', gap: '4px', marginBottom: '8px' },
      parent: popup,
    });
    [
      { t: '1', v: 1 },
      { t: '5', v: Math.min(5, max) },
      { t: '一半', v: Math.max(1, Math.floor(max / 2)) },
      { t: '全部', v: max },
    ].forEach(({ t, v }) => {
      if (v < 1) return;
      const b = createEl('button', {
        class: 'inv-quick-btn', text: t, parent: quickRow,
      });
      b.addEventListener('click', () => { slider.value = v; valLabel.textContent = v; });
    });

    // 操作按钮行
    const actionRow = createEl('div', {
      style: { display: 'flex', gap: '6px', justifyContent: 'flex-end' },
      parent: popup,
    });

    createEl('button', {
      class: 'action-btn',
      style: { fontSize: '12px', background: '#e5dfd0', borderColor: '#888' },
      text: '❌ 取消',
      parent: actionRow,
      onclick: () => this._closeSlider(),
    });

    createEl('button', {
      class: 'action-btn',
      style: { fontSize: '12px', padding: '4px 10px' },
      text: `✅ ${label}`,
      parent: actionRow,
      onclick: () => {
        const qty = Number(slider.value);
        const gs = this._getGS();
        if (!gs) return;
        InventorySystem.moveItemBetween(gs, from, from === 'items' ? 'outbox' : 'items', itemId, qty);
        this._closeSlider();
        // 如果这次把该 entry 搬空 → 取消详情卡选中
        const newEntry = this._findEntry(from, itemId);
        if (!newEntry) { this.selectedItemId = null; this.selectedFrom = null; }
        this._reRender();
      },
    });

    this.sliderPopup = popup;

    // popup 超出视口右侧 → 翻到左边
    const pRect = popup.getBoundingClientRect();
    if (pRect.right > window.innerWidth - 8) {
      popup.style.left = `${rect.left - pRect.width - 6}px`;
    }
    if (pRect.bottom > window.innerHeight - 8) {
      popup.style.top = `${Math.max(4, window.innerHeight - pRect.height - 8)}px`;
    }
  }

  _closeSlider() {
    if (this.sliderPopup) { this.sliderPopup.remove(); this.sliderPopup = null; }
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
    const d = ITEMS[itemId];
    if (d?.emoji) return d.emoji;
    return Assets.getEmoji('facilities', itemId)
      || Assets.getEmoji('resources', itemId)
      || Assets.getEmoji('items', itemId)
      || '❓';
  }

  _resolveName(itemId) {
    if (!itemId) return '未知';
    const d = ITEMS[itemId];
    if (d?.name) return d.name;
    const facilitiesMap = {
      facility_home: '家', facility_tent: '帐篷',
      facility_wheat: '麦田', facility_rice: '稻田', facility_potato: '土豆田',
      facility_tulip: '郁金香', facility_strawberry: '草莓田', facility_pea: '豌豆架',
      facility_henhouse: '鸡舍', facility_slimehouse: '史莱姆屋',
      resource_event: '事件格', resource_reward: '奖励格',
      resource_hunt: '狩猎格', resource_shop: '商店', resource_bus: '巴士站',
    };
    return facilitiesMap[itemId] || itemId;
  }
}

export default InventoryPanel;
