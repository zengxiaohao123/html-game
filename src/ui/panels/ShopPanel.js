// src/ui/panels/ShopPanel.js
// 商店 / 魔法商店页面（设计文档 v0.5 §16.21 / §16.22，第 8 批 UI 重做）
//
// 布局（居中卡片 + 四周留白；暗色遮罩盖地图，不盖顶部 UI 区与底部栏——它们 z-index 更高）：
//   ┌───────────┬───────────────────────────────┐
//   │           │              [售卖] [购买]  ✖ │
//   │  商人立绘  │   ┌────┬────┬────┬────┐       │
//   │ (33.333%) │ 🔄│ 商品格 4×3（正方形）│      │
//   │ ┌对话框┐  │ 刷新│ └────┴────┴────┴────┘   │
//   │ └─────┘  │                        [离开] │
//   └───────────┴───────────────────────────────┘
//   🔄刷新 悬浮在立绘右上方（左右两栏交界附近，absolute）。
//   商品格：正方形 112px、间距统一 10px、网格居中不铺满；已售/魔法商店空位 = 空格。
//   格内仅三要素：顶部小字名称 / 居中图标 / 右下角金币图标+价格（§16.21，无描述无多余文字）。
//
// 行为：购买每格仅 1 件；售卖价 = 物品价值；刷新 4/8/12 每周 3 次（用完灰化）；
//       周一自动刷新；离店本回合禁入；ESC 先关详情弹窗、再关商店（捕获阶段拦截）。

import { EventBus } from '../../core/EventBus.js';
import { GE } from '../../core/GameEvents.js';
import { createEl, qs, iconEl } from '../dom.js';
import { devLog } from '../../core/Logger.js';
import { ITEMS } from '../../data/items.js';
import {
  SHOP_KINDS, getShop, enterShop, leaveShop, buy, sell,
  refreshShop, manualRefreshCost, refreshLeft, isSellable, effectivePrice,
} from '../../systems/ShopSystem.js';

/** 商品格网格常量（正方形格子 + 统一间距，冒烟用例按此核对） */
export const SHOP_GRID = { cols: 4, cell: 112, gap: 10 };

/** 商人立绘占位（美术未接入：iconEl 预留 PNG 入口，先回退大号 emoji + 对话框） */
const MERCHANT = {
  shop: { iconId: 'merchant_shop', emoji: '\u{1F9D1}\u200D\u{1F33E}', name: '杂货商人', line: '看看有什么需要的吧，都是好东西。' },
  magic: { iconId: 'merchant_magic', emoji: '🧙', name: '魔法商人', line: '魔导书和技能石……你确定付得起吗？' },
};

const UI = {
  border: '3px solid #3a3a3a',
  radius: '16px',
  cream: '#fffbf0',
};

export class ShopPanel {
  constructor(director) {
    this.director = director;
    this.root = null;
    this.cardEl = null;
    this.tileIdx = -1;
    this.kind = 'shop';
    this.tab = 'buy';          // 'buy' | 'sell'
    this.visible = false;
    this.gridEl = null;
    this.gridWrapEl = null;
    this.detailEl = null;
    this.refreshBtn = null;
    this.tabBtns = [];         // [售卖, 购买]
    this.leaveBtn = null;
    this._escHandler = null;
  }

  get gs() { return this.director.getGS(); }

  mount() {
    this.root = createEl('div', {
      style: {
        position: 'fixed',
        inset: '0',
        zIndex: '5500',
        display: 'none',
        alignItems: 'center', justifyContent: 'center',   // 卡片居中 → 四周留白
        background: 'rgba(24,18,10,0.45)',                // 遮罩盖地图
        fontFamily: '"LXGW WenKai TC", "Microsoft YaHei", sans-serif',
        color: '#3a2e20',
      },
      parent: qs('body'),
    });
    this._subscribe();
    this._bindEsc();
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
  }

  // ────────────────────────────────────────── 打开 / 关闭
  open(tileIdx) {
    const gs = this.gs;
    if (!gs) return;
    if (tileIdx == null) {
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
    this.root.style.display = 'flex';
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
    this.cardEl = null;
    this.detailEl = null;
    this.tileIdx = -1;
    EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'shop' });
    devLog.info('[ShopPanel] close');
  }

  toggle() { this.visible ? this.close() : this.open(null); }

  // ────────────────────────────────────────── 骨架
  _render() {
    const root = this.root;
    root.innerHTML = '';
    this.detailEl = null;

    // 居中卡片：不铺满屏幕（min() 限宽限高），四周自然留白
    const card = createEl('div', {
      style: {
        position: 'relative',         // 悬浮刷新按钮 / ✖ 的定位参照
        width: 'min(1120px, 92vw)',
        height: 'min(660px, calc(100vh - 240px))',
        minHeight: '480px',
        display: 'flex', minWidth: '0', minHeight: '0',
        background: 'linear-gradient(135deg,#fffbf0 0%,#fff3c4 100%)',
        border: UI.border, borderRadius: UI.radius,
        boxShadow: '0 10px 30px rgba(0,0,0,0.38)',
        overflow: 'hidden',
      },
      parent: root,
    });
    this.cardEl = card;

    this._renderMerchant(card);
    this._renderRefreshBtn(card);

    // §16.20「右上角 ❌」：先关弹窗，再关商店页面回主界面
    const closeBtn = createEl('button', {
      text: '✖',
      style: {
        position: 'absolute', top: '10px', right: '10px', zIndex: '15',
        width: '32px', height: '32px', border: '2px solid #3a3a3a', borderRadius: '8px',
        background: '#fffbe6', cursor: 'pointer', fontSize: '16px', fontWeight: '700',
        color: '#3a2e20', lineHeight: '1',
      },
      parent: card,
    });
    closeBtn.onclick = () => {
      if (this.detailEl) this._closeDetail();
      else this.close();
    };

    const right = createEl('div', {
      style: {
        flex: '1', display: 'flex', flexDirection: 'column',
        padding: '14px 16px', gap: '10px', minWidth: '0', minHeight: '0',
      },
      parent: card,
    });
    this._renderHeader(right);

    // 网格容器：购买 3 行居中；售卖条目不定 → 顶对齐 + 滚动
    this.gridWrapEl = createEl('div', {
      style: {
        flex: '1', minHeight: '0',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      },
      parent: right,
    });

    // 正方形格子：固定 112px 列宽 = 行高，间距统一 10px（不随屏幕拉伸）
    this.gridEl = createEl('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: `repeat(${SHOP_GRID.cols}, ${SHOP_GRID.cell}px)`,
        gridAutoRows: `${SHOP_GRID.cell}px`,
        gap: `${SHOP_GRID.gap}px`,
      },
      parent: this.gridWrapEl,
    });

    const foot = createEl('div', {
      style: { display: 'flex', justifyContent: 'flex-end', flexShrink: '0' },
      parent: right,
    });
    this.leaveBtn = createEl('button', {
      text: '离开',
      style: {
        padding: '8px 34px', borderRadius: '10px', border: '2px solid #3a3a3a',
        background: 'linear-gradient(135deg,#ffd5d5,#f3a3a3)', cursor: 'pointer',
        fontWeight: '800', fontSize: '15px', color: '#5a2020',
        boxShadow: '0 3px 8px rgba(0,0,0,0.18)',
      },
      parent: foot,
    });
    this.leaveBtn.onclick = () => this.close();

    this._renderGrid();
  }

  _renderMerchant(card) {
    const m = MERCHANT[this.kind] || MERCHANT.shop;
    const col = createEl('div', {
      style: {
        width: '33.333%', flexShrink: '0',   // §16.21：左 1/3 宽
        borderRight: UI.border,
        background: 'linear-gradient(180deg,#e8d3a9 0%,#d9bd8c 100%)',
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
        overflow: 'hidden',
      },
      parent: card,
    });
    const portrait = createEl('div', {
      style: {
        flex: '1', minHeight: '0', display: 'flex',
        alignItems: 'center', justifyContent: 'center', userSelect: 'none',
      },
      parent: col,
    });
    portrait.appendChild(iconEl('ui', m.iconId, {
      fallback: m.emoji, size: 'clamp(64px, 8vw, 104px)',
    }));
    const dlg = createEl('div', {
      style: {
        margin: '10px', padding: '8px 10px',
        background: '#fffbe6', border: '2px solid #3a3a3a', borderRadius: '10px',
        fontSize: '12px', lineHeight: '1.5',
      },
      parent: col,
    });
    createEl('div', { text: m.name, style: { fontWeight: '800', marginBottom: '2px', fontSize: '13px' }, parent: dlg });
    createEl('div', { text: m.line, style: { opacity: '0.9' }, parent: dlg });
  }

  /** 刷新按钮：悬浮在立绘右上方（左右两栏交界附近，§16.21）；文案仅「刷新 + 价格」，用完灰化 */
  _renderRefreshBtn(card) {
    this.refreshBtn = createEl('button', {
      style: {
        position: 'absolute', left: '33.333%', top: '14px',
        transform: 'translateX(-50%)', zIndex: '10',
        display: 'flex', alignItems: 'center', gap: '6px',
        padding: '6px 14px', borderRadius: '999px', cursor: 'pointer',
        border: '2px solid #3a3a3a', background: '#fffbe6',
        fontSize: '13px', fontWeight: '800', color: '#3a2e20', whiteSpace: 'nowrap',
        boxShadow: '0 3px 10px rgba(0,0,0,0.25)',
      },
      parent: card,
    });
    this.refreshBtn.onclick = () => {
      const res = refreshShop(this.gs, this.tileIdx);
      if (res.ok) this._render();
      else this._renderHeaderState();
    };
  }

  /** 标题行：右对齐 [售卖][购买] 胶囊切换（§16.21 顺序与文案） */
  _renderHeader(right) {
    const bar = createEl('div', {
      style: {
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
        gap: '8px', flexShrink: '0', paddingRight: '42px',   // 让开 ✖
      },
      parent: right,
    });

    this.tabBtns = [];
    for (const [key, label] of [['sell', '售卖'], ['buy', '购买']]) {
      const active = this.tab === key;
      const btn = createEl('button', {
        text: label,
        style: {
          padding: '6px 24px', borderRadius: '999px', cursor: 'pointer',
          border: '2px solid #3a3a3a', fontWeight: '800', fontSize: '13.5px',
          background: active ? 'linear-gradient(135deg,#8ed36b,#4fae3f)' : '#fffbe6',
          color: active ? '#fff' : '#3a2e20',
          boxShadow: active ? '0 2px 6px rgba(0,0,0,0.2)' : 'none',
        },
        parent: bar,
      });
      btn.onclick = () => { this.tab = key; this._render(); };
      this.tabBtns.push(btn);
    }

    this._renderHeaderState();
  }

  _renderHeaderState() {
    const shop = getShop(this.gs, this.tileIdx);
    if (this.refreshBtn && shop) {
      const cost = manualRefreshCost(shop);
      const left = refreshLeft(shop);
      this.refreshBtn.innerHTML = '';
      createEl('span', { text: '🔄', style: { fontSize: '15px' }, parent: this.refreshBtn });
      createEl('span', {
        text: cost === null ? '刷新' : `刷新 ${cost}`,
        parent: this.refreshBtn,
      });
      this.refreshBtn.disabled = cost === null;
      this.refreshBtn.style.opacity = cost === null ? '0.5' : '1';
      this.refreshBtn.style.cursor = cost === null ? 'default' : 'pointer';
      this.refreshBtn.title = `本周手动刷新剩 ${left} 次`;
    }
  }

  // ────────────────────────────────────────── 网格
  _renderGrid() {
    if (!this.gridEl) return;
    this.gridEl.innerHTML = '';
    if (this.tab === 'buy') {
      this.gridWrapEl.style.alignItems = 'center';
      this.gridWrapEl.style.overflowY = 'visible';
      this._renderBuyGrid();
    } else {
      this.gridWrapEl.style.alignItems = 'flex-start';
      this.gridWrapEl.style.overflowY = 'auto';
      this._renderSellGrid();
    }
    this._renderHeaderState();
  }

  _cellBase(extra = {}) {
    return createEl('div', {
      class: ['shop-cell'],
      style: { minWidth: '0', ...extra },
      parent: this.gridEl,
    });
  }

  /** 空格（已售出 / 魔法商店空位）：§16.21「买完该格即空」、§16.22「留 2 个空格」 */
  _emptyCell() {
    const cell = this._cellBase();
    cell.classList.add('empty');
    cell.setAttribute('data-shop-empty', '1');
    return cell;
  }

  /** 格内三要素：顶部小字名称 / 居中图标 / 右下角金币图标+价格（§16.21，不显示描述） */
  _fillCell(cell, { id, name, emoji, price }) {
    createEl('div', { class: ['shop-cell-name'], text: name, parent: cell });
    cell.appendChild(iconEl('items', id, {
      def: ITEMS[id], fallback: emoji, size: '34px',
      style: { marginTop: '8px' },
    }));
    const priceEl = createEl('div', { class: ['shop-cell-price'], parent: cell });
    priceEl.appendChild(iconEl('ui', 'gold', { size: '12px', fallback: '🪙' }));
    createEl('span', { text: price != null ? String(price) : '—', parent: priceEl });
  }

  _renderBuyGrid() {
    const shop = getShop(this.gs, this.tileIdx);
    if (!shop) return;
    const slots = SHOP_KINDS[shop.kind].slots;
    // 4 列 × 3 行共 12 位；魔法商店只有 10 格商品，多余 2 格渲染为空格（§16.22）
    const total = Math.max(slots, 12);

    for (let i = 0; i < total; i++) {
      const item = i < slots ? shop.stock[i] : null;
      if (!item || item.sold) { this._emptyCell(); continue; }

      const cell = this._cellBase();
      // 格上价格 = 实付价（含折扣/祝福减免），与详情弹窗口径一致
      this._fillCell(cell, {
        id: item.id, name: item.name, emoji: item.emoji,
        price: effectivePrice(this.gs, item),
      });
      cell.onclick = () => this._openDetail({ mode: 'buy', item, slotIdx: i });
    }
  }

  _renderSellGrid() {
    const entries = (this.gs.inventory.items || []).filter((e) => e.qty > 0);
    if (entries.length === 0) {
      createEl('div', {
        text: '背包是空的',
        style: { gridColumn: '1 / -1', padding: '20px', textAlign: 'center', opacity: '0.6' },
        parent: this.gridEl,
      });
      return;
    }
    entries.forEach((entry) => {
      const def = ITEMS[entry.itemId] || {};
      const price = entry.value ?? def.value ?? 0;
      // §16.21：背包格同样只显示图标、名称、回收价；不可售的灰化发生在详情「售卖」按钮
      const cell = this._cellBase();
      this._fillCell(cell, {
        id: entry.itemId, name: def.name || entry.itemId, emoji: def.emoji, price,
      });
      cell.onclick = () => this._openDetail({
        mode: 'sell',
        item: { ...def, id: entry.itemId, price },
        value: entry.value,
      });
    });
  }

  // ────────────────────────────────────────── 详情弹窗
  _openDetail({ mode, item, slotIdx, value }) {
    this._closeDetail();
    const host = this.cardEl;
    if (!host) return;

    const mask = createEl('div', {
      style: {
        position: 'absolute', inset: '0', background: 'rgba(0,0,0,0.42)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: '20', borderRadius: UI.radius,
      },
      parent: host,
    });
    this.detailEl = mask;

    const box = createEl('div', {
      style: {
        width: 'min(380px, 78%)', background: UI.cream, border: UI.border,
        borderRadius: '12px', padding: '14px', display: 'flex',
        flexDirection: 'column', gap: '9px',
      },
      parent: mask,
    });

    const head = createEl('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' }, parent: box });
    head.appendChild(iconEl('items', item.id, {
      def: ITEMS[item.id], fallback: item.emoji, size: '38px',
    }));
    const info = createEl('div', { style: { flex: '1', minWidth: '0' }, parent: head });
    createEl('div', { text: item.name || item.id, style: { fontSize: '16px', fontWeight: '800' }, parent: info });
    const pay = mode === 'buy' ? effectivePrice(this.gs, item) : (item.price ?? 0);
    createEl('div', {
      text: mode === 'buy' ? `买价 🪙 ${pay}` : `回收价 🪙 ${pay}`,
      style: { fontSize: '12.5px', color: '#8a5a10', fontWeight: '800', marginTop: '2px' },
      parent: info,
    });

    createEl('div', {
      text: (ITEMS[item.id]?.description || item.description || '').replace(/\n/g, ' '),
      style: { fontSize: '12px', lineHeight: '1.55', maxHeight: '108px', overflowY: 'auto', opacity: '0.92' },
      parent: box,
    });

    const btns = createEl('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px' }, parent: box });
    const cancel = createEl('button', {
      text: '取消',
      style: {
        padding: '6px 18px', borderRadius: '7px', border: '2px solid #3a3a3a',
        background: '#fffbe6', cursor: 'pointer', fontWeight: '700', fontSize: '13px',
      },
      parent: btns,
    });
    cancel.onclick = () => this._closeDetail();

    const ok = createEl('button', {
      text: mode === 'buy' ? '购买' : '售卖',
      style: {
        padding: '6px 22px', borderRadius: '7px', border: '2px solid #3a3a3a',
        background: 'linear-gradient(135deg,#8ed36b,#4fae3f)', color: '#fff',
        cursor: 'pointer', fontWeight: '800', fontSize: '13px',
      },
      parent: btns,
    });
    // §16.21：金币不足时「购买」灰化；不可出售物品「售卖」灰化
    const blocked = mode === 'buy'
      ? this.gs.player.gold < pay
      : !isSellable(item.id);
    if (blocked) {
      ok.disabled = true;
      ok.style.background = '#d8d2c4';
      ok.style.color = '#9a938a';
      ok.style.cursor = 'default';
    } else {
      ok.onclick = () => {
        const res = mode === 'buy'
          ? buy(this.gs, this.tileIdx, slotIdx)
          : sell(this.gs, item.id, value !== undefined ? { value } : {});
        if (res.ok) {
          this._closeDetail();
          this._render();
        }
      };
    }
  }

  _closeDetail() {
    if (this.detailEl) {
      this.detailEl.remove();
      this.detailEl = null;
    }
  }

  /** 详情弹窗的 ESC：弹窗开着时 ESC 只关弹窗，不关商店（§16.21） */
  _bindEsc() {
    if (this._escHandler) return;
    this._escHandler = (e) => {
      if (e.key !== 'Escape') return;
      if (!this.visible || !this.detailEl) return;
      // 商店之上还叠着设置 / 其它二级界面时，交给 GameDirector 的中央层级逻辑
      if (this.director?.settingsPanel?.visible) return;
      const stack = this.director?.openPanels || [];
      if (stack.length && stack[stack.length - 1] !== 'shop') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this._closeDetail();
    };
    window.addEventListener('keydown', this._escHandler, true);
  }
}

export default ShopPanel;
