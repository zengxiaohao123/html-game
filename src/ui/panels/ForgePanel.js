// src/ui/panels/ForgePanel.js
// Phase 4 —— 合成页面
// 配方内嵌（不新建数据文件）
// 选中配方 → 检查材料 → DialogBox 确认 → 扣材料 + 加产出 → emit FORGE_COMPLETE

import { EventBus } from '../../core/EventBus.js';
import { GE } from '../../core/GameEvents.js';
import { ITEMS } from '../../data/items.js';
import { InventorySystem } from '../../systems/InventorySystem.js';
import { createEl, qs } from '../dom.js';
import { devLog } from '../../core/Logger.js';

/**
 * 合成配方表（Phase 4 内嵌，后续可移入 data/forges.js）
 * 每个配方：
 *   { id, name, emoji, inputs: [{itemId, qty}], output: {itemId, qty}, desc }
 */
const RECIPES = [
  {
    id: 'recipe_pea',
    name: '堆肥 → 豌豆',
    emoji: '🫛',
    inputs: [
      { itemId: 'item_wheat', qty: 2 },
      { itemId: 'item_rice_straw', qty: 2 },
    ],
    output: { itemId: 'item_pea', qty: 1 },
    desc: '2 小麦 + 2 稻草 → 1 豌豆（堆肥催生）',
  },
  {
    id: 'recipe_meat',
    name: '土豆 + 草莓 → 烤串',
    emoji: '🍖',
    inputs: [
      { itemId: 'item_potato', qty: 2 },
      { itemId: 'item_strawberry', qty: 1 },
    ],
    output: { itemId: 'item_raw_meat', qty: 1 },
    desc: '2 土豆 + 1 草莓 → 1 生肉（黑暗料理）',
  },
  {
    id: 'recipe_gel',
    name: '鸡蛋 + 小麦 → 史莱姆胶',
    emoji: '🟢',
    inputs: [
      { itemId: 'item_egg', qty: 1 },
      { itemId: 'item_wheat', qty: 1 },
    ],
    output: { itemId: 'item_slime_gel', qty: 1 },
    desc: '1 鸡蛋 + 1 小麦 → 1 史莱姆胶（人工养殖）',
  },
];

function itemName(id) { return ITEMS[id]?.name || id; }
function itemEmoji(id) { return ITEMS[id]?.emoji || '❓'; }

function canCraft(gs, recipe) {
  for (const inp of recipe.inputs) {
    if (InventorySystem.countItem(gs, inp.itemId) < inp.qty) return false;
  }
  return true;
}

export class ForgePanel {
  constructor(director) {
    this.director = director;
    this.mask = null;
    this.panel = null;
    this.listEl = null;
    this.detailEl = null;
    this.selectedRecipeIdx = null;
    this.visible = false;
  }

  mount(parent = qs('body')) {
    this.mask = createEl('div', {
      class: ['panel-mask'], parent,
      onclick: (e) => { if (e.target === this.mask) this.hide(); },
    });

    this.panel = createEl('div', {
      class: ['panel-card', 'forge-panel'],
      style: {
        width: 'min(680px, 94vw)', maxHeight: 'min(620px, 86vh)',
        padding: '14px 16px',
        display: 'flex', flexDirection: 'column', gap: '12px',
      },
      parent: this.mask,
    });

    const head = createEl('div', {
      style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
      parent: this.panel,
    });
    createEl('div', {
      style: { fontSize: '20px', fontWeight: '700', color: '#3a2e20' },
      text: '⚒️ 合成（L 切换）', parent: head,
    });
    createEl('button', {
      class: 'inventory-close', text: '✖', parent: head,
      onclick: () => this.hide(),
    });

    const body = createEl('div', {
      style: { flex: '1', minHeight: '0', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
      parent: this.panel,
    });

    this.listEl = createEl('div', {
      style: { padding: '8px', background: 'rgba(255,255,255,0.55)', border: '2px solid #b8a888', borderRadius: '14px', overflowY: 'auto' },
      parent: body,
    });
    this.detailEl = createEl('div', {
      style: { padding: '12px', background: 'linear-gradient(135deg, #fffaf0 0%, #fff3c4 100%)', border: '2px solid #b8a888', borderRadius: '14px', display: 'flex', flexDirection: 'column', gap: '10px' },
      parent: body,
    });

    // 底部关闭按钮
    const foot = createEl('div', {
      style: { display: 'flex', justifyContent: 'flex-end', borderTop: '2px dashed #b8a888', paddingTop: '10px', flexShrink: 0 },
      parent: this.panel,
    });
    createEl('button', {
      class: 'action-btn', text: '关闭', parent: foot,
      onclick: () => this.hide(),
    });

    this._subscribeEvents();
    this.mask.style.display = 'none';
  }

  _refresh() {
    this._renderList();
    this._renderDetail();
  }

  _renderList() {
    this.listEl.innerHTML = '';
    const gs = this._getGS();
    RECIPES.forEach((r, idx) => {
      const ok = gs ? canCraft(gs, r) : false;
      const sel = this.selectedRecipeIdx === idx;
      const row = createEl('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: '10px', padding: '10px',
          marginBottom: '6px',
          background: sel ? '#ffe099' : (ok ? 'rgba(255,255,255,0.8)' : 'rgba(240,240,240,0.7)'),
          border: sel ? '3px solid #e8a900' : '2px solid #b8a888',
          borderRadius: '10px', cursor: 'pointer',
          opacity: ok ? 1 : 0.7,
          transition: 'border-color 0.1s',
        },
        parent: this.listEl,
      });
      createEl('div', {
        style: { fontSize: '28px', fontFamily: '"Segoe UI Emoji",sans-serif', width: '36px', textAlign: 'center' },
        text: r.emoji, parent: row,
      });
      const info = createEl('div', { style: { flex: '1' }, parent: row });
      createEl('div', { style: { fontWeight: '700', color: '#3a2e20', fontSize: '13px' }, text: r.name, parent: info });
      const mat = r.inputs.map(i => `${itemEmoji(i.itemId)}${i.qty}`).join(' + ');
      const out = `${itemEmoji(r.output.itemId)}×${r.output.qty}`;
      createEl('div', { style: { fontSize: '11px', color: '#7a6a56' }, text: `${mat} → ${out}`, parent: info });

      row.addEventListener('click', () => {
        this.selectedRecipeIdx = idx;
        this._refresh();
      });
    });
  }

  _renderDetail() {
    this.detailEl.innerHTML = '';
    if (this.selectedRecipeIdx === null) {
      createEl('div', {
        style: { color: '#b0a090', fontSize: '13px', textAlign: 'center', padding: '40px 10px', fontStyle: 'italic' },
        text: '← 点击左侧配方查看详情',
        parent: this.detailEl,
      });
      return;
    }
    const r = RECIPES[this.selectedRecipeIdx];
    const gs = this._getGS();
    const ok = gs ? canCraft(gs, r) : false;

    // 标题
    const topRow = createEl('div', {
      style: { display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '2px solid #e8a900', paddingBottom: '8px' },
      parent: this.detailEl,
    });
    createEl('div', {
      style: { fontSize: '34px', fontFamily: '"Segoe UI Emoji",sans-serif' },
      text: r.emoji, parent: topRow,
    });
    const topR = createEl('div', { style: { flex: '1' }, parent: topRow });
    createEl('div', { style: { fontWeight: '700', fontSize: '16px', color: '#3a2e20' }, text: r.name, parent: topR });
    createEl('div', { style: { fontSize: '12px', color: '#7a6a56' }, text: r.desc, parent: topR });

    // 材料清单
    createEl('div', { style: { fontSize: '12px', fontWeight: '700', color: '#5a4a3a' }, text: '🧾 所需材料', parent: this.detailEl });
    r.inputs.forEach((inp) => {
      const have = gs ? InventorySystem.countItem(gs, inp.itemId) : 0;
      const enough = have >= inp.qty;
      const row = createEl('div', {
        style: { display: 'flex', justifyContent: 'space-between', fontSize: '13px', padding: '2px 0' },
        parent: this.detailEl,
      });
      createEl('span', { style: { color: '#3a2e20' }, text: `${itemEmoji(inp.itemId)} ${itemName(inp.itemId)} ×${inp.qty}`, parent: row });
      createEl('span', {
        style: { color: enough ? '#2a8a3a' : '#c0392b', fontWeight: '700' },
        text: `${have} / ${inp.qty}`, parent: row,
      });
    });

    // 产出
    createEl('div', { style: { fontSize: '12px', fontWeight: '700', color: '#5a4a3a', marginTop: '4px' }, text: '🎁 产出', parent: this.detailEl });
    createEl('div', {
      style: { fontSize: '14px', color: '#3a2e20', fontWeight: '700' },
      text: `${itemEmoji(r.output.itemId)} ${itemName(r.output.itemId)} ×${r.output.qty}`,
      parent: this.detailEl,
    });

    // 合成按钮
    const btnRow = createEl('div', {
      style: { marginTop: 'auto', display: 'flex', gap: '8px', justifyContent: 'flex-end', paddingTop: '8px', borderTop: '2px dashed #b8a888' },
      parent: this.detailEl,
    });
    createEl('button', {
      class: 'action-btn', text: '关闭', parent: btnRow,
      onclick: () => this.hide(),
    });
    const craftBtn = createEl('button', {
      class: 'action-btn', text: '⚒️ 合成', parent: btnRow,
      onclick: () => this._craftConfirm(),
    });
    if (!ok) { craftBtn.disabled = true; }
  }

  _craftConfirm() {
    const r = RECIPES[this.selectedRecipeIdx];
    if (!r) return;
    // DialogBox 二次确认（验收场景之一）
    const inputsStr = r.inputs.map(i => `${itemEmoji(i.itemId)}${itemName(i.itemId)}×${i.qty}`).join(' + ');
    EventBus.emit(GE.DIALOG_SHOW, {
      title: '确认合成？',
      content: `${inputsStr}\n  →\n${itemEmoji(r.output.itemId)} ${itemName(r.output.itemId)} ×${r.output.qty}`,
      options: [
        { label: '取消', onSelect: () => {} },
        { label: '确定合成', onSelect: () => this._doCraft(r) },
      ],
    });
  }

  _doCraft(r) {
    const gs = this._getGS();
    if (!gs) return;
    if (!canCraft(gs, r)) {
      EventBus.emit(GE.TOAST_SHOW, { text: '⚠️ 材料不足', duration: 1500 });
      return;
    }
    // 扣材料
    for (const inp of r.inputs) {
      InventorySystem.removeItem(gs, inp.itemId, inp.qty);
    }
    // 加产出
    InventorySystem.addItem(gs, r.output.itemId, r.output.qty);
    EventBus.emit(GE.FORGE_COMPLETE, { recipeId: r.id, output: r.output });
    EventBus.emit(GE.TOAST_SHOW, {
      text: `⚒️ 合成成功：${itemEmoji(r.output.itemId)} ${itemName(r.output.itemId)} ×${r.output.qty}`,
      duration: 1800,
    });
    devLog.info('[ForgePanel] FORGE_COMPLETE', r.id);
    this._refresh();
  }

  _subscribeEvents() {
    EventBus.on(GE.UI_PANEL_OPEN, ({ panel }) => {
      if (panel === 'settings' && this.visible) this.hide();
      if (panel === 'forge') this.toggle();
    });
    EventBus.on(GE.UI_PANEL_CLOSE, ({ panel }) => {
      if (panel === 'forge' && this.visible) this.hide();
    });
    EventBus.on(GE.INVENTORY_CHANGE, () => { if (this.visible) this._refresh(); });
    EventBus.on(GE.STATE_RESET, () => { if (this.visible) this._refresh(); });
  }

  show() {
    if (!this.mask || this.visible) return;
    this.visible = true;
    this.mask.style.display = 'flex';
    const gs = this._getGS();
    if (gs) { gs.uiState = gs.uiState || {}; gs.uiState.activePanel = 'forge'; }
    this._refresh();
  }
  hide() {
    if (!this.mask || !this.visible) return;
    this.visible = false;
    this.mask.style.display = 'none';
    const gs = this._getGS();
    if (gs && gs.uiState && gs.uiState.activePanel === 'forge') gs.uiState.activePanel = null;
    EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'forge' });
  }
  toggle() { this.visible ? this.hide() : this.show(); }

  _getGS() {
    if (this.director?.getGS) return this.director.getGS();
    if (window.__gameDirector?.getGS) return window.__gameDirector.getGS();
    return null;
  }
}

export default ForgePanel;
