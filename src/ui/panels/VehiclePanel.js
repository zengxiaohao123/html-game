// src/ui/panels/VehiclePanel.js
// Phase 4 —— 载具页面
// 快捷键 M
// 内嵌合成：2 item_wheel → 载具 wheelbarrow（自定义，不改 items.js）
// GS 暂未定义 vehicle 字段——直接动态扩展：gs.vehicle = { current: null, inventory: [] }
// 载具独立槽位（最多 1 辆 active），可卸下回 inventory（简化 Phase 4）

import { EventBus } from '../../core/EventBus.js';
import { GE } from '../../core/GameEvents.js';
import { InventorySystem } from '../../systems/InventorySystem.js';
import { createEl, qs } from '../dom.js';
import { devLog } from '../../core/Logger.js';

/** Phase 4 内嵌载具定义（不新建 data 文件） */
const VEHICLES = {
  wheelbarrow: {
    id: 'wheelbarrow',
    name: '独轮车',
    emoji: '🛒',
    desc: '可携带更多物资（Phase 5 实装）',
    material: { itemId: 'item_wheel', qty: 2 },
  },
  cart: {
    id: 'cart',
    name: '两轮推车',
    emoji: '🛠️',
    desc: '更稳固的运输工具（Phase 5 实装）',
    material: { itemId: 'item_wheel', qty: 4 },
  },
};

function ensureVehicleState(gs) {
  if (!gs.vehicle) gs.vehicle = { current: null, inventory: [] };
  return gs.vehicle;
}

export class VehiclePanel {
  constructor(director) {
    this.director = director;
    this.mask = null;
    this.panel = null;
    this.slotEl = null;
    this.inventoryWrap = null;
    this.craftWrap = null;
    this.visible = false;
  }

  mount(parent = qs('body')) {
    this.mask = createEl('div', {
      class: ['panel-mask'], parent,
      onclick: (e) => { if (e.target === this.mask) this.hide(); },
    });

    this.panel = createEl('div', {
      class: ['panel-card', 'vehicle-panel'],
      style: {
        width: 'min(640px, 94vw)', maxHeight: 'min(580px, 84vh)',
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
      text: '🚗 载具（M 切换）', parent: head,
    });
    createEl('button', {
      class: 'inventory-close', text: '✖', parent: head,
      onclick: () => this.hide(),
    });

    // 主 slot + 背包（左右）
    const body = createEl('div', {
      style: {
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px',
      },
      parent: this.panel,
    });

    // 左：当前装备槽位
    this.slotEl = createEl('div', {
      style: {
        padding: '12px', background: 'rgba(255,255,255,0.55)',
        border: '2px solid #b8a888', borderRadius: '14px',
        display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center',
      },
      parent: body,
    });

    // 右：载具库存 + 合成
    this.inventoryWrap = createEl('div', {
      style: {
        padding: '10px', background: 'rgba(255,255,255,0.55)',
        border: '2px solid #b8a888', borderRadius: '14px',
        display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto',
      },
      parent: body,
    });

    this.craftWrap = createEl('div', {
      style: {
        padding: '10px', background: 'linear-gradient(135deg, #fffaf0 0%, #fff3c4 100%)',
        border: '2px solid #b8a888', borderRadius: '14px',
        display: 'flex', flexDirection: 'column', gap: '8px',
      },
      parent: this.panel,
    });

    // 底部关闭
    const foot = createEl('div', {
      style: { display: 'flex', justifyContent: 'flex-end', borderTop: '2px dashed #b8a888', paddingTop: '8px', flexShrink: 0 },
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
    this._renderSlot();
    this._renderInventory();
    this._renderCraft();
  }

  _renderSlot() {
    this.slotEl.innerHTML = '';
    createEl('div', {
      style: { fontSize: '13px', fontWeight: '700', color: '#5a4a3a' },
      text: '🛻 当前装备（最多 1 辆）', parent: this.slotEl,
    });
    const gs = this._getGS();
    const vehicleState = gs ? ensureVehicleState(gs) : { current: null };

    const slotBox = createEl('div', {
      style: {
        width: '110px', height: '110px', borderRadius: '14px',
        background: vehicleState.current ? '#fffbe6' : '#eee',
        border: '3px solid #b8a888',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: '4px',
      },
      parent: this.slotEl,
    });
    if (vehicleState.current) {
      const v = VEHICLES[vehicleState.current];
      createEl('div', {
        style: { fontSize: '44px', fontFamily: '"Segoe UI Emoji",sans-serif' },
        text: v.emoji, parent: slotBox,
      });
      createEl('div', { style: { fontSize: '12px', fontWeight: '700' }, text: v.name, parent: slotBox });
    } else {
      createEl('div', { style: { fontSize: '14px', color: '#b0a090' }, text: '（空）', parent: slotBox });
    }

    // 卸下按钮
    if (vehicleState.current) {
      createEl('button', {
        class: 'action-btn', text: '卸下', parent: this.slotEl,
        onclick: () => this._detachConfirm(),
      });
    }
  }

  _renderInventory() {
    this.inventoryWrap.innerHTML = '';
    createEl('div', {
      style: { fontSize: '13px', fontWeight: '700', color: '#5a4a3a' },
      text: '📦 载具库存', parent: this.inventoryWrap,
    });

    const gs = this._getGS();
    const vehicleState = gs ? ensureVehicleState(gs) : { inventory: [] };
    const inv = vehicleState.inventory || [];

    if (inv.length === 0) {
      createEl('div', {
        style: { fontSize: '12px', color: '#b0a090', fontStyle: 'italic', padding: '10px' },
        text: '（暂无载具，去合成吧）', parent: this.inventoryWrap,
      });
      return;
    }

    const grid = createEl('div', {
      style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(70px, 1fr))', gap: '6px' },
      parent: this.inventoryWrap,
    });
    inv.forEach((vId, idx) => {
      const v = VEHICLES[vId];
      if (!v) return;
      const slot = createEl('div', {
        style: {
          position: 'relative', aspectRatio: '1/1', background: 'rgba(255,255,255,0.85)',
          border: '2px solid #b8a888', borderRadius: '10px',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer',
        },
        parent: grid,
      });
      createEl('div', {
        style: { fontSize: '26px', fontFamily: '"Segoe UI Emoji",sans-serif', lineHeight: '1' },
        text: v.emoji, parent: slot,
      });
      createEl('div', {
        style: { fontSize: '10px', fontWeight: '700', textAlign: 'center', padding: '0 2px' },
        text: v.name, parent: slot,
      });
      slot.addEventListener('click', () => this._attachVehicle(idx));
    });
  }

  _renderCraft() {
    this.craftWrap.innerHTML = '';
    createEl('div', {
      style: { fontSize: '13px', fontWeight: '700', color: '#5a4a3a' },
      text: '⚒️ 合成载具', parent: this.craftWrap,
    });

    const gs = this._getGS();
    Object.values(VEHICLES).forEach((v) => {
      const have = gs ? InventorySystem.countItem(gs, v.material.itemId) : 0;
      const ok = have >= v.material.qty;
      const row = createEl('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: '10px', padding: '8px',
          background: 'rgba(255,255,255,0.7)', border: '2px solid #b8a888', borderRadius: '10px',
        },
        parent: this.craftWrap,
      });
      createEl('div', {
        style: { fontSize: '28px', fontFamily: '"Segoe UI Emoji",sans-serif', width: '36px', textAlign: 'center' },
        text: v.emoji, parent: row,
      });
      const info = createEl('div', { style: { flex: '1' }, parent: row });
      createEl('div', { style: { fontWeight: '700', fontSize: '13px', color: '#3a2e20' }, text: v.name, parent: info });
      createEl('div', { style: { fontSize: '11px', color: '#7a6a56' }, text: `材料：⚙️×${v.material.qty}（持有 ${have}）`, parent: info });
      const btn = createEl('button', {
        class: 'action-btn', text: '合成', parent: row,
        onclick: () => this._craftConfirm(v),
      });
      if (!ok) btn.disabled = true;
    });
  }

  _craftConfirm(v) {
    const gs = this._getGS();
    if (!gs) return;
    if (InventorySystem.countItem(gs, v.material.itemId) < v.material.qty) return;

    EventBus.emit(GE.DIALOG_SHOW, {
      title: '确认合成载具？',
      content: `消耗 ⚙️×${v.material.qty} → ${v.emoji} ${v.name}`,
      options: [
        { label: '取消', onSelect: () => {} },
        { label: '确定', onSelect: () => this._doCraft(v) },
      ],
    });
  }

  _doCraft(v) {
    const gs = this._getGS();
    if (!gs) return;
    const vehicleState = ensureVehicleState(gs);
    if (InventorySystem.countItem(gs, v.material.itemId) < v.material.qty) return;
    InventorySystem.removeItem(gs, v.material.itemId, v.material.qty);
    vehicleState.inventory.push(v.id);
    EventBus.emit(GE.TOAST_SHOW, { text: `⚒️ 合成成功：${v.emoji} ${v.name}`, duration: 1600 });
    EventBus.emit(GE.VEHICLE_ATTACH, { action: 'craft', vehicleId: v.id });
    devLog.info('[VehiclePanel] crafted', v.id);
    this._refresh();
  }

  _attachVehicle(inventoryIdx) {
    const gs = this._getGS();
    if (!gs) return;
    const vehicleState = ensureVehicleState(gs);
    if (vehicleState.current) {
      EventBus.emit(GE.TOAST_SHOW, { text: '⚠️ 已装备载具，先卸下再装备新的', duration: 1500 });
      return;
    }
    const vId = vehicleState.inventory.splice(inventoryIdx, 1)[0];
    vehicleState.current = vId;
    EventBus.emit(GE.TOAST_SHOW, { text: `✅ 已装备载具：${VEHICLES[vId].emoji} ${VEHICLES[vId].name}`, duration: 1600 });
    EventBus.emit(GE.VEHICLE_ATTACH, { action: 'attach', vehicleId: vId });
    this._refresh();
  }

  _detachConfirm() {
    const gs = this._getGS();
    if (!gs) return;
    const vehicleState = ensureVehicleState(gs);
    if (!vehicleState.current) return;
    EventBus.emit(GE.DIALOG_SHOW, {
      title: '卸下载具',
      content: `确定卸下 ${VEHICLES[vehicleState.current].emoji} ${VEHICLES[vehicleState.current].name}？`,
      options: [
        { label: '取消', onSelect: () => {} },
        { label: '确定', onSelect: () => this._doDetach() },
      ],
    });
  }
  _doDetach() {
    const gs = this._getGS();
    const vehicleState = ensureVehicleState(gs);
    if (!vehicleState.current) return;
    vehicleState.inventory.push(vehicleState.current);
    vehicleState.current = null;
    EventBus.emit(GE.TOAST_SHOW, { text: '📦 载具已卸库存', duration: 1400 });
    this._refresh();
  }

  _subscribeEvents() {
    EventBus.on(GE.UI_PANEL_OPEN, ({ panel }) => {
      if (panel === 'settings' && this.visible) this.hide();
      if (panel === 'vehicle') this.toggle();
    });
    EventBus.on(GE.UI_PANEL_CLOSE, ({ panel }) => {
      if (panel === 'vehicle' && this.visible) this.hide();
    });
    EventBus.on(GE.INVENTORY_CHANGE, () => { if (this.visible) this._refresh(); });
    EventBus.on(GE.STATE_RESET, () => { if (this.visible) this._refresh(); });
  }

  show() {
    if (!this.mask || this.visible) return;
    this.visible = true;
    this.mask.style.display = 'flex';
    const gs = this._getGS();
    if (gs) { gs.uiState = gs.uiState || {}; gs.uiState.activePanel = 'vehicle'; ensureVehicleState(gs); }
    this._refresh();
  }
  hide() {
    if (!this.mask || !this.visible) return;
    this.visible = false;
    this.mask.style.display = 'none';
    const gs = this._getGS();
    if (gs && gs.uiState && gs.uiState.activePanel === 'vehicle') gs.uiState.activePanel = null;
    EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'vehicle' });
  }
  toggle() { this.visible ? this.hide() : this.show(); }

  _getGS() {
    if (this.director?.getGS) return this.director.getGS();
    if (window.__gameDirector?.getGS) return window.__gameDirector.getGS();
    return null;
  }
}

export default VehiclePanel;
