// ForgePanel.js —— Phase 4 重写  ·  快捷键 F
// 内嵌 3 合成配方表（不新建 data 文件）
// 选中配方 → DialogBox 确认 → InventorySystem.removeItem/addItem + emit GE.FORGE_COMPLETE
// 外观严格套 InventoryPanel 模板（_panelHelper）

import { EventBus } from '../../core/EventBus.js';
import { GE } from '../../core/GameEvents.js';
import { ITEMS } from '../../data/items.js';
import { InventorySystem } from '../../systems/InventorySystem.js';
import { createStandardPanel } from './_panelHelper.js';
import { createEl, qs } from '../dom.js';
import { devLog } from '../../core/Logger.js';

const RECIPES = [
  { id: 'recipe_pea',  name: '堆肥 → 豌豆',        emoji: '🫛', inputs: [{ itemId: 'item_wheat', qty: 2 }, { itemId: 'item_rice_straw', qty: 2 }], output: { itemId: 'item_pea', qty: 1 }, desc: '2 小麦 + 2 稻草 → 1 豌豆' },
  { id: 'recipe_meat', name: '土豆 + 草莓 → 烤串', emoji: '🍖', inputs: [{ itemId: 'item_potato', qty: 2 }, { itemId: 'item_strawberry', qty: 1 }], output: { itemId: 'item_raw_meat', qty: 1 }, desc: '2 土豆 + 1 草莓 → 1 生肉' },
  { id: 'recipe_gel',  name: '鸡蛋 + 小麦 → 史莱姆胶', emoji: '🟢', inputs: [{ itemId: 'item_egg', qty: 1 }, { itemId: 'item_wheat', qty: 1 }], output: { itemId: 'item_slime_gel', qty: 1 }, desc: '1 鸡蛋 + 1 小麦 → 1 史莱姆胶' },
];

function itName(id) { return ITEMS[id]?.name || id; }
function itEmoji(id) { return ITEMS[id]?.emoji || '❓'; }

function canCraft(gs, r) {
  for (const inp of r.inputs) {
    if (InventorySystem.countItem(gs, inp.itemId) < inp.qty) return false;
  }
  return true;
}

export class ForgePanel {
  constructor(director) {
    this.director = director;
    this.helper = null;
    this.listEl = null;
    this.detailEl = null;
    this.selectedIdx = null;
  }

  mount() {
    this.helper = createStandardPanel({
      title: '⚒️ 合成（F 切换）',
      panelKey: 'forge',
      width: 'min(92vw, 820px)',
      height: 'min(86vh, 680px)',
      onMount: (_p, body) => this._build(body),
    });
    this._subscribe();
  }

  _build(body) {
    const main = createEl('div', {
      style: { flex: '1', minHeight: '0', display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: '10px' },
      parent: body,
    });
    this.listEl = createEl('div', {
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
    createEl('button', { class: 'action-btn', text: '关闭', parent: foot, onclick: () => this.hide() });
    createEl('button', { class: 'action-btn', text: '⚒️ 合成', parent: foot, onclick: () => this._craft() });

    this._refresh();
  }

  _subscribe() {
    EventBus.on(GE.UI_PANEL_OPEN, ({ panel }) => { if (panel === 'forge') this.toggle(); });
    EventBus.on(GE.UI_PANEL_CLOSE, ({ panel }) => { if (panel === 'forge' && this.helper?.visible) this.helper.hide(); });
    EventBus.on(GE.INVENTORY_CHANGE, () => { if (this.helper?.visible) this._refresh(); });
  }

  _getGS() { return this.director?.getGS?.(); }

  _refresh() {
    const gs = this._getGS();

    this.listEl.innerHTML = '';
    RECIPES.forEach((r, i) => {
      const ok = gs ? canCraft(gs, r) : false;
      const sel = this.selectedIdx === i;
      const row = createEl('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', marginBottom: '6px',
          background: sel ? '#ffe099' : (ok ? 'rgba(255,255,255,0.8)' : 'rgba(240,240,240,0.7)'),
          border: sel ? '3px solid #e8a900' : '2px solid #b8a888', borderRadius: '10px', cursor: 'pointer', opacity: ok ? 1 : 0.7,
        },
        parent: this.listEl,
      });
      createEl('div', { style: { fontSize: '26px', width: '36px', textAlign: 'center' }, text: r.emoji, parent: row });
      const info = createEl('div', { style: { flex: '1' }, parent: row });
      createEl('div', { style: { fontWeight: '800', fontSize: '13px' }, text: r.name, parent: info });
      const mat = r.inputs.map(i => `${itEmoji(i.itemId)}×${i.qty}`).join(' + ');
      createEl('div', { style: { fontSize: '11px', color: '#7a6a56' }, text: `${mat} → ${itEmoji(r.output.itemId)}×${r.output.qty}`, parent: info });
      row.addEventListener('click', () => { this.selectedIdx = i; this._refresh(); });
    });

    this.detailEl.innerHTML = '';
    if (this.selectedIdx === null) {
      createEl('div', { style: { color: '#b0a090', fontSize: '13px', textAlign: 'center', padding: '40px 10px', fontStyle: 'italic' }, text: '← 点击左侧配方查看详情', parent: this.detailEl });
      return;
    }
    const r = RECIPES[this.selectedIdx];
    createEl('div', { style: { fontSize: '22px', fontWeight: '900', borderBottom: '2px solid #3a3a3a', paddingBottom: '4px' }, text: `${r.emoji}  ${r.name}`, parent: this.detailEl });
    createEl('div', { style: { fontSize: '12px', color: '#8a7a66' }, text: r.desc, parent: this.detailEl });
    createEl('div', { style: { fontSize: '12px', fontWeight: '700', color: '#5a4a3a', marginTop: '4px' }, text: '🧾 所需材料', parent: this.detailEl });
    r.inputs.forEach((inp) => {
      const have = gs ? InventorySystem.countItem(gs, inp.itemId) : 0;
      const enough = have >= inp.qty;
      const row = createEl('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '13px' }, parent: this.detailEl });
      createEl('span', { text: `${itEmoji(inp.itemId)} ${itName(inp.itemId)} ×${inp.qty}`, parent: row });
      createEl('span', { style: { color: enough ? '#2a8a3a' : '#c0392b', fontWeight: '800' }, text: `${have} / ${inp.qty}`, parent: row });
    });
    createEl('div', { style: { fontSize: '12px', fontWeight: '700', color: '#5a4a3a', marginTop: '6px' }, text: '🎁 产出', parent: this.detailEl });
    createEl('div', { style: { fontSize: '14px', fontWeight: '900' }, text: `${itEmoji(r.output.itemId)} ${itName(r.output.itemId)} ×${r.output.qty}`, parent: this.detailEl });
  }

  _craft() {
    if (this.selectedIdx === null) return;
    const r = RECIPES[this.selectedIdx];
    const gs = this._getGS();
    if (!gs || !canCraft(gs, r)) { EventBus.emit(GE.TOAST_SHOW, { text: '⚠️ 材料不足', duration: 1200 }); return; }
    EventBus.emit(GE.DIALOG_SHOW, {
      title: '确认合成？',
      content: `${r.inputs.map(i => `${itEmoji(i.itemId)} ${itName(i.itemId)}×${i.qty}`).join(' + ')}\n  →\n${itEmoji(r.output.itemId)} ${itName(r.output.itemId)} ×${r.output.qty}`,
      options: [
        { label: '取消', onSelect: () => {} },
        { label: '确定合成', onSelect: () => {
          for (const inp of r.inputs) InventorySystem.removeItem(gs, inp.itemId, inp.qty);
          InventorySystem.addItem(gs, r.output.itemId, r.output.qty);
          EventBus.emit(GE.FORGE_COMPLETE, { recipeId: r.id, output: r.output });
          EventBus.emit(GE.TOAST_SHOW, { text: `⚒️ 合成成功：${itEmoji(r.output.itemId)} ${itName(r.output.itemId)}×${r.output.qty}`, duration: 1400 });
          devLog.info('[ForgePanel] FORGE_COMPLETE', r.id);
          this._refresh();
        }},
      ],
    });
  }

  show() { this.helper?.show(); }
  hide() { this.helper?.hide(); }
  toggle() { this.helper?.toggle(); }
}

export default ForgePanel;
