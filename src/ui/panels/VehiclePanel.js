// VehiclePanel.js —— Phase 4 重写  ·  快捷键 T
// 载具槽位（最多 1 辆装备中）
// 内嵌合成：2× item_wheel → wheelbarrow；4× item_wheel → cart
// Phase 4 先 UI 框架，载具进围栏解锁新地块 Phase 5 再说
// 外观严格套 InventoryPanel 模板（_panelHelper）

import { EventBus } from '../../core/EventBus.js';
import { GE } from '../../core/GameEvents.js';
import { InventorySystem } from '../../systems/InventorySystem.js';
import { createStandardPanel } from './_panelHelper.js';
import { createEl, qs } from '../dom.js';
import { devLog } from '../../core/Logger.js';

const VEHICLES = [
  { id: 'wheelbarrow', name: '独轮车', emoji: '🛒', mat: { itemId: 'item_wheel', qty: 2 }, desc: '简易运输工具' },
  { id: 'cart',        name: '两轮推车', emoji: '🛠️', mat: { itemId: 'item_wheel', qty: 4 }, desc: '更稳固的运输工具' },
];

function ensureV(gs) { if (!gs.vehicle) gs.vehicle = { current: null, inventory: [] }; return gs.vehicle; }

export class VehiclePanel {
  constructor(director) {
    this.director = director;
    this.helper = null;
    this.slotEl = null;
    this.invEl = null;
    this.craftEl = null;
  }

  mount() {
    this.helper = createStandardPanel({
      title: '🚗 载具（T 切换）',
      panelKey: 'vehicle',
      width: 'min(92vw, 820px)',
      height: 'min(86vh, 680px)',
      onMount: (_p, body) => this._build(body),
    });
    this._subscribe();
  }

  _build(body) {
    const main = createEl('div', {
      style: { flex: '1', minHeight: '0', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' },
      parent: body,
    });
    this.slotEl = createEl('div', {
      style: { padding: '12px', background: 'rgba(255,255,255,0.55)', border: '2px solid #b8a888', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'center' },
      parent: main,
    });
    this.invEl = createEl('div', {
      style: { padding: '10px', background: 'rgba(255,255,255,0.55)', border: '2px solid #b8a888', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '6px', overflowY: 'auto' },
      parent: main,
    });

    this.craftEl = createEl('div', {
      style: { padding: '10px', background: 'rgba(255,255,255,0.55)', border: '2px solid #b8a888', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '6px' },
      parent: body,
    });

    const foot = createEl('div', {
      style: { display: 'flex', gap: '8px', justifyContent: 'flex-end', borderTop: '2px dashed #b8a888', paddingTop: '8px' },
      parent: body,
    });
    createEl('button', { class: 'action-btn', text: '关闭', parent: foot, onclick: () => this.hide() });

    this._refresh();
  }

  _subscribe() {
    EventBus.on(GE.UI_PANEL_OPEN, ({ panel }) => { if (panel === 'vehicle') this.toggle(); });
    EventBus.on(GE.UI_PANEL_CLOSE, ({ panel }) => { if (panel === 'vehicle' && this.helper?.visible) this.helper.hide(); });
    EventBus.on(GE.INVENTORY_CHANGE, () => { if (this.helper?.visible) this._refresh(); });
  }

  _getGS() { return this.director?.getGS?.(); }

  _refresh() {
    const gs = this._getGS(); const v = gs ? ensureV(gs) : { current: null, inventory: [] };

    // 装备槽位
    this.slotEl.innerHTML = '';
    createEl('div', { style: { fontSize: '13px', fontWeight: '800', color: '#5a4a3a' }, text: '🛻 当前装备槽（最多 1 辆）', parent: this.slotEl });
    const box = createEl('div', {
      style: {
        width: '110px', height: '110px', borderRadius: '14px',
        background: v.current ? '#fffbe6' : '#eee',
        border: '3px solid #b8a888',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4px',
      },
      parent: this.slotEl,
    });
    if (v.current) {
      const def = VEHICLES.find(x => x.id === v.current);
      createEl('div', { style: { fontSize: '44px', fontFamily: '"Segoe UI Emoji",sans-serif' }, text: def?.emoji || '🚗', parent: box });
      createEl('div', { style: { fontSize: '12px', fontWeight: '800' }, text: def?.name || v.current, parent: box });
      createEl('button', {
        class: 'action-btn', text: '卸下', parent: this.slotEl,
        onclick: () => this._detach(),
      });
    } else {
      createEl('div', { style: { fontSize: '14px', color: '#b0a090' }, text: '（空）', parent: box });
      createEl('div', { style: { fontSize: '11px', color: '#888', textAlign: 'center' }, text: '右侧点选装备', parent: this.slotEl });
    }

    // 载具库存
    this.invEl.innerHTML = '';
    createEl('div', { style: { fontSize: '13px', fontWeight: '800', color: '#5a4a3a' }, text: '📦 载具库存', parent: this.invEl });
    if (!v.inventory || v.inventory.length === 0) {
      createEl('div', { style: { color: '#b0a090', fontSize: '12px', fontStyle: 'italic', padding: '10px' }, text: '（暂无载具，去合成吧）', parent: this.invEl });
    } else {
      const grid = createEl('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(70px,1fr))', gap: '6px' }, parent: this.invEl });
      v.inventory.forEach((vid, idx) => {
        const def = VEHICLES.find(x => x.id === vid);
        if (!def) return;
        const s = createEl('div', {
          style: {
            aspectRatio: '1/1', background: 'rgba(255,255,255,0.85)',
            border: '2px solid #b8a888', borderRadius: '10px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px',
            cursor: 'pointer',
          },
          parent: grid,
        });
        createEl('div', { style: { fontSize: '26px', fontFamily: '"Segoe UI Emoji",sans-serif' }, text: def.emoji, parent: s });
        createEl('div', { style: { fontSize: '10px', fontWeight: '700', textAlign: 'center' }, text: def.name, parent: s });
        s.addEventListener('click', () => this._attach(idx));
      });
    }

    // 合成
    this.craftEl.innerHTML = '';
    createEl('div', { style: { fontSize: '13px', fontWeight: '800', color: '#5a4a3a' }, text: '⚒️ 合成载具', parent: this.craftEl });
    VEHICLES.forEach((vh) => {
      const have = gs ? InventorySystem.countItem(gs, vh.mat.itemId) : 0;
      const ok = have >= vh.mat.qty;
      const row = createEl('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: '10px', padding: '8px',
          background: ok ? 'rgba(255,255,255,0.8)' : 'rgba(240,240,240,0.7)', border: '2px solid #b8a888', borderRadius: '10px', opacity: ok ? 1 : 0.7,
        },
        parent: this.craftEl,
      });
      createEl('div', { style: { fontSize: '28px', width: '36px', textAlign: 'center', fontFamily: '"Segoe UI Emoji",sans-serif' }, text: vh.emoji, parent: row });
      const info = createEl('div', { style: { flex: '1' }, parent: row });
      createEl('div', { style: { fontWeight: '800', fontSize: '13px' }, text: vh.name, parent: info });
      createEl('div', { style: { fontSize: '11px', color: '#7a6a56' }, text: `材料：⚙️×${vh.mat.qty}（持有 ${have}）`, parent: info });
      const btn = createEl('button', { class: 'action-btn', text: '合成', parent: row, onclick: () => this._craft(vh) });
      if (!ok) btn.disabled = true;
    });
  }

  _craft(vh) {
    const gs = this._getGS(); if (!gs) return;
    if (InventorySystem.countItem(gs, vh.mat.itemId) < vh.mat.qty) return;
    EventBus.emit(GE.DIALOG_SHOW, {
      title: '确认合成载具？',
      content: `消耗 ⚙️×${vh.mat.qty} → ${vh.emoji} ${vh.name}`,
      options: [
        { label: '取消', onSelect: () => {} },
        { label: '确定', onSelect: () => {
          InventorySystem.removeItem(gs, vh.mat.itemId, vh.mat.qty);
          ensureV(gs).inventory.push(vh.id);
          EventBus.emit(GE.TOAST_SHOW, { text: `⚒️ 合成成功：${vh.emoji} ${vh.name}`, duration: 1200 });
          devLog.info('[VehiclePanel] craft', vh.id);
          this._refresh();
        }},
      ],
    });
  }

  _attach(idx) {
    const gs = this._getGS(); if (!gs) return;
    const v = ensureV(gs);
    if (v.current) { EventBus.emit(GE.TOAST_SHOW, { text: '⚠️ 先卸下当前载具', duration: 1200 }); return; }
    const vid = v.inventory.splice(idx, 1)[0];
    v.current = vid;
    EventBus.emit(GE.VEHICLE_ATTACH, { action: 'attach', vehicleId: vid });
    EventBus.emit(GE.TOAST_SHOW, { text: `✅ 已装备载具`, duration: 1200 });
    this._refresh();
  }

  _detach() {
    const gs = this._getGS(); if (!gs) return;
    const v = ensureV(gs);
    if (!v.current) return;
    const def = VEHICLES.find(x => x.id === v.current);
    EventBus.emit(GE.DIALOG_SHOW, {
      title: '卸下载具', content: `确定卸下 ${def?.emoji || ''} ${def?.name || v.current}？`,
      options: [
        { label: '取消', onSelect: () => {} },
        { label: '确定', onSelect: () => {
          v.inventory.push(v.current); v.current = null;
          EventBus.emit(GE.TOAST_SHOW, { text: '📦 载具已卸库存', duration: 1200 });
          this._refresh();
        }},
      ],
    });
  }

  show() { this.helper?.show(); }
  hide() { this.helper?.hide(); }
  toggle() { this.helper?.toggle(); }
}

export default VehiclePanel;
