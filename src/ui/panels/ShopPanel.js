// src/ui/panels/ShopPanel.js
// Phase 4 —— 商店页面
// 进入方式：InfoPanel 点 resource_shop 地块 → emit GE.SHOP_OPEN
// 3 tab：物资 / 种子 / 稀有
// 内嵌商品表（不新建 data 文件），直接改 GS.player.gold + 调 InventorySystem.addItem

import { EventBus } from '../../core/EventBus.js';
import { GE } from '../../core/GameEvents.js';
import { InventorySystem } from '../../systems/InventorySystem.js';
import { createEl, qs } from '../dom.js';
import { devLog } from '../../core/Logger.js';

const SHOP_TABS = [
  { id: 'goods',  label: '📦 物资' },
  { id: 'seed',   label: '🌱 种子' },
  { id: 'rare',   label: '✨ 稀有' },
];

/** 商店商品表（Phase 4 内嵌）
 *  每个商品：{ id, name, emoji, tab, price, itemId, desc }
 */
const SHOP_ITEMS = [
  // —— 物资 ——
  { id: 'shop_wheat',   name: '小麦',     emoji: '🌾', tab: 'goods', price: 3,  itemId: 'item_wheat',  desc: '基础作物，可喂鸡、可合成。' },
  { id: 'shop_rice',    name: '稻草',     emoji: '🌾', tab: 'goods', price: 2,  itemId: 'item_rice_straw', desc: '稻田副产品。' },
  { id: 'shop_egg',     name: '鸡蛋',     emoji: '🥚', tab: 'goods', price: 6,  itemId: 'item_egg',    desc: '新鲜鸡蛋。' },
  { id: 'shop_meat',    name: '生肉',     emoji: '🍖', tab: 'goods', price: 10, itemId: 'item_raw_meat', desc: '生物掉落物。' },
  { id: 'shop_wheel',   name: '轮子',     emoji: '⚙️', tab: 'goods', price: 12, itemId: 'item_wheel',  desc: '巴士站副产品，用于合成载具。' },

  // —— 种子（设施）——
  { id: 'shop_tent',      name: '帐篷',     emoji: '⛺', tab: 'seed', price: 15, itemId: 'facility_tent', desc: '睡觉时行动力回满；可被替换。' },
  { id: 'shop_wheat_fac', name: '麦田',     emoji: '🌾', tab: 'seed', price: 20, itemId: 'facility_wheat', desc: '每日开始产出 2 小麦。' },
  { id: 'shop_rice_fac',  name: '稻田',     emoji: '🌱', tab: 'seed', price: 22, itemId: 'facility_rice',  desc: '每日开始产出稻草。' },
  { id: 'shop_pea_fac',   name: '豌豆架',   emoji: '🫛', tab: 'seed', price: 30, itemId: 'facility_pea',   desc: '使用技能时储存豌豆。' },

  // —— 稀有 ——
  { id: 'shop_potato',    name: '土豆田',   emoji: '🥔', tab: 'rare', price: 40, itemId: 'facility_potato', desc: '自动储存土豆，每日 +3，上限 30。' },
  { id: 'shop_strawberry',name: '草莓田',   emoji: '🍓', tab: 'rare', price: 50, itemId: 'facility_strawberry', desc: '经过时存草莓，满格取走。' },
  { id: 'shop_henhouse',  name: '鸡舍',     emoji: '🐔', tab: 'rare', price: 80, itemId: 'facility_henhouse', desc: '每日进入生小鸡 + 取鸡蛋。' },
];

function findShopItem(id) { return SHOP_ITEMS.find(x => x.id === id); }

export class ShopPanel {
  constructor(director) {
    this.director = director;
    this.mask = null;
    this.panel = null;
    this.tabBar = null;
    this.gridEl = null;
    this.detailEl = null;
    this.selectedTabIdx = 0;
    this.selectedShopId = null;
    this.visible = false;
  }

  mount(parent = qs('body')) {
    this.mask = createEl('div', {
      class: ['panel-mask'], parent,
      onclick: (e) => { if (e.target === this.mask) this.hide(); },
    });

    this.panel = createEl('div', {
      class: ['panel-card', 'shop-panel'],
      style: {
        width: 'min(760px, 94vw)', maxHeight: 'min(640px, 86vh)',
        padding: '14px 16px',
        display: 'flex', flexDirection: 'column', gap: '10px',
      },
      parent: this.mask,
    });

    const head = createEl('div', {
      style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
      parent: this.panel,
    });
    this.goldLabel = createEl('div', {
      style: { fontSize: '15px', fontWeight: '700', color: '#3a2e20' },
      text: '🪙 金币：—', parent: head,
    });
    createEl('button', {
      class: 'inventory-close', text: '✖', parent: head,
      onclick: () => this.hide(),
    });

    // Tab 横排
    this.tabBar = createEl('div', {
      style: { display: 'flex', gap: '6px', padding: '6px', background: 'rgba(255,255,255,0.55)', border: '2px solid #b8a888', borderRadius: '10px', flexShrink: 0 },
      parent: this.panel,
    });
    SHOP_TABS.forEach((t, i) => {
      createEl('button', {
        class: ['tab-btn', i === 0 ? 'active' : ''],
        text: t.label, parent: this.tabBar,
        onclick: () => { this.selectedTabIdx = i; this.selectedShopId = null; this._refresh(); },
      });
    });

    // Body：左商品网格 + 右详情 + 右下购买
    const body = createEl('div', {
      style: { flex: '1', minHeight: '0', display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: '10px' },
      parent: this.panel,
    });
    this.gridEl = createEl('div', {
      style: { padding: '10px', background: 'rgba(255,255,255,0.55)', border: '2px solid #b8a888', borderRadius: '14px', overflowY: 'auto' },
      parent: body,
    });
    this.detailEl = createEl('div', {
      style: { padding: '12px', background: 'linear-gradient(135deg, #fffaf0 0%, #fff3c4 100%)', border: '2px solid #b8a888', borderRadius: '14px', display: 'flex', flexDirection: 'column', gap: '8px' },
      parent: body,
    });

    // 关闭
    const foot = createEl('div', {
      style: { display: 'flex', justifyContent: 'flex-end', borderTop: '2px dashed #b8a888', paddingTop: '8px', flexShrink: 0 },
      parent: this.panel,
    });
    createEl('button', {
      class: 'action-btn', text: '离开商店', parent: foot,
      onclick: () => this.hide(),
    });

    this._subscribeEvents();
    this.mask.style.display = 'none';
  }

  _refresh() {
    const gs = this._getGS();
    this.goldLabel.textContent = `🪙 金币：${gs?.player?.gold ?? 0}`;
    this._renderGrid();
    this._renderDetail();
  }

  _renderGrid() {
    this.gridEl.innerHTML = '';
    const tabId = SHOP_TABS[this.selectedTabIdx].id;
    const items = SHOP_ITEMS.filter(i => i.tab === tabId);
    const gs = this._getGS();
    const gold = gs?.player?.gold ?? 0;

    const wrap = createEl('div', {
      style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(78px, 1fr))', gap: '8px' },
      parent: this.gridEl,
    });
    items.forEach((it) => {
      const enough = gold >= it.price;
      const sel = this.selectedShopId === it.id;
      const s = createEl('div', {
        style: {
          position: 'relative', aspectRatio: '1 / 1',
          background: sel ? '#ffe099' : (enough ? 'rgba(255,255,255,0.85)' : 'rgba(230,230,230,0.7)'),
          border: sel ? '3px solid #e8a900' : '2px solid #b8a888',
          borderRadius: '12px', cursor: 'pointer',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px',
          opacity: enough ? 1 : 0.7,
          transition: 'transform 0.1s',
        },
        parent: wrap,
      });
      createEl('div', {
        style: { fontSize: '28px', fontFamily: '"Segoe UI Emoji",sans-serif', lineHeight: '1' },
        text: it.emoji, parent: s,
      });
      createEl('div', {
        style: { fontSize: '11px', fontWeight: '700', color: '#3a2e20', textAlign: 'center', padding: '0 2px' },
        text: it.name, parent: s,
      });
      createEl('div', {
        style: { position: 'absolute', bottom: '2px', right: '3px', fontSize: '11px', fontWeight: '700', color: '#c07a20', background: 'rgba(255,255,255,0.9)', padding: '0 4px', borderRadius: '6px' },
        text: `🪙${it.price}`, parent: s,
      });
      s.addEventListener('click', () => {
        this.selectedShopId = it.id;
        this._refresh();
      });
    });
  }

  _renderDetail() {
    this.detailEl.innerHTML = '';
    if (!this.selectedShopId) {
      createEl('div', {
        style: { color: '#b0a090', fontSize: '13px', textAlign: 'center', padding: '40px 10px', fontStyle: 'italic' },
        text: '← 点击左侧商品查看详情',
        parent: this.detailEl,
      });
      return;
    }
    const it = findShopItem(this.selectedShopId);
    const gs = this._getGS();
    const gold = gs?.player?.gold ?? 0;
    const enough = gold >= it.price;

    const topRow = createEl('div', {
      style: { display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '2px solid #e8a900', paddingBottom: '8px' },
      parent: this.detailEl,
    });
    createEl('div', {
      style: { fontSize: '38px', fontFamily: '"Segoe UI Emoji",sans-serif' },
      text: it.emoji, parent: topRow,
    });
    const info = createEl('div', { style: { flex: '1' }, parent: topRow });
    createEl('div', { style: { fontWeight: '700', fontSize: '16px', color: '#3a2e20' }, text: it.name, parent: info });
    createEl('div', { style: { fontSize: '13px', color: '#c07a20', fontWeight: '700' }, text: `🪙 售价：${it.price}`, parent: info });

    createEl('div', {
      style: { fontSize: '13px', color: '#4a3a2a', lineHeight: '1.6', background: 'rgba(255,255,255,0.6)', padding: '6px 10px', borderLeft: '3px solid #e8a900', borderRadius: '4px' },
      text: it.desc, parent: this.detailEl,
    });

    createEl('div', {
      style: { fontSize: '12px', color: '#7a6a56' },
      text: `当前持有：${InventorySystem.countItem(gs, it.itemId)}`,
      parent: this.detailEl,
    });

    // 购买按钮（右下）
    const btnRow = createEl('div', {
      style: { marginTop: 'auto', display: 'flex', gap: '8px', justifyContent: 'flex-end', paddingTop: '8px', borderTop: '2px dashed #b8a888' },
      parent: this.detailEl,
    });
    createEl('button', {
      class: 'action-btn', text: '离开', parent: btnRow,
      onclick: () => this.hide(),
    });
    const buyBtn = createEl('button', {
      class: 'action-btn', text: '🛒 购买', parent: btnRow,
      onclick: () => this._buyConfirm(),
    });
    if (!enough) buyBtn.disabled = true;
  }

  _buyConfirm() {
    const it = findShopItem(this.selectedShopId);
    if (!it) return;
    const gs = this._getGS();
    if (!gs || gs.player.gold < it.price) return;

    EventBus.emit(GE.DIALOG_SHOW, {
      title: '确认购买',
      content: `花费 🪙${it.price} 购买 ${it.emoji} ${it.name}？`,
      options: [
        { label: '取消', onSelect: () => {} },
        { label: '确定', onSelect: () => this._doBuy(it) },
      ],
    });
  }

  _doBuy(it) {
    const gs = this._getGS();
    if (!gs) return;
    if (gs.player.gold < it.price) {
      EventBus.emit(GE.TOAST_SHOW, { text: '⚠️ 金币不足', duration: 1200 });
      return;
    }
    gs.player.gold -= it.price;
    EventBus.emit(GE.GOLD_CHANGE, { newValue: gs.player.gold, delta: -it.price });
    InventorySystem.addItem(gs, it.itemId, 1);
    EventBus.emit(GE.SHOP_BUY, { itemId: it.itemId, price: it.price });
    EventBus.emit(GE.TOAST_SHOW, { text: `🛒 购买成功：${it.emoji} ${it.name}（-${it.price} 🪙）`, duration: 1600 });
    devLog.info('[ShopPanel] SHOP_BUY', it.id);
    this._refresh();
  }

  _subscribeEvents() {
    // GE.SHOP_OPEN 打开；UI_PANEL_OPEN('shop') 也可以打开
    EventBus.on(GE.SHOP_OPEN, () => this.show());
    EventBus.on(GE.UI_PANEL_OPEN, ({ panel }) => {
      if (panel === 'settings' && this.visible) this.hide();
      if (panel === 'shop') this.toggle();
    });
    EventBus.on(GE.UI_PANEL_CLOSE, ({ panel }) => {
      if (panel === 'shop' && this.visible) this.hide();
    });
    EventBus.on(GE.GOLD_CHANGE, () => { if (this.visible) this._refresh(); });
    EventBus.on(GE.INVENTORY_CHANGE, () => { if (this.visible) this._refresh(); });
    EventBus.on(GE.STATE_RESET, () => { if (this.visible) this._refresh(); });
  }

  show() {
    if (!this.mask || this.visible) return;
    this.visible = true;
    this.mask.style.display = 'flex';
    const gs = this._getGS();
    if (gs) { gs.uiState = gs.uiState || {}; gs.uiState.activePanel = 'shop'; }
    this._refresh();
  }
  hide() {
    if (!this.mask || !this.visible) return;
    this.visible = false;
    this.mask.style.display = 'none';
    const gs = this._getGS();
    if (gs && gs.uiState && gs.uiState.activePanel === 'shop') gs.uiState.activePanel = null;
    EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'shop' });
  }
  toggle() { this.visible ? this.hide() : this.show(); }

  _getGS() {
    if (this.director?.getGS) return this.director.getGS();
    if (window.__gameDirector?.getGS) return window.__gameDirector.getGS();
    return null;
  }
}

export default ShopPanel;
