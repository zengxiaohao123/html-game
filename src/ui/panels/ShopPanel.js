// src/ui/panels/ShopPanel.js
// 商店 / 魔法商店页面（设计文档 v0.5 §16.21 / §16.22）
//
// 布局（三行结构，全部用 flex 排版，不使用绝对定位，杜绝互相压盖）：
//   ┌──────────┬───────────────────────────────────┐
//   │          │ [🔄刷新] [🪙金币]      [售卖][购买] │
//   │ 商人立绘 │ ┌────┬────┬────┬────┐             │
//   │ (26% 宽) │ │ 商品格 ×12（4 列 × 3 行）        │
//   │ +对话框  │ └────┴────┴────┴────┘             │
//   │          │                          [离开]   │
//   └──────────┴───────────────────────────────────┘
//
// 与 §16.21 的一处差异：刷新按钮由"悬浮在立绘右上方"改为右栏标题行首位。
// 悬浮方案会压住第一行商品格，实测重叠明显；放在标题行仍处于"立绘右上方"的语义位置。
//
// 行为：购买每格仅 1 件；售卖价 = 物品价值；刷新 4/8/12 每周 3 次；
//       周一自动刷新；离店本回合禁入；不遮挡顶栏与快捷栏。

import { EventBus } from '../../core/EventBus.js';
import { GE } from '../../core/GameEvents.js';
import { createEl, qs } from '../dom.js';
import { devLog } from '../../core/Logger.js';
import { ITEMS } from '../../data/items.js';
import {
  SHOP_KINDS, getShop, enterShop, leaveShop, buy, sell,
  refreshShop, manualRefreshCost, refreshLeft, isSellable, effectivePrice,
} from '../../systems/ShopSystem.js';

/** 商人立绘占位（美术未到位时用 emoji + 对话框） */
const MERCHANT = {
  shop: { emoji: '🧑‍🌾', name: '杂货商人', line: '看看有什么需要的吧，都是好东西。' },
  magic: { emoji: '🧙', name: '魔法商人', line: '魔导书和技能石……你确定付得起吗？' },
};

const UI = {
  border: '3px solid #3a3a3a',
  radius: '14px',
  cream: '#fffbf0',
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
    this.goldEl = null;
    this.refreshBtn = null;
  }

  get gs() { return this.director.getGS(); }

  mount() {
    this.root = createEl('div', {
      style: {
        position: 'fixed',
        left: '0', right: '0',
        top: '68px',            // 让出顶部 UI
        bottom: '98px',         // 让出底部快捷栏
        zIndex: '5500',
        display: 'none',
        padding: '0 16px',
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
    EventBus.on(GE.GOLD_CHANGE, () => { if (this.visible) this._renderGold(); });
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

    const card = createEl('div', {
      style: {
        height: '100%', display: 'flex', minHeight: '0',
        background: 'linear-gradient(135deg,#fffbf0 0%,#fff3c4 100%)',
        border: UI.border, borderRadius: UI.radius,
        boxShadow: '0 8px 24px rgba(0,0,0,0.32)',
        overflow: 'hidden',
      },
      parent: root,
    });

    this._renderMerchant(card);

    const right = createEl('div', {
      style: {
        flex: '1', display: 'flex', flexDirection: 'column',
        padding: '10px 14px 12px', gap: '8px', minWidth: '0', minHeight: '0',
      },
      parent: card,
    });
    this._renderHeader(right);

    this.gridEl = createEl('div', {
      style: {
        flex: '1', minHeight: '0', overflowY: 'auto',
        display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
        gridAutoRows: '86px', gap: '8px', alignContent: 'start',
      },
      parent: right,
    });

    const foot = createEl('div', {
      style: { display: 'flex', justifyContent: 'flex-end', flexShrink: '0' },
      parent: right,
    });
    const leave = createEl('button', {
      text: '离开',
      style: {
        padding: '7px 30px', borderRadius: '9px', border: '2px solid #3a3a3a',
        background: 'linear-gradient(135deg,#ffd5d5,#f3a3a3)', cursor: 'pointer',
        fontWeight: '800', fontSize: '14px', color: '#5a2020',
      },
      parent: foot,
    });
    leave.onclick = () => this.close();

    this._renderGrid();
  }

  _renderMerchant(card) {
    const m = MERCHANT[this.kind] || MERCHANT.shop;
    const col = createEl('div', {
      style: {
        width: '26%', minWidth: '168px', maxWidth: '240px',
        borderRight: UI.border,
        background: 'linear-gradient(180deg,#e8d3a9 0%,#d9bd8c 100%)',
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
        overflow: 'hidden',
      },
      parent: card,
    });
    createEl('div', {
      style: {
        flex: '1', minHeight: '0', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        fontSize: 'clamp(56px, 7vw, 92px)', lineHeight: '1', userSelect: 'none',
      },
      text: m.emoji, parent: col,
    });
    const dlg = createEl('div', {
      style: {
        margin: '0 8px 8px', padding: '8px 10px',
        background: '#fffbe6', border: '2px solid #3a3a3a', borderRadius: '10px',
        fontSize: '12.5px', lineHeight: '1.45',
      },
      parent: col,
    });
    createEl('div', { text: m.name, style: { fontWeight: '800', marginBottom: '2px' }, parent: dlg });
    createEl('div', { text: m.line, style: { opacity: '0.9' }, parent: dlg });
  }

  /** 标题行：[刷新] [金币] ←→ [售卖][购买] */
  _renderHeader(right) {
    const bar = createEl('div', {
      style: { display: 'flex', alignItems: 'center', gap: '8px', flexShrink: '0' },
      parent: right,
    });

    this.refreshBtn = createEl('button', {
      style: {
        display: 'flex', alignItems: 'center', gap: '6px',
        padding: '6px 14px', borderRadius: '999px', cursor: 'pointer',
        border: '2px solid #3a3a3a', background: '#fffbe6',
        fontSize: '13px', fontWeight: '800', color: '#3a2e20', whiteSpace: 'nowrap',
      },
      parent: bar,
    });
    this.refreshBtn.onclick = () => {
      const res = refreshShop(this.gs, this.tileIdx);
      if (res.ok) this._render();
      else this._renderHeaderState();
    };

    this.goldEl = createEl('div', {
      style: {
        padding: '5px 14px', borderRadius: '999px',
        background: 'linear-gradient(135deg,#fff6c0,#f7d674)', border: '2px solid #c07a20',
        fontWeight: '800', color: '#8a5a10', fontSize: '13.5px', whiteSpace: 'nowrap',
      },
      parent: bar,
    });

    createEl('div', { style: { flex: '1' }, parent: bar });

    for (const [key, label] of [['sell', '售卖'], ['buy', '购买']]) {
      const active = this.tab === key;
      const btn = createEl('button', {
        text: label,
        style: {
          padding: '6px 22px', borderRadius: '999px', cursor: 'pointer',
          border: '2px solid #3a3a3a', fontWeight: '800', fontSize: '13.5px',
          background: active ? 'linear-gradient(135deg,#8ed36b,#4fae3f)' : '#fffbe6',
          color: active ? '#fff' : '#3a2e20',
        },
        parent: bar,
      });
      btn.onclick = () => { this.tab = key; this._render(); };
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
        text: cost === null ? '刷新（已用完）' : `刷新 ${cost}`,
        parent: this.refreshBtn,
      });
      createEl('span', {
        text: `剩 ${left} 次`,
        style: { fontSize: '11px', opacity: '0.7', fontWeight: '700' },
        parent: this.refreshBtn,
      });
      this.refreshBtn.disabled = cost === null;
      this.refreshBtn.style.opacity = cost === null ? '0.5' : '1';
      this.refreshBtn.style.cursor = cost === null ? 'default' : 'pointer';
    }
    this._renderGold();
  }

  _renderGold() {
    if (this.goldEl) this.goldEl.textContent = `🪙 ${this.gs.player.gold}`;
  }

  // ────────────────────────────────────────── 网格
  _renderGrid() {
    if (!this.gridEl) return;
    this.gridEl.innerHTML = '';
    if (this.tab === 'buy') this._renderBuyGrid();
    else this._renderSellGrid();
    this._renderHeaderState();
  }

  _cellBase(extra = {}) {
    return createEl('div', {
      style: {
        position: 'relative', border: '2px solid #3a3a3a', borderRadius: '9px',
        background: '#fffdf5', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '2px', minWidth: '0', overflow: 'hidden', ...extra,
      },
      parent: this.gridEl,
    });
  }

  _renderBuyGrid() {
    const shop = getShop(this.gs, this.tileIdx);
    if (!shop) return;
    const slots = SHOP_KINDS[shop.kind].slots;
    // 商品是固定的 3 行，垂直居中比顶对齐更稳（不会出现下方大片空白）
    this.gridEl.style.alignContent = 'center';

    for (let i = 0; i < slots; i++) {
      const item = shop.stock[i];
      const sold = !item || item.sold;
      const cell = this._cellBase({
        cursor: sold ? 'default' : 'pointer',
        background: sold ? 'rgba(0,0,0,0.05)' : '#fffdf5',
        opacity: sold ? '0.4' : '1',
      });
      if (!item) continue;

      createEl('div', {
        text: item.name,
        style: {
          position: 'absolute', top: '3px', left: '4px', right: '4px',
          fontSize: '10.5px', fontWeight: '800', textAlign: 'center',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        },
        parent: cell,
      });
      createEl('div', {
        text: item.emoji || '❓',
        style: { fontSize: '27px', lineHeight: '1', marginTop: '6px' },
        parent: cell,
      });
      createEl('div', {
        text: item.price != null ? `🪙${item.price}` : '—',
        style: {
          position: 'absolute', bottom: '3px', right: '5px',
          fontSize: '11px', fontWeight: '800',
          color: item.discounted ? '#c0392b' : '#8a5a10',
        },
        parent: cell,
      });
      if (item.discounted) {
        createEl('div', {
          text: '折',
          style: {
            position: 'absolute', top: '2px', right: '3px', fontSize: '9px',
            background: '#e74c3c', color: '#fff', borderRadius: '4px', padding: '0 3px',
          },
          parent: cell,
        });
      }
      if (item.sold) {
        createEl('div', {
          text: '已售出',
          style: {
            position: 'absolute', inset: '0', display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontWeight: '800', color: '#a33', fontSize: '12px',
          },
          parent: cell,
        });
      } else {
        cell.onclick = () => this._openDetail({ mode: 'buy', item, slotIdx: i });
      }
    }
  }

  _renderSellGrid() {
    this.gridEl.style.alignContent = 'start';   // 售卖列表条目不定，改成顶对齐 + 滚动
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
      const sellable = isSellable(entry.itemId);
      const cell = this._cellBase({
        cursor: sellable ? 'pointer' : 'default',
        opacity: sellable ? '1' : '0.45',
      });

      createEl('div', {
        text: def.name || entry.itemId,
        style: {
          position: 'absolute', top: '3px', left: '4px', right: '4px',
          fontSize: '10.5px', fontWeight: '800', textAlign: 'center',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        },
        parent: cell,
      });
      createEl('div', {
        text: def.emoji || '❓',
        style: { fontSize: '26px', lineHeight: '1', marginTop: '6px' },
        parent: cell,
      });
      createEl('div', {
        text: `×${entry.qty}`,
        style: { position: 'absolute', bottom: '3px', left: '5px', fontSize: '10.5px', fontWeight: '800' },
        parent: cell,
      });
      createEl('div', {
        text: sellable ? `🪙${price}` : '不可售',
        style: {
          position: 'absolute', bottom: '3px', right: '5px',
          fontSize: '10.5px', fontWeight: '800', color: sellable ? '#8a5a10' : '#a33',
        },
        parent: cell,
      });
      if (sellable) {
        cell.onclick = () => this._openDetail({
          mode: 'sell',
          item: { ...def, id: entry.itemId, price },
          value: entry.value,
        });
      }
    });
  }

  // ────────────────────────────────────────── 详情弹窗
  _openDetail({ mode, item, slotIdx, value }) {
    this._closeDetail();
    const host = this.root.firstChild;
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
        width: 'min(360px, 78%)', background: UI.cream, border: UI.border,
        borderRadius: '12px', padding: '14px', display: 'flex',
        flexDirection: 'column', gap: '9px',
      },
      parent: mask,
    });

    const head = createEl('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' }, parent: box });
    createEl('div', { text: item.emoji || '❓', style: { fontSize: '38px', lineHeight: '1' }, parent: head });
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

  _closeDetail() {
    if (this.detailEl) {
      this.detailEl.remove();
      this.detailEl = null;
    }
  }
}

export default ShopPanel;
