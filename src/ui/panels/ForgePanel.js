// ForgePanel.js —— Phase 4 重写（对接 ForgeSystem）  ·  快捷键 F
// 配方来自 ForgeSystem.getAllRecipes()，字段 ingredients / outputs（复数）
// 合成调 ForgeSystem.craft(gs, recipeId)，含巧手返原材料
// 材料检查调 ForgeSystem.canCraft(gs, recipeId)
// 外观严格套 InventoryPanel 模板（_panelHelper）

import { EventBus } from '../../core/EventBus.js';
import { GE } from '../../core/GameEvents.js';
import { ITEMS } from '../../data/items.js';
import { ForgeSystem } from '../../systems/ForgeSystem.js';
import { InventorySystem } from '../../systems/InventorySystem.js';
import { createStandardPanel } from './_panelHelper.js';
import { createEl } from '../dom.js';
import { devLog } from '../../core/Logger.js';

function itName(id) { return ITEMS[id]?.name || id; }
function itEmoji(id) { return ITEMS[id]?.emoji || '❓'; }

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
    const recipes = ForgeSystem.getAllRecipes();

    this.listEl.innerHTML = '';
    recipes.forEach((r, i) => {
      const ok = gs ? ForgeSystem.canCraft(gs, r.id) : false;
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
      // r.ingredients（复数，数组）
      const mat = r.ingredients.map(inp => `${itEmoji(inp.itemId)}×${inp.qty}`).join(' + ');
      // r.outputs（复数，数组，遍历显示）
      const outStr = r.outputs.map(o => `${itEmoji(o.itemId)}×${o.qty}`).join(' + ');
      createEl('div', { style: { fontSize: '11px', color: '#7a6a56' }, text: `${mat} → ${outStr}`, parent: info });
      row.addEventListener('click', () => { this.selectedIdx = i; this._refresh(); });
    });

    this.detailEl.innerHTML = '';
    if (this.selectedIdx === null || this.selectedIdx >= recipes.length) {
      createEl('div', { style: { color: '#b0a090', fontSize: '13px', textAlign: 'center', padding: '40px 10px', fontStyle: 'italic' }, text: '← 点击左侧配方查看详情', parent: this.detailEl });
      return;
    }
    const r = recipes[this.selectedIdx];
    createEl('div', { style: { fontSize: '22px', fontWeight: '900', borderBottom: '2px solid #3a3a3a', paddingBottom: '4px' }, text: `${r.emoji}  ${r.name}`, parent: this.detailEl });
    createEl('div', { style: { fontSize: '12px', color: '#8a7a66' }, text: r.description || '', parent: this.detailEl });

    createEl('div', { style: { fontSize: '12px', fontWeight: '700', color: '#5a4a3a', marginTop: '4px' }, text: '🧾 所需材料', parent: this.detailEl });
    r.ingredients.forEach((inp) => {
      const have = gs ? InventorySystem.countItem(gs, inp.itemId) : 0;
      const enough = have >= inp.qty;
      const row = createEl('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '13px' }, parent: this.detailEl });
      createEl('span', { text: `${itEmoji(inp.itemId)} ${itName(inp.itemId)} ×${inp.qty}`, parent: row });
      createEl('span', { style: { color: enough ? '#2a8a3a' : '#c0392b', fontWeight: '800' }, text: `${have} / ${inp.qty}`, parent: row });
    });

    createEl('div', { style: { fontSize: '12px', fontWeight: '700', color: '#5a4a3a', marginTop: '6px' }, text: '🎁 产出', parent: this.detailEl });
    r.outputs.forEach((o) => {
      createEl('div', { style: { fontSize: '14px', fontWeight: '900' }, text: `${itEmoji(o.itemId)} ${itName(o.itemId)} ×${o.qty}`, parent: this.detailEl });
    });
  }

  _craft() {
    if (this.selectedIdx === null) return;
    const gs = this._getGS();
    if (!gs) return;
    const recipes = ForgeSystem.getAllRecipes();
    const r = recipes[this.selectedIdx];
    if (!r) return;

    if (!ForgeSystem.canCraft(gs, r.id)) {
      // ForgeSystem.canCraft 不会发 Toast，craft 内部会发"材料不足"
      ForgeSystem.craft(gs, r.id);
      return;
    }

    EventBus.emit(GE.DIALOG_SHOW, {
      title: '确认合成？',
      content: `${r.ingredients.map(inp => `${itEmoji(inp.itemId)} ${itName(inp.itemId)}×${inp.qty}`).join(' + ')}\n  →\n${r.outputs.map(o => `${itEmoji(o.itemId)} ${itName(o.itemId)} ×${o.qty}`).join(' + ')}`,
      options: [
        { label: '取消', onSelect: () => {} },
        { label: '确定合成', onSelect: () => {
          const result = ForgeSystem.craft(gs, r.id);
          if (result.ok) {
            devLog.info('[ForgePanel] FORGE_COMPLETE', r.id);
          }
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
