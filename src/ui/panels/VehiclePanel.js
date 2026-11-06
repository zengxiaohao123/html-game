// VehiclePanel.js —— Phase 4 重写（对接 VehicleSystem）  ·  快捷键 T
// 载具槽位（最多 1 辆装备中）
// 载具库存列表（从 gs.vehicle.available 读取，对象数组 [{vehicleId, usageLeft}]）
// 装备/卸下通过 VehicleSystem.attachVehicle/detachVehicle
// 外观严格套 InventoryPanel 模板（_panelHelper）

import { EventBus } from '../../core/EventBus.js';
import { GE } from '../../core/GameEvents.js';
import { createStandardPanel } from './_panelHelper.js';
import { createEl, iconEl } from '../dom.js';
import { devLog } from '../../core/Logger.js';
import { VEHICLES } from '../../data/vehicles.js';
import { ITEMS } from '../../data/items.js';
import { VehicleSystem } from '../../systems/VehicleSystem.js';
import { renderTraitBadges } from '../TraitBadges.js';

export class VehiclePanel {
  constructor(director) {
    this.director = director;
    this.helper = null;
    this.slotEl = null;
    this.invEl = null;
  }

  mount() {
    this.helper = createStandardPanel({
      title: '🚗 载具（T）',
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

    const foot = createEl('div', {
      style: { display: 'flex', gap: '8px', justifyContent: 'flex-end', borderTop: '2px dashed #b8a888', paddingTop: '8px' },
      parent: body,
    });
    createEl('button', { class: 'action-btn', text: '关闭', parent: foot, onclick: () => this.hide() });

    this._refresh();
  }

  _subscribe() {
    // 幂等显示：已显示 → 只刷新；隐藏 → 显示。绝不 toggle 关闭
    // （开新面板关旧面板由 GameDirector 中央发 UI_PANEL_CLOSE 处理）
    EventBus.on(GE.UI_PANEL_OPEN, ({ panel }) => { if (panel === 'vehicle') this.show(); });
    EventBus.on(GE.UI_PANEL_CLOSE, ({ panel }) => { if (panel === 'vehicle' && this.helper?.visible) this.helper.hide(); });
    EventBus.on(GE.VEHICLE_GAIN,     () => { if (this.helper?.visible) this._refresh(); });
    EventBus.on(GE.VEHICLE_ATTACH,   () => { if (this.helper?.visible) this._refresh(); });
    // 读档/重置时面板若开着必须刷新（车辆数据可能从存档恢复）
    EventBus.on(GE.STATE_RESET,      () => { if (this.helper?.visible) this._refresh(); });
  }

  _getGS() { return this.director?.getGS?.(); }

  _refresh() {
    const gs = this._getGS();
    const v = gs?.vehicle || { current: null, available: [] };

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
      // v.current 是 { vehicleId, usageLeft } 对象
      const def = VEHICLES[v.current.vehicleId];
      box.appendChild(iconEl('items', v.current.vehicleId, { size: '44px', def, fallback: def?.emoji || '🚗' }));
      createEl('div', { style: { fontSize: '12px', fontWeight: '800' }, text: def?.name || v.current.vehicleId, parent: box });
      // 载具详情：展示词条统一徽章入口（数据源为物品库同名条目）
      renderTraitBadges(this.slotEl, ITEMS[String(def?.id || '').replace('vehicle_', 'item_')]?.traits);
      // usageLeft 从 entry.usageLeft 读（不是 VEHICLES[id].usageCount）
      createEl('div', { style: { fontSize: '11px', color: '#7a6a56' }, text: `剩余使用：${VehiclePanel._fmtUsage(v.current.usageLeft)} 次`, parent: this.slotEl });
      if (def?.description) {
        createEl('div', { style: { fontSize: '10px', color: '#9a8a76', textAlign: 'center', padding: '0 6px', whiteSpace: 'pre-line' }, text: def.description, parent: this.slotEl });
      }
      // 卸下：先进文字弹窗（取消 / 卸下），在弹窗里点「卸下」再走二次确认（同 tick 立即卸下）
      createEl('button', {
        class: 'action-btn', text: '卸下', parent: this.slotEl,
        onclick: () => {
          EventBus.emit(GE.DIALOG_SHOW, {
            title: '卸下载具',
            content: `确定要卸下「${def?.name || '当前载具'}」吗？卸下后会保留在载具库存中。`,
            options: [
              { label: '取消', safe: true, onSelect: () => {} },
              { label: '卸下', onSelect: () => this._detach() },
            ],
          });
        },
      });
    } else {
      createEl('div', { style: { fontSize: '14px', color: '#b0a090' }, text: '（空）', parent: box });
      createEl('div', { style: { fontSize: '11px', color: '#888', textAlign: 'center' }, text: '右侧点选装备', parent: this.slotEl });
    }

    // 载具库存 —— 遍历 gs.vehicle.available（对象数组）
    this.invEl.innerHTML = '';
    createEl('div', { style: { fontSize: '13px', fontWeight: '800', color: '#5a4a3a' }, text: '📦 载具库存', parent: this.invEl });
    if (!v.available || v.available.length === 0) {
      createEl('div', { style: { color: '#b0a090', fontSize: '12px', fontStyle: 'italic', padding: '10px' }, text: '（暂无载具 —— 可从商店/事件/奖励/巴士站/祈福获得）', parent: this.invEl });
    } else {
      const grid = createEl('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(70px,1fr))', gap: '6px' }, parent: this.invEl });
      v.available.forEach((entry, idx) => {
        // 同种不叠放、独立计算：每个 entry 单独一格
        const def = VEHICLES[entry.vehicleId];
        // 第 10 批：格子描边/圆角对齐背包基准（3px #b8a888 / 14px）
        const s = createEl('div', {
          style: {
            aspectRatio: '1/1', background: 'rgba(255,255,255,0.85)',
            border: '3px solid #b8a888', borderRadius: '14px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px',
            cursor: 'pointer',
          },
          parent: grid,
        });
        s.appendChild(iconEl('items', entry.vehicleId, { size: '26px', def, fallback: def?.emoji || '🚗' }));
        createEl('div', { style: { fontSize: '10px', fontWeight: '700', textAlign: 'center' }, text: def?.name || entry.vehicleId, parent: s });
        // 每个载具有独立使用次数：格内显示剩余次数（§16.16）
        createEl('div', { style: { fontSize: '9px', color: '#7a6a56', textAlign: 'center' }, text: `剩余 ×${VehiclePanel._fmtUsage(entry.usageLeft)}`, parent: s });
        s.addEventListener('click', () => this._attach(idx));
      });
    }
  }

  _attach(idx) {
    const gs = this._getGS(); if (!gs) return;
    const entry = gs.vehicle?.available?.[idx];
    if (!entry) return;
    if (gs.vehicle.current) { EventBus.emit(GE.TOAST_SHOW, { text: '⚠️ 先卸下当前载具', duration: 1200 }); return; }
    const ok = VehicleSystem.attachVehicle(gs, entry.vehicleId);
    if (ok) {
      devLog.info('[VehiclePanel] attach', entry.vehicleId);
      this._refresh();
    }
  }

  _detach() {
    const gs = this._getGS(); if (!gs) return;
    VehicleSystem.detachVehicle(gs);
    EventBus.emit(GE.TOAST_SHOW, { text: '📦 载具已卸库存', duration: 1200 });
    devLog.info('[VehiclePanel] detach');
    this._refresh();
  }

  show() {
    this.helper?.show();
    this._refresh();
  }
  hide() { this.helper?.hide(); }
  toggle() {
    if (this.helper?.visible) {
      this.helper.hide();
    } else {
      this.helper?.show();
      this._refresh();
    }
  }

  /** 剩余次数格式化：巧遇（vehicle_chance）usageCount = Infinity → ∞ */
  static _fmtUsage(n) {
    return Number.isFinite(n) ? String(n) : '∞';
  }
}

export default VehiclePanel;
