// VehiclePanel.js —— 载具页（快捷键 T）
// 交互（§16.16）：
//   · 点击一张载具卡片，一次生效，全程无二次确认 / 无弹窗：
//       - 当前未装载 → 装载
//       - 点击当前已装载的那张 → 卸下（回到「徒步跋涉」）
//       - 已装载 A 时点击 B → A 卸下、B 装上（替换）
//   · 每张卡片对应一件载具实例（instanceId），同名载具也是两张独立卡片，
//     各自显示自己的剩余次数、各自装载 / 卸下，互不影响
//   · 不设「当前装备槽」格子，也不设「装载 / 卸下」按钮；
//     当前载具只在它自己那张卡片上加绿色边框（同名另一件不加）
//   · 每行最多 3 张卡片（1/3 宽），卡片直接显示名称 / 剩余次数 / 描述文本
// 数据只读 gs.vehicle（不改存档字段、不改移动系统逻辑）

import { EventBus } from '../../core/EventBus.js';
import { GE } from '../../core/GameEvents.js';
import { createStandardPanel } from './_panelHelper.js';
import { createEl, iconEl } from '../dom.js';
import { devLog } from '../../core/Logger.js';
import { VEHICLES } from '../../data/vehicles.js';
import { ITEMS } from '../../data/items.js';
import { VehicleSystem } from '../../systems/VehicleSystem.js';
import { renderTraitBadges } from '../TraitBadges.js';

// 视觉常量：绿色边框 = 当前正在使用的载具（不遮挡图标/文字）
const BORDER_CURRENT = '3px solid #3fa34d';
const BORDER_NORMAL = '3px solid #b8a888';
const BG_CURRENT = '#f3fbf4';
const BG_NORMAL = 'rgba(255,255,255,0.85)';
const BG_HOVER = '#fff8dc';

export class VehiclePanel {
  constructor(director) {
    this.director = director;
    this.helper = null;
    this.statusEl = null;
    this.invEl = null;
    this.cardEls = [];
  }

  mount() {
    this.helper = createStandardPanel({
      panelKey: 'vehicle',
      width: 'min(92vw, 960px)',
      height: 'min(88vh, 720px)',
      onMount: (_p, body) => this._build(body),
    });
    this._subscribe();
  }

  _build(body) {
    // 顶部状态行：永远能看出当前是「徒步跋涉」还是在用某辆载具
    this.statusEl = createEl('div', {
      style: {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px 10px',
        // 右上角 ✖ 浮在面板角上：状态行右侧留出按钮宽度，提示文字不被遮挡
        padding: '8px 44px 8px 12px', background: 'rgba(255,255,255,0.62)',
        border: '2px solid #e6dcc4', borderRadius: '10px', flexShrink: '0',
      },
      parent: body,
    });

    // 卡片区（整体滚动，卡片内部不滚动；长描述 4 行截断 + 省略号）
    const scroll = createEl('div', {
      style: { flex: '1', minHeight: '0', overflowY: 'auto', paddingRight: '4px' },
      parent: body,
    });
    this.invEl = createEl('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gap: '12px',
        alignItems: 'stretch',
        padding: '2px',
        boxSizing: 'border-box',
      },
      parent: scroll,
    });

    const foot = createEl('div', {
      style: { display: 'flex', gap: '8px', justifyContent: 'flex-end', borderTop: '2px dashed #b8a888', paddingTop: '8px', flexShrink: '0' },
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
    EventBus.on(GE.VEHICLE_GAIN, () => { if (this.helper?.visible) this._refresh(); });
    EventBus.on(GE.VEHICLE_ATTACH, () => { if (this.helper?.visible) this._refresh(); });
    // 读档/重置时面板若开着必须刷新（车辆数据可能从存档恢复）
    EventBus.on(GE.STATE_RESET, () => { if (this.helper?.visible) this._refresh(); });
  }

  _getGS() { return this.director?.getGS?.(); }

  _refresh() {
    const gs = this._getGS();
    const v = gs?.vehicle || { current: null, available: [] };
    const cur = v.current || null;
    const curDef = cur ? VEHICLES[cur.vehicleId] : null;

    // ── 顶部状态行 ──
    this.statusEl.innerHTML = '';
    const left = createEl('div', {
      style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: '800' },
      parent: this.statusEl,
    });
    createEl('span', { style: { color: '#5a4a3a' }, text: '当前：', parent: left });
    if (curDef) {
      left.appendChild(iconEl('items', cur.vehicleId, { size: '18px', def: curDef, fallback: curDef.emoji || '🚗' }));
      createEl('span', {
        style: { color: '#2f7d32' },
        text: curDef.perDayLimit && gs.vehicle.chanceUsedToday
          ? `${curDef.name}（今日已用）`
          : `${curDef.name}（${curDef.perDayLimit ? `每天限 ${curDef.perDayLimit} 次` : `剩余 ×${VehiclePanel._fmtUsage(cur.usageLeft)}`}）`,
        parent: left,
      });
    } else {
      createEl('span', { style: { color: '#5a4a3a' }, text: '🚶 徒步跋涉', parent: left });
    }
    createEl('span', {
      style: { fontSize: '11px', color: '#9a8a76' },
      text: '点击卡片：装载 · 再点已装载的卸下 · 已装载时点其它为替换',
      parent: this.statusEl,
    });

    // ── 载具卡片（每行最多 3 张，1/3 宽） ──
    this.invEl.innerHTML = '';
    this.cardEls = [];
    if (!v.available || v.available.length === 0) {
      createEl('div', {
        style: { color: '#b0a090', fontSize: '12px', fontStyle: 'italic', padding: '10px' },
        text: '（暂无载具 —— 可从商店/事件/奖励/巴士站/祈福获得）',
        parent: this.invEl,
      });
      return;
    }

    v.available.forEach((entry) => {
      const def = VEHICLES[entry.vehicleId] || {};
      // 按实例辨识：同名两件是两张独立的卡，绿框只标当前装载的那一件
      const isCur = !!cur && cur.instanceId === entry.instanceId;

      // 整张卡片可点：单击装载 / 卸下 / 替换
      const card = createEl('div', {
        class: 'vehicle-card',
        attrs: {
          'data-vehicle-id': entry.vehicleId,
          'data-instance-id': String(entry.instanceId),
          'data-current': isCur ? '1' : '0',
        },
        style: {
          boxSizing: 'border-box',
          minHeight: '150px',
          display: 'flex', flexDirection: 'column', gap: '6px',
          padding: '10px 12px',
          background: isCur ? BG_CURRENT : BG_NORMAL,
          border: isCur ? BORDER_CURRENT : BORDER_NORMAL,
          borderRadius: '14px',
          cursor: 'pointer',
          userSelect: 'none',
          transition: 'background-color 120ms ease, box-shadow 120ms ease, transform 80ms ease',
          boxShadow: isCur ? '0 0 0 2px rgba(63,163,77,0.18)' : 'none',
        },
        parent: this.invEl,
      });
      this.cardEls.push(card);

      // 卡片头：图标 + 名称 / 剩余次数
      const head = createEl('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' }, parent: card });
      head.appendChild(iconEl('items', entry.vehicleId, { size: '30px', def, fallback: def.emoji || '🚗' }));
      const titleBox = createEl('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '0' }, parent: head });
      createEl('div', {
        style: { fontSize: '13px', fontWeight: '800', color: '#3a2e20', lineHeight: '1.2' },
        text: def.name || entry.vehicleId,
        parent: titleBox,
      });
      const usedToday = !!def.perDayLimit && !!gs?.vehicle?.chanceUsedToday;
      createEl('div', {
        style: { fontSize: '11px', color: usedToday ? '#b23b3b' : '#7a6a56', fontWeight: usedToday ? '800' : '400' },
        text: usedToday
          ? `今日已用（每天限 ${def.perDayLimit} 次）`
          : (def.perDayLimit ? `每天限 ${def.perDayLimit} 次` : `剩余 ×${VehiclePanel._fmtUsage(entry.usageLeft)}`),
        parent: titleBox,
      });

      // 展示词条徽章（数据源为物品库同名条目；无 traits 时不渲染）
      renderTraitBadges(card, ITEMS[String(def.id || '').replace('vehicle_', 'item_')]?.traits);

      // 描述：逐字取数据层，保留原有换行；超长时卡片内 4 行截断 + 省略号
      createEl('div', {
        class: 'vehicle-desc',
        style: {
          fontSize: '11px', lineHeight: '1.45', color: '#7a6a56',
          whiteSpace: 'pre-line',
          display: '-webkit-box',
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: '4',
          overflow: 'hidden',
        },
        text: def.description || '',
        parent: card,
      });

      // hover / 按下反馈（不改边框色，避免盖掉当前载具的绿色标识）
      const baseBg = isCur ? BG_CURRENT : BG_NORMAL;
      card.addEventListener('mouseenter', () => { card.style.background = BG_HOVER; });
      card.addEventListener('mouseleave', () => { card.style.background = baseBg; card.style.transform = 'scale(1)'; });
      card.addEventListener('mousedown', () => { card.style.transform = 'scale(0.975)'; });
      card.addEventListener('mouseup', () => { card.style.transform = 'scale(1)'; });
      card.addEventListener('click', (ev) => this._onCardClick(ev, entry));
    });
  }

  /**
   * 单击结算（无二次确认）：
   *   未装载 → 装载；点已装载的那张 → 卸下；已装载 A 点 B → 替换。
   * 全部按实例（instanceId）结算：同名另一件不会被当成「已装载的那张」。
   * 同一个事件对象只结算一次，避免冒泡/重复派发造成「装了又卸」。
   */
  _onCardClick(ev, entry) {
    if (ev && ev.__vehicleSettled) return;
    if (ev) ev.__vehicleSettled = true;
    ev?.stopPropagation?.();

    const gs = this._getGS();
    const instanceId = entry?.instanceId;
    const vehicleId = entry?.vehicleId;
    if (!gs || !Number.isInteger(instanceId) || !vehicleId || !gs.vehicle) return;
    const cur = gs.vehicle.current;

    // 1) 点击当前已装载的那一件 → 卸下（回到徒步跋涉）；同名另一件不受影响
    if (cur && cur.instanceId === instanceId) {
      this._detach();
      return;
    }

    // 2) 已装载别的载具 → 先卸下（把旧载具已用次数同步回库存），再装新的
    if (cur) {
      const def = VEHICLES[vehicleId];
      if (def?.perDayLimit && gs.vehicle.chanceUsedToday) {
        EventBus.emit(GE.TOAST_SHOW, { text: `🚗 ${def.name} 每天限用 1 次`, duration: 1500 });
        return;
      }
      VehicleSystem.detachVehicle(gs);
    }

    // 3) 未装载 → 装载这一件
    const ok = VehicleSystem.attachVehicle(gs, instanceId);
    if (ok) devLog.info('[VehiclePanel] attach', vehicleId, 'instance', instanceId);
  }

  _detach() {
    const gs = this._getGS(); if (!gs?.vehicle?.current) return;
    const def = VEHICLES[gs.vehicle.current.vehicleId];
    VehicleSystem.detachVehicle(gs);
    EventBus.emit(GE.TOAST_SHOW, { text: `🚶 已卸下${def?.name || '载具'}，改为徒步跋涉`, duration: 1200 });
    devLog.info('[VehiclePanel] detach');
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
