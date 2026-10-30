// src/ui/panels/ShopPanel.js
// 商店 / 魔法商店页面（设计文档 v0.5 §16.21 / §16.22）
//
// 布局（照 ui-shop-reference.png 的结构，美术用 emoji 占位）：
//   ┌───────────┬──────────────────────────────┐
//   │ 商人立绘  │  [售卖][购买]        ← 胶囊 tab │
//   │ (1/3 宽)  │  ┌────┬────┬────┬────┐        │
//   │ +对话框   │  │ 商品 ×12（4 列 × 3 行）  │        │
//   │           │  └────┴────┴────┴────┘        │
//   │           │                     [离开]     │
//   └───────────┴──────────────────────────────┘
//   刷新按钮悬浮在左右两栏交界处，按钮上显示本次刷新价格
//
// 行为：
//   * 购买：点格子 → 详情弹窗（图标/名称/描述/买价）→ 购买；每格只卖 1 个
//   * 售卖：右侧换成背包格（显示回收价）；魔导书/技能石/收藏品/载具灰化不可售
//   * 刷新：价格 4 / 8 / 12 递增，每周 3 次；每周一自动刷新
//   * 离开：本回合内不能再进同一家店
//
// 不遮挡顶部 UI 与底部快捷栏：容器只占中间区域，上下留出空隙。

import { EventBus } from '../../core/EventBus.js';
import { GE } from '../../core/GameEvents.js';
import { createEl, qs } from '../dom.js';
import { devLog } from '../../core/Logger.js';
import { ITEMS } from '../../data/items.js';
import * as InventorySystem from '../../systems/InventorySystem.js';
import {
  SHOP_KINDS, getShop, enterShop, leaveShop, buy, sell,
  refreshShop, manualRefreshCost, refreshLeft, isSellable,
} from '../../systems/ShopSystem.js';

/** 商人立绘占位（美术未到位时用大号 emoji + 对话框） */
const MERCHANT = {
  shop: { emoji: '🧑‍🌾', name: '杂货商人', line: '看看有什么需要的吧，都是好东西。' },
  magic: { emoji: '🧙', name: '魔法商人', line: '魔导书和技能石……你确定付得起吗？' },
};

export class ShopPanel {
  constructor(director) {
    this.director = director;
    this.root = null;
    this.tileIdx = -1;
    this.kind = 'shop';
    this.tab = 'buy';          // 'buy' | 'sell'
    this.visible = false;
    this.gridEl = null;
    this.detailEl = null;
    this.refreshBtn = null;
    this.goldEl = null;
  }

  get gs() { return this.director.getGS(); }

  mount() {
    this.root = createEl('div', {
      style: {
        position: 'fixed',
        left: '0', right: '0',
        top: '72px',            // 让出顶部 UI
        bottom: '104px',        // 让出底部快捷栏
        zIndex: '5500',
        display: 'none',
        padding: '0 12px',
        fontFamily: '"LXGW WenKai TC", "Microsoft YaHei", sans-serif',
        color: '#3a2e20',
      },
      parent: qs('body'),
    });
    this._subscribe();
  }

  _subscribe() {
    EventBus.on(GE.UI_PANEL_OPEN, ({ panel, tileIdx }) => {
      if (panel !== 'shop' && panel !== 'magicShop') return;
      if (this.visible) return;      // 防止 open() 内部再 emit 造成递归
      this.open(tileIdx);
    });
    EventBus.on(GE.UI_PANEL_CLOSE, ({ panel }) => {
      if ((panel === 'shop' || panel === 'magicShop') && this.visible) this.close();
    });
    EventBus.on(GE.STATE_RESET, () => { if (this.visible) this.close(); });
    EventBus.on(GE.INVENTORY_CHANGE, () => { if (this.visible && this.tab === 'sell') this._renderGrid(); });
    EventBus.on(GE.GOLD_CHANGE, () => { if (this.visible) this._renderTop(); });
  }

  // ────────────────────────────────────────── 打开 / 关闭
  open(tileIdx) {
    const gs = this.gs;
    if (!gs) return;
    if (tileIdx == null) {
      // 未指定地块：找场上第一家商店（兼容旧调用）
      const t = gs.map.outerTiles.find((x) => x.contentId === 'resource_shop' || x.contentId === 'resource_magic_shop');
      tileIdx = t ? t.idx : -1;
    }
    if (tileIdx < 0) {
      EventBus.emit(GE.TOAST_SHOW, { text: '🏪 附近没有商店', duration: 1500 });
      return;
    }
    const enter = enterShop(gs, tileIdx);
    if (!enter.ok) return;

    this.tileIdx = tileIdx;
    this.kind = enter.shop.kind;
    this.tab = 'buy';
    this.visible = true;
    this.root.style.display = 'block';
    this._render();
    EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'shop' });
    devLog.info('[ShopPanel] open tile', tileIdx, this.kind);
  }

  close() {
    if (!this.visible) return;
    leaveShop(this.gs, this.tileIdx);
    this.visible = false;
    this.root.style.display = 'none';
    this.root.innerHTML = '';
    this.tileIdx = -1;
    EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'shop' });
    devLog.info('[ShopPanel] close');
  }

  toggle() { this.visible ? this.close() : this.open(null); }

  // ────────────────────────────────────────── 渲染
  _render() {
    const root = this.root;
    root.innerHTML = '';

    const card = createEl('div', {
      style: {
        height: '100%', display: 'flex',
        background: 'linear-gradient(135deg,#fffbf0 0%,#fff3c4 100%)',
        border: '3px solid #3a3a3a', borderRadius: '16px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        overflow: 'hidden', position: 'relative',
      },
      parent: root,
    });

    this._renderMerchant(card);
    this._renderRefresh(card);
    const right = createEl('div', {
      style: { flex: '1', display: 'flex', flexDirection: 'column', padding: '14px 16px', gap: '12px', minWidth: '0' },
      parent: card,
    });
    this._renderTop(right);
    this.gridEl = createEl('div', {
      style: { flex: '1', overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gridAutoRows: 'minmax(96px, 1fr)', gap: '10px', alignContent: 'start' },
      parent: right,
    });
    this._renderFooter(right);
    this._renderGrid();
    this._renderGold();
  }

  _renderMerchant(card) {
    const m = MERCHANT[this.kind] || MERCHANT.shop;
    const col = createEl('div', {
      style: {
        width: '32%', minWidth: '220px', position: 'relative',
        borderRight: '3px solid #3a3a3a',
        background: 'linear-gradient(180deg,#e8d3a9 0%,#d9bd8c 100%)',
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
      },
      parent: card,
    });
    createEl('div', {
      style: { flex: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '120px', lineHeight: '1', userSelect: 'none' },
      text: m.emoji, parent: col,
    });
    const dlg = createEl('div', {
      style: {
        margin: '0 10px 10px', padding: '10px 12px',
        background: '#fffbe6', border: '3px solid #3a3a3a', borderRadius: '12px',
        fontSize: '14px', lineHeight: '1.5',
      },
      parent: col,
    });
    createEl('div', { text: m.name, style: { fontWeight: '800', marginBottom: '4px' }, parent: dlg });
    createEl('div', { text: m.line, parent: dlg });
  }

  _renderRefresh(card) {
    this.refreshBtn = createEl('button', {
      style: {
        position: 'absolute', left: '32%', top: '50%', transform: 'translate(-50%,-50%)',
        width: '76px', height: '76px', borderRadius: '50%',
        border: '3px solid #3a3a3a', background: '#fffbe6', cursor: 'pointer',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        fontSize: '11px', fontWeight: '700', color: '#3a2e20', gap: '2px',
        boxShadow: '0 3px 8px rgba(0,0,0,0.3)', zIndex: '2',
      },
      parent: card,
    });
    this.refreshBtn.onclick = () => {
      const shop = getShop(this.gs, this.tileIdx);
      const res = refreshShop(this.gs, this.tileIdx);
      if (res.ok) this._render();
      else if (res.cost === undefined) this._renderTop();
      devLog.info('[ShopPanel] refresh', res, 'left=', refreshLeft(shop));
    };
    this._renderRefreshLabel();
  }

  _renderRefreshLabel() {
    if (!this.refreshBtn) return;
    const shop = getShop(this.gs, this.tileIdx);
    const cost = manualRefreshCost(shop);
    const left = refreshLeft(shop);
    this.refreshBtn.innerHTML = '';
    createEl('div', { text: '🔄', style: { fontSize: '22px', lineHeight: '1' }, parent: this.refreshBtn });
    createEl('div', { text: cost === null ? '已用完' : `刷新 ${cost}`, parent: this.refreshBtn });
    createEl('div', { text: `剩 ${left} 次`, style: { fontSize: '10px', opacity: '0.75' }, parent: this.refreshBtn });
    this.refreshBtn.disabled = cost === null;
    this.refreshBtn.style.opacity = cost === null ? '0.5' : '1';
    this.refreshBtn.style.cursor = cost === null ? 'default' : 'pointer';
  }

  _renderTop(right) {
    const bar = createEl('div', {
      style: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px', flexShrink: '0' },
      parent: right,
    });
    const gold = createEl('div', {
      style: {
        marginRight: 'auto', padding: '4px 14px', borderRadius: '999px',
        background: 'linear-gradient(135deg,#fff6c0,#f7d674)', border: '2px solid #c07a20',
        fontWeight: '800', color: '#8a5a10', fontSize: '14px',
      },
      parent: bar,
    });
    gold.textContent = `🪙 ${this.gs.player.gold}`;
    this.goldEl = gold;

    for (const [key, label] of [['sell', '售卖'], ['buy', '购买']]) {
      const active = this.tab === key;
      const btn = createEl('button', {
        text: label,
        style: {
          padding: '8px 26px', borderRadius: '999px', cursor: 'pointer',
          border: '3px solid #3a3a3a', fontWeight: '800', fontSize: '15px',
          background: active ? 'linear-gradient(135deg,#8ed36b,#4fae3f)' : '#fffbe6',
          color: active ? '#fff' : '#3a2e20',
        },
        parent: bar,
      });
      btn.onclick = () => { this.tab = key; this._render(); };
    }
  }

  _renderGold() {
    if (this.goldEl) this.goldEl.textContent = `🪙 ${this.gs.player.gold}`;
  }

  _renderFooter(right) {
    const foot = createEl('div', {
      style: { display: 'flex', justifyContent: 'flex-end', flexShrink: '0' },
      parent: right,
    });
    const leave = createEl('button', {
      text: '离开',
      style: {
        padding: '10px 40px', borderRadius: '10px', border: '3px solid #3a3a3a',
        background: 'linear-gradient(135deg,#ffd5d5,#f3a3a3)', cursor: 'pointer',
        fontWeight: '800', fontSize: '16px', color: '#5a2020',
      },
      parent: foot,
    });
    leave.onclick = () => this.close();
  }

  _renderGrid() {
    if (!this.gridEl) return;
    this.gridEl.innerHTML = '';
    if (this.tab === 'buy') this._renderBuyGrid();
    else this._renderSellGrid();
    this._renderRefreshLabel();
  }

  _renderBuyGrid() {
    const shop = getShop(this.gs, this.tileIdx);
    if (!shop) return;
    const cfg = SHOP_KINDS[shop.kind];
    const slots = cfg.slots;

    for (let i = 0; i < slots; i++) {
      const item = shop.stock[i];
      const cell = createEl('div', {
        style: {
          position: 'relative', border: '3px solid #3a3a3a', borderRadius: '10px',
          background: item && !item.sold ? '#fffdf5' : 'rgba(0,0,0,0.05)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          cursor: item && !item.sold ? 'pointer' : 'default', padding: '6px',
          opacity: item && item.sold ? '0.4' : '1', minHeight: '96px',
        },
        parent: this.gridEl,
      });
      if (!item) continue;

      createEl('div', {
        text: item.name,
        style: { position: 'absolute', top: '4px', left: '6px', right: '6px', fontSize: '11px', fontWeight: '700', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
        parent: cell,
      });
      createEl('div', { text: item.emoji || '❓', style: { fontSize: '34px', lineHeight: '1' }, parent: cell });
      createEl('div', {
        text: item.price != null ? `🪙 ${item.price}` : '—',
        style: { position: 'absolute', bottom: '4px', right: '8px', fontSize: '13px', fontWeight: '800', color: '#8a5a10' },
        parent: cell,
      });
      if (item.sold) {
        createEl('div', {
          text: '已售出', style: { position: 'absolute', inset: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '800', color: '#a33' },
          parent: cell,
        });
      } else {
        cell.onclick = () => this._openDetail({ mode: 'buy', item, slotIdx: i });
      }
    }
  }

  _renderSellGrid() {
    const gs = this.gs;
    const entries = (gs.inventory.items || []).filter((e) => e.qty > 0);
    if (entries.length === 0) {
      createEl('div', { text: '背包是空的', style: { gridColumn: '1 / -1', padding: '20px', textAlign: 'center', opacity: '0.6' }, parent: this.gridEl });
      return;
    }
    entries.forEach((entry) => {
      const def = ITEMS[entry.itemId] || {};
      const price = entry.value ?? def.value ?? 0;
      const sellable = isSellable(entry.itemId);
      const cell = createEl('div', {
        style: {
          position: 'relative', border: '3px solid #3a3a3a', borderRadius: '10px',
          background: '#fffdf5', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', padding: '6px',
          cursor: sellable ? 'pointer' : 'default', opacity: sellable ? '1' : '0.45', minHeight: '96px',
        },
        parent: this.gridEl,
      });
      createEl('div', {
        text: def.name || entry.itemId,
        style: { position: 'absolute', top: '4px', left: '6px', right: '6px', fontSize: '11px', fontWeight: '700', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
        parent: cell,
      });
      createEl('div', { text: def.emoji || '❓', style: { fontSize: '32px', lineHeight: '1' }, parent: cell });
      createEl('div', {
        text: `×${entry.qty}`,
        style: { position: 'absolute', bottom: '4px', left: '8px', fontSize: '12px', fontWeight: '700' },
        parent: cell,
      });
      createEl('div', {
        text: sellable ? `回收 🪙${price}` : '不可售',
        style: { position: 'absolute', bottom: '4px', right: '8px', fontSize: '11px', fontWeight: '800', color: sellable ? '#8a5a10' : '#a33' },
        parent: cell,
      });
      if (sellable) {
        cell.onclick = () => this._openDetail({ mode: 'sell', item: { ...def, id: entry.itemId, price }, value: entry.value });
      }
    });
  }

  // ────────────────────────────────────────── 详情弹窗
  _openDetail({ mode, item, slotIdx, value }) {
    this._closeDetail();
    const mask = createEl('div', {
      style: { position: 'absolute', inset: '0', background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: '10', borderRadius: '16px' },
      parent: this.root.querySelector('div'),
    });
    this.detailEl = mask;

    const box = createEl('div', {
      style: {
        width: 'min(420px, 80%)', background: '#fffbf0', border: '3px solid #3a3a3a',
        borderRadius: '14px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px',
      },
      parent: mask,
    });

    const head = createEl('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' }, parent: box });
    createEl('div', { text: item.emoji || '❓', style: { fontSize: '46px', lineHeight: '1' }, parent: head });
    const info = createEl('div', { style: { flex: '1' }, parent: head });
    createEl('div', { text: item.name || item.id, style: { fontSize: '18px', fontWeight: '800' }, parent: info });
    createEl('div', {
      text: mode === 'buy' ? `买价 🪙 ${item.price ?? '—'}` : `回收价 🪙 ${item.price ?? 0}`,
      style: { fontSize: '14px', color: '#8a5a10', fontWeight: '700', marginTop: '4px' },
      parent: info,
    });

    createEl('div', {
      text: (ITEMS[item.id]?.description || item.description || '').replace(/\n/g, ' '),
      style: { fontSize: '13px', lineHeight: '1.6', maxHeight: '120px', overflowY: 'auto' },
      parent: box,
    });

    const btns = createEl('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '10px' }, parent: box });
    const cancel = createEl('button', {
      text: '取消',
      style: { padding: '8px 20px', borderRadius: '8px', border: '2px solid #3a3a3a', background: '#fffbe6', cursor: 'pointer', fontWeight: '700' },
      parent: btns,
    });
    cancel.onclick = () => this._closeDetail();

    const ok = createEl('button', {
      text: mode === 'buy' ? '购买' : '售卖',
      style: {
        padding: '8px 24px', borderRadius: '8px', border: '2px solid #3a3a3a',
        background: 'linear-gradient(135deg,#8ed36b,#4fae3f)', color: '#fff', cursor: 'pointer', fontWeight: '800',
      },
      parent: btns,
    });
    ok.onclick = () => {
      const res = mode === 'buy'
        ? buy(this.gs, this.tileIdx, slotIdx)
        : sell(this.gs, item.id, value !== undefined ? { value } : {});
      if (res.ok) {
        this._closeDetail();
        this._render();
      }
      // 失败时 Toast 已由 ShopSystem 发出，弹窗保持打开便于重试
    };
  }

  _closeDetail() {
    if (this.detailEl) {
      this.detailEl.remove();
      this.detailEl = null;
    }
  }
}

export default ShopPanel;
