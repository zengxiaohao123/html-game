// ShopPanel.js —— Phase 4 重写  ·  InfoPanel 点 resource_shop 地块 → GE.UI_PANEL_OPEN({panel:'shop'})
// 3 tab：物资 / 种子 / 稀有；金币支付；DialogBox 确认购买
// 外观严格套 InventoryPanel 模板（_panelHelper）

import { EventBus } from '../../core/EventBus.js';
import { GE } from '../../core/GameEvents.js';
import { ITEMS } from '../../data/items.js';
import { InventorySystem } from '../../systems/InventorySystem.js';
import { createStandardPanel } from './_panelHelper.js';
import { createEl, qs } from '../dom.js';
import { devLog } from '../../core/Logger.js';

const TABS = [
  { id: 'goods',  label: '📦 物资' },
  { id: 'seed',   label: '🌱 种子' },
  { id: 'rare',   label: '✨ 稀有' },
];

const SHOP = [
  { id: 's1', tab: 'goods', name: '小麦',   emoji: '🌾', price: 3,  itemId: 'item_wheat',        desc: '基础作物' },
  { id: 's2', tab: 'goods', name: '稻草',   emoji: '�', price: 2,  itemId: 'item_rice_straw',  desc: '稻田副产品' },
  { id: 's3', tab: 'goods', name: '鸡蛋',   emoji: '🥚', price: 6,  itemId: 'item_egg',         desc: '新鲜鸡蛋' },
  { id: 's4', tab: 'goods', name: '轮子',   emoji: '⚙️', price: 12, itemId: 'item_wheel',       desc: '合成载具必备' },

  { id: 's5', tab: 'seed',  name: '帐篷',   emoji: '⛺', price: 15, itemId: 'facility_tent',     desc: '睡觉时行动力回满' },
  { id: 's6', tab: 'seed',  name: '麦田',   emoji: '🌾', price: 20, itemId: 'facility_wheat',    desc: '每日 +2 小麦' },
  { id: 's7', tab: 'seed',  name: '豌豆架', emoji: '🫛', price: 30, itemId: 'facility_pea',      desc: '使用技能时存豌豆' },

  { id: 's8', tab: 'rare',  name: '土豆田', emoji: '🥔', price: 40, itemId: 'facility_potato',   desc: '每日 +3 土豆，上限 30' },
  { id: 's9', tab: 'rare',  name: '草莓田', emoji: '🍓', price: 50, itemId: 'facility_strawberry', desc: '经过时存草莓' },
  { id: 's10', tab: 'rare', name: '鸡舍',   emoji: '🐔', price: 80, itemId: 'facility_henhouse', desc: '每日进生小鸡 + 取蛋' },
];

export class ShopPanel {
  constructor(director) {
    this.director = director;
    this.helper = null;
    this.tabRow = null;
    this.gridEl = null;
    this.detailEl = null;
    this.goldLabel = null;
    this.activeTab = 'goods';
    this.selectedShopId = null;
  }

  mount() {
    this.helper = createStandardPanel({
      title: '🏪 商店',
      panelKey: 'shop',
      width: 'min(92vw, 900px)',
      height: 'min(86vh, 720px)',
      onMount: (_p, body) => this._build(body),
    });
    this._subscribe();
  }

  _build(body) {
    this.goldLabel = createEl('div', {
      style: { alignSelf: 'flex-end', padding: '4px 12px', background: 'linear-gradient(135deg,#fff6c0,#f7d674)', border: '2px solid #c07a20', borderRadius: '14px', fontWeight: '800', color: '#8a5a10' },
      parent: body,
    });
    this.tabRow = createEl('div', {
      style: { display: 'flex', gap: '6px' }, parent: body,
    });
    TABS.forEach((t) => {
      createEl('button', {
        class: ['action-btn'],
        style: {
          background: this.activeTab === t.id ? '#ffe099' : 'rgba(255,255,255,0.7)',
          border: this.activeTab === t.id ? '3px solid #e8a900' : '2px solid #b8a888',
          fontWeight: this.activeTab === t.id ? '800' : '600',
        },
        text: t.label, parent: this.tabRow,
        onclick: () => { this.activeTab = t.id; this.selectedShopId = null; this._refresh(); },
      });
    });

    const main = createEl('div', {
      style: { flex: '1', minHeight: '0', display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '10px' },
      parent: body,
    });
    this.gridEl = createEl('div', {
      style: { padding: '10px', background: 'rgba(255,255,255,0.55)', border: '2px solid #b8a888', borderRadius: '12px', overflowY: 'auto' },
      parent: main,
    });
    this.detailEl = createEl('div', {
      style: { padding: '12px', background: 'rgba(255,255,255,0.55)', border: '2px solid #b8a888', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '8px' },
      parent: main,
    });

    const foot = createEl('div', {
      style: { display: 'flex', gap: '8px', justifyContent: 'flex-end', borderTop: '2px dashed #b8a888', paddingTop: '8px' },
      parent: body,
    });
    createEl('button', { class: 'action-btn', text: '离开商店', parent: foot, onclick: () => this.hide() });
    createEl('button', { class: 'action-btn', text: '🛒 购买', parent: foot, onclick: () => this._buy() });

    this._refresh();
  }

  _subscribe() {
    EventBus.on(GE.UI_PANEL_OPEN, ({ panel }) => { if (panel === 'shop') this.toggle(); });
    EventBus.on(GE.SHOP_OPEN, () => this.show());
    EventBus.on(GE.UI_PANEL_CLOSE, ({ panel }) => { if (panel === 'shop' && this.helper?.visible) this.helper.hide(); });
    EventBus.on(GE.GOLD_CHANGE, () => { if (this.helper?.visible) this._refresh(); });
    EventBus.on(GE.INVENTORY_CHANGE, () => { if (this.helper?.visible) this._refresh(); });
  }

  _getGS() { return this.director?.getGS?.(); }

  _refresh() {
    const gs = this._getGS();
    const gold = gs?.player?.gold ?? 0;
    this.goldLabel.textContent = `🪙 金币：${gold}`;

    this.gridEl.innerHTML = '';
    const items = SHOP.filter(x => x.tab === this.activeTab);
    const grid = createEl('div', {
      style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: '8px' },
      parent: this.gridEl,
    });
    items.forEach((it) => {
      const enough = gold >= it.price;
      const sel = this.selectedShopId === it.id;
      const box = createEl('div', {
        style: {
          position: 'relative', aspectRatio: '1 / 1',
          background: sel ? '#ffe099' : (enough ? 'rgba(255,255,255,0.85)' : 'rgba(230,230,230,0.7)'),
          border: sel ? '3px solid #e8a900' : '2px solid #b8a888', borderRadius: '12px', cursor: 'pointer',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px', opacity: enough ? 1 : 0.7,
        },
        parent: grid,
      });
      createEl('div', { style: { fontSize: '30px', fontFamily: '"Segoe UI Emoji",sans-serif' }, text: it.emoji, parent: box });
      createEl('div', { style: { fontSize: '11px', fontWeight: '700', textAlign: 'center', padding: '0 2px' }, text: it.name, parent: box });
      createEl('div', {
        style: { position: 'absolute', bottom: '2px', right: '3px', fontSize: '11px', fontWeight: '800', color: '#c07a20', background: 'rgba(255,255,255,0.9)', padding: '0 5px', borderRadius: '6px', border: '1px solid #c07a20' },
        text: `🪙${it.price}`, parent: box,
      });
      box.addEventListener('click', () => { this.selectedShopId = it.id; this._refresh(); });
    });

    this.detailEl.innerHTML = '';
    if (!this.selectedShopId) {
      createEl('div', { style: { color: '#b0a090', fontSize: '13px', textAlign: 'center', padding: '40px 10px', fontStyle: 'italic' }, text: '← 点击左侧商品查看详情', parent: this.detailEl });
      return;
    }
    const it = SHOP.find(x => x.id === this.selectedShopId);
    const enough = gold >= it.price;
    createEl('div', { style: { fontSize: '22px', fontWeight: '900', borderBottom: '2px solid #3a3a3a', paddingBottom: '4px' }, text: `${it.emoji}  ${it.name}`, parent: this.detailEl });
    createEl('div', { style: { fontSize: '15px', color: '#c07a20', fontWeight: '800' }, text: `🪙 售价：${it.price}`, parent: this.detailEl });
    createEl('div', { style: { fontSize: '12px', background: 'rgba(255,255,255,0.7)', borderLeft: '3px solid #e8a900', padding: '4px 8px', borderRadius: '4px' }, text: it.desc, parent: this.detailEl });
    createEl('div', { style: { fontSize: '12px', color: '#7a6a56' }, text: `已持有：${InventorySystem.countItem(gs, it.itemId)}`, parent: this.detailEl });
    const buyBtn = createEl('button', { class: 'action-btn', text: '🛒 购买', parent: this.detailEl, onclick: () => this._buy() });
    if (!enough) buyBtn.disabled = true;
  }

  _buy() {
    const gs = this._getGS();
    if (!gs || !this.selectedShopId) return;
    const it = SHOP.find(x => x.id === this.selectedShopId);
    if (!it || gs.player.gold < it.price) { EventBus.emit(GE.TOAST_SHOW, { text: '⚠️ 金币不足', duration: 1200 }); return; }
    EventBus.emit(GE.DIALOG_SHOW, {
      title: '确认购买',
      content: `花费 🪙${it.price} 购买 ${it.emoji} ${it.name}？`,
      options: [
        { label: '取消', onSelect: () => {} },
        { label: '确定', onSelect: () => {
          gs.player.gold -= it.price;
          EventBus.emit(GE.GOLD_CHANGE, { newValue: gs.player.gold, delta: -it.price });
          InventorySystem.addItem(gs, it.itemId, 1);
          EventBus.emit(GE.SHOP_BUY, { itemId: it.itemId, price: it.price });
          EventBus.emit(GE.TOAST_SHOW, { text: `🛒 购买成功：${it.emoji} ${it.name}`, duration: 1400 });
          devLog.info('[ShopPanel] SHOP_BUY', it.id);
          this._refresh();
        }},
      ],
    });
  }

  show() { this.helper?.show(); }
  hide() { this.helper?.hide(); }
  toggle() { this.helper?.toggle(); }
}

export default ShopPanel;
