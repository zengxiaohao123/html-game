// TeamPanel.js —— 第 5 批 UI 对齐（§16.12 编队页面，快捷键 L）
// 全屏。4 组编队（默认启用第 1 组），每组 1~3 角色 + 1 精灵。
// 队伍 1/2/3/4 显示在屏幕上中侧，点击序号切换。
// 右下角两个按钮：快捷编队、启用。
// 快捷编队（二级界面）：左侧滑出 1/3 宽换人界面，头像格分类排列；
//   点角色=选中、再点=取消；选中格绿框+左上角绿色序号 1/2/3；下侧「保存」保存并退回。
// 编队界面允许非法组成；点「启用」时检测合法性，不合法不启用、变回原编队。
// 每日修改编队上限 3 次（gs.team.dailyModifyCount，DaySystem.startNewDay 清零）：
//   切换启用不同编队组、换人都算一次修改；唯一例外——换人后新队伍角色和精灵
//   与原队伍完全相同（允许顺序不同）不算修改。
// ESC（§16.20）：快捷编队是二级界面，ESC 先关闭快捷编队回到编队主界面。

import { EventBus } from '../../core/EventBus.js';
import { GE } from '../../core/GameEvents.js';
import { CHARACTERS, SPIRITS } from '../../data/characters.js';
import { createStandardPanel } from './_panelHelper.js';
import { createEl, iconEl } from '../dom.js';
import { devLog } from '../../core/Logger.js';

const BOX_BORDER = '2px solid #b8a888';
const SLOT_COUNT = 3;
const DAILY_MODIFY_LIMIT = 3;
const QUICK_SLIDE_MS = 240;

export class TeamPanel {
  constructor(director) {
    this.director = director;
    this.helper = null;
    this.topRow = null;
    this.slotsWrap = null;
    this.quickOverlay = null;
    this.selectedGroup = 0;
    this._quickEditMode = false;
    this._quickRoles = [];        // 快捷编队临时选中角色（有序，≤3）
    this._quickSpiritId = null;   // 快捷编队临时选中精灵
    this._quickCloseTimer = null;
    this._keyHandler = null;
  }

  mount() {
    this.helper = createStandardPanel({
      panelKey: 'team',
      width: '100vw',   // §16.12：全屏
      height: '100vh',
      // §16.20：快捷编队（二级界面）打开时，✕ / 遮罩 / ESC 先关二级，不直接关整个面板
      onCloseRequest: () => {
        if (this._quickEditMode) {
          this._closeQuick();
          return;
        }
        this.helper.hide();
      },
      onMount: (_panel, body) => this._build(body),
    });
    this._subscribe();

    // §16.20 二级界面 ESC：快捷编队打开时，ESC 只关闭快捷编队（不关整个面板）。
    // 注册时机早于 InputManager.bind() 与 _panelHelper 的 ESC 监听，
    // 用 stopImmediatePropagation 拦截后续监听。
    this._keyHandler = (e) => {
      if (e.key !== 'Escape' && e.key !== 'Esc') return;
      if (!this.helper?.visible || !this._quickEditMode) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this._closeQuick();
    };
    window.addEventListener('keydown', this._keyHandler);
  }

  _build(body) {
    body.style.position = 'relative';
    body.style.overflow = 'hidden';

    // 队伍 1/2/3/4 —— 屏幕上中侧，点击序号切换
    this.topRow = createEl('div', {
      style: { display: 'flex', gap: '12px', justifyContent: 'center', padding: '6px 0', flexShrink: '0' },
      parent: body,
    });

    // 主区：当前组的槽位展示（只读；换人走快捷编队）
    this.slotsWrap = createEl('div', {
      style: {
        flex: '1', minHeight: '0', overflowY: 'auto',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: '10px', padding: '12px',
      },
      parent: body,
    });

    // 右下角两个按钮：快捷编队、启用
    const foot = createEl('div', {
      style: { display: 'flex', gap: '8px', justifyContent: 'flex-end', borderTop: '2px dashed #b8a888', paddingTop: '8px', flexShrink: '0' },
      parent: body,
    });
    createEl('button', { class: 'action-btn', text: '⚡ 快捷编队', parent: foot, onclick: () => (this._quickEditMode ? this._closeQuick() : this._openQuick()) });
    createEl('button', { class: 'action-btn', text: '✅ 启用', parent: foot, onclick: () => this._activate() });

    // 快捷编队滑出层（左侧 1/3 宽）
    this.quickOverlay = createEl('div', {
      style: {
        position: 'absolute', top: '0', left: '0', bottom: '0',
        width: '33.33%', minWidth: '280px',
        background: 'linear-gradient(135deg, #fffbf0 0%, #fff3c4 100%)',
        borderRight: '3px solid #3a3a3a',
        boxShadow: '4px 0 14px rgba(0,0,0,0.25)',
        display: 'none', flexDirection: 'column', gap: '8px', padding: '12px',
        transform: 'translateX(-100%)',
        transition: `transform ${QUICK_SLIDE_MS}ms ease`,
        zIndex: 20, overflowY: 'auto',
      },
      parent: body,
    });

    this._refresh();
  }

  _subscribe() {
    // 幂等显示：隐藏 → 显示；已显示 → 只刷新（绝不 toggle 关闭）
    EventBus.on(GE.UI_PANEL_OPEN, ({ panel }) => {
      if (panel !== 'team') return;
      if (this.helper?.visible) {
        this._refresh();
      } else {
        const gs = this._getGS();
        this.selectedGroup = gs?.team?.activeGroup ?? 0;
        this.show();
        this._refresh();
      }
    });
    EventBus.on(GE.UI_PANEL_CLOSE, ({ panel }) => {
      if (panel !== 'team') return;
      this._abortQuick();
      if (this.helper?.visible) this.helper.hide();
    });
    EventBus.on(GE.STATE_RESET, () => { if (this.helper?.visible) this._refresh(); });
    // 队伍数据被其它来源改动（外部编队 / 启用组切换）→ 面板即时刷新
    EventBus.on(GE.TEAM_CHANGE, () => { if (this.helper?.visible) this._refresh(); });
  }

  _getGS() { return this.director?.getGS?.(); }

  // ─────────────────────────── 刷新 ───────────────────────────

  _refresh() {
    if (!this.topRow) return;
    const gs = this._getGS();
    const activeGroup = gs?.team?.activeGroup ?? 0;

    // 队伍 1/2/3/4 序号
    this.topRow.innerHTML = '';
    for (let i = 0; i < 4; i++) {
      const sel = i === this.selectedGroup;
      const isActive = i === activeGroup;
      const btn = createEl('button', {
        class: ['action-btn'],
        style: {
          width: '72px', height: '56px',
          background: sel ? '#ffe099' : 'rgba(255,255,255,0.7)',
          border: sel ? '3px solid #e8a900' : BOX_BORDER,
          fontWeight: '800', fontSize: '15px',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px',
        },
        parent: this.topRow,
        onclick: () => {
          if (this._quickEditMode) this._closeQuick(); // 切组时收起换人界面（丢弃未保存选择）
          this.selectedGroup = i;
          this._refresh();
        },
      });
      createEl('div', { text: `队伍 ${i + 1}`, parent: btn });
      if (isActive) {
        createEl('div', { style: { fontSize: '10px', color: '#2a8a3a', fontWeight: '800' }, text: '✅ 已启用', parent: btn });
      }
    }

    // 当前组槽位展示（只读）
    this.slotsWrap.innerHTML = '';
    const group = gs?.team?.groups?.[this.selectedGroup] || { roles: [], spirit: null };
    createEl('div', { style: { fontSize: '14px', fontWeight: '800', color: '#5a4a3a' }, text: `队伍 ${this.selectedGroup + 1}（1~3 名角色 + 1 名精灵）`, parent: this.slotsWrap });

    const slotsRow = createEl('div', { style: { display: 'flex', gap: '14px', flexWrap: 'wrap', justifyContent: 'center' }, parent: this.slotsWrap });
    const roles = (group.roles || []).filter(r => r);
    for (let i = 0; i < SLOT_COUNT; i++) {
      this._buildSlotCell(roles[i] || null, 'role', slotsRow);
    }
    this._buildSlotCell(group.spirit || null, 'spirit', slotsRow);

    if (this._quickEditMode) this._renderQuick();
  }

  // 槽位格（只读展示）
  _buildSlotCell(id, kind, parent) {
    const def = id ? (kind === 'role' ? CHARACTERS[id] : SPIRITS[id]) : null;
    const cell = createEl('div', {
      style: {
        width: '110px', padding: '10px 6px',
        background: def ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.4)',
        border: def ? BOX_BORDER : '2px dashed #b8a888', borderRadius: '12px',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px',
      },
      parent,
    });
    if (def) {
      cell.appendChild(iconEl('ui', def.id, { def, fallback: def.emoji, size: '52px' }));
      createEl('div', { style: { fontSize: '13px', fontWeight: '800', color: '#3a2e20' }, text: def.name, parent: cell });
      createEl('div', { style: { fontSize: '10px', color: '#8a6a3a' }, text: kind === 'role' ? '角色' : '精灵', parent: cell });
    } else {
      createEl('div', { style: { width: '52px', height: '52px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '26px', color: '#b0a090' }, text: '—', parent: cell });
      createEl('div', { style: { fontSize: '12px', color: '#b0a090' }, text: '（空）', parent: cell });
    }
  }

  // ─────────────────────────── 快捷编队（二级界面）───────────────────────────

  _openQuick() {
    const gs = this._getGS();
    const group = gs?.team?.groups?.[this.selectedGroup] || { roles: [], spirit: null };
    this._quickRoles = (group.roles || []).filter(r => r).slice(0, SLOT_COUNT);
    this._quickSpiritId = group.spirit || null;
    this._quickEditMode = true;

    if (this._quickCloseTimer) { clearTimeout(this._quickCloseTimer); this._quickCloseTimer = null; }
    this.quickOverlay.style.display = 'flex';
    // 下一帧再位移，保证滑出动画生效
    requestAnimationFrame(() => { this.quickOverlay.style.transform = 'translateX(0)'; });
    this._renderQuick();
  }

  _closeQuick() {
    this._quickEditMode = false;
    if (!this.quickOverlay) return;
    this.quickOverlay.style.transform = 'translateX(-100%)';
    if (this._quickCloseTimer) clearTimeout(this._quickCloseTimer);
    this._quickCloseTimer = setTimeout(() => {
      this.quickOverlay.style.display = 'none';
      this._quickCloseTimer = null;
    }, QUICK_SLIDE_MS + 30);
  }

  // 面板被外部关闭时立即收起快捷编队状态（无动画）
  _abortQuick() {
    this._quickEditMode = false;
    if (this._quickCloseTimer) { clearTimeout(this._quickCloseTimer); this._quickCloseTimer = null; }
    if (this.quickOverlay) {
      this.quickOverlay.style.transition = 'none';
      this.quickOverlay.style.transform = 'translateX(-100%)';
      this.quickOverlay.style.display = 'none';
      // 恢复过渡，供下次滑出使用
      requestAnimationFrame(() => {
        if (this.quickOverlay) this.quickOverlay.style.transition = `transform ${QUICK_SLIDE_MS}ms ease`;
      });
    }
  }

  _renderQuick() {
    this.quickOverlay.innerHTML = '';
    createEl('div', { style: { fontSize: '16px', fontWeight: '900', color: '#3a2e20', borderBottom: '2px solid #e8a900', paddingBottom: '6px' }, text: '⚡ 快捷编队', parent: this.quickOverlay });
    createEl('div', { style: { fontSize: '11px', color: '#8a6a3a' }, text: `队伍 ${this.selectedGroup + 1} · 点角色选中 / 再点取消（至多 ${SLOT_COUNT} 名）`, parent: this.quickOverlay });

    // 角色区（分类摆放，头像下带名字）
    createEl('div', { style: { fontSize: '13px', fontWeight: '800', color: '#5a4a3a', marginTop: '4px' }, text: '🎭 角色', parent: this.quickOverlay });
    const rGrid = createEl('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }, parent: this.quickOverlay });
    Object.values(CHARACTERS).forEach((c) => {
      const idx = this._quickRoles.indexOf(c.id);
      const sel = idx >= 0;
      const cell = createEl('div', {
        style: {
          position: 'relative', padding: '8px 4px',
          background: sel ? '#e8f5e9' : 'rgba(255,255,255,0.8)',
          border: sel ? '3px solid #2a8a3a' : BOX_BORDER, borderRadius: '10px',
          cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
        },
        parent: rGrid,
      });
      if (sel) {
        // 左上角绿色序号 1/2/3
        createEl('div', {
          style: {
            position: 'absolute', top: '-6px', left: '-6px', width: '20px', height: '20px',
            background: '#2a8a3a', color: '#fff', borderRadius: '50%',
            fontSize: '12px', fontWeight: '800', display: 'flex', alignItems: 'center', justifyContent: 'center',
          },
          text: String(idx + 1), parent: cell,
        });
      }
      cell.appendChild(iconEl('ui', c.id, { def: c, fallback: c.emoji, size: '40px' }));
      createEl('div', { style: { fontSize: '12px', fontWeight: '700', color: '#3a2e20' }, text: c.name, parent: cell });
      cell.addEventListener('click', () => this._quickPickRole(c.id));
    });

    // 精灵区
    createEl('div', { style: { fontSize: '13px', fontWeight: '800', color: '#5a4a3a', marginTop: '6px' }, text: '🧚 精灵', parent: this.quickOverlay });
    const sGrid = createEl('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }, parent: this.quickOverlay });
    Object.values(SPIRITS).forEach((s) => {
      const sel = this._quickSpiritId === s.id;
      const cell = createEl('div', {
        style: {
          padding: '8px 4px',
          background: sel ? '#e8f5e9' : 'rgba(255,255,255,0.8)',
          border: sel ? '3px solid #2a8a3a' : BOX_BORDER, borderRadius: '10px',
          cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
        },
        parent: sGrid,
      });
      cell.appendChild(iconEl('ui', s.id, { def: s, fallback: s.emoji, size: '40px' }));
      createEl('div', { style: { fontSize: '12px', fontWeight: '700', color: '#3a2e20' }, text: s.name, parent: cell });
      cell.addEventListener('click', () => {
        this._quickSpiritId = sel ? null : s.id;
        this._renderQuick();
      });
    });

    // 下侧「保存」按钮：保存当前编队并退回
    createEl('button', {
      class: 'action-btn',
      style: { marginTop: 'auto', background: '#e8f5e9', border: '3px solid #2a8a3a', fontWeight: '800', padding: '10px' },
      text: '💾 保存',
      parent: this.quickOverlay,
      onclick: () => this._quickSave(),
    });
  }

  _quickPickRole(roleId) {
    const idx = this._quickRoles.indexOf(roleId);
    if (idx >= 0) {
      this._quickRoles.splice(idx, 1); // 再点 = 取消
    } else if (this._quickRoles.length < SLOT_COUNT) {
      this._quickRoles.push(roleId);
    } else {
      EventBus.emit(GE.TOAST_SHOW, { text: `最多选择 ${SLOT_COUNT} 名角色`, duration: 1200 });
      return;
    }
    this._renderQuick();
  }

  // 换人是否实质改变（角色顺序也算改变：1 号位决定通用技能归属者）
  _sameComposition(rolesA, spiritA, rolesB, spiritB) {
    const a = [...(rolesA || [])].filter(r => r);
    const b = [...(rolesB || [])].filter(r => r);
    return JSON.stringify(a) === JSON.stringify(b) && (spiritA || null) === (spiritB || null);
  }

  _quickSave() {
    const gs = this._getGS(); if (!gs?.team) return;
    const g = gs.team.groups[this.selectedGroup];
    const newRoles = this._quickRoles.slice();
    const newSpirit = this._quickSpiritId;

    // 唯一例外：新队伍与原队伍完全相同（含 1 号位顺序）→ 不算修改
    if (this._sameComposition(newRoles, newSpirit, g.roles, g.spirit)) {
      EventBus.emit(GE.TOAST_SHOW, { text: '编队未发生变化', duration: 1200 });
      this._closeQuick();
      this._refresh();
      return;
    }

    // 每日修改编队上限 3 次
    if ((gs.team.dailyModifyCount || 0) >= DAILY_MODIFY_LIMIT) {
      EventBus.emit(GE.TOAST_SHOW, { text: `❌ 今日编队修改次数已用完（${DAILY_MODIFY_LIMIT}/${DAILY_MODIFY_LIMIT}），今日无法再修改`, duration: 1800 });
      return;
    }

    g.roles = newRoles;
    g.spirit = newSpirit;
    gs.team.dailyModifyCount = (gs.team.dailyModifyCount || 0) + 1;
    devLog.info('[TeamPanel] 换人已保存, 组', this.selectedGroup + 1, '今日已用', gs.team.dailyModifyCount);

    // 改的是当前启用组 → 通知队伍相关 UI 刷新
    if (this.selectedGroup === (gs.team.activeGroup ?? 0)) {
      EventBus.emit(GE.TEAM_CHANGE, { groupIdx: this.selectedGroup, activated: true });
    }
    EventBus.emit(GE.TOAST_SHOW, { text: `💾 已保存到队伍 ${this.selectedGroup + 1}`, duration: 1200 });
    this._closeQuick();
    this._refresh();
  }

  // ─────────────────────────── 启用 ───────────────────────────

  _activate() {
    const gs = this._getGS(); if (!gs?.team) return;
    const group = gs.team.groups[this.selectedGroup] || { roles: [], spirit: null };
    const validRoles = (group.roles || []).filter(r => r);

    // 合法性校验（编队界面允许非法组成，点「启用」时检测）
    if (validRoles.length < 1 || validRoles.length > SLOT_COUNT) {
      EventBus.emit(GE.TOAST_SHOW, { text: `❌ 编队不合法：需要 1~${SLOT_COUNT} 名角色`, duration: 1500 });
      this._refresh();
      return;
    }
    if (!group.spirit) {
      EventBus.emit(GE.TOAST_SHOW, { text: '❌ 编队不合法：需要 1 名精灵', duration: 1500 });
      this._refresh();
      return;
    }

    const activeGroup = gs.team.activeGroup ?? 0;
    if (this.selectedGroup === activeGroup) {
      EventBus.emit(GE.TOAST_SHOW, { text: `队伍 ${this.selectedGroup + 1} 已启用`, duration: 1200 });
      this._refresh();
      return;
    }

    // 切换启用不同编队组 = 一次修改 → 每日上限检查
    if ((gs.team.dailyModifyCount || 0) >= DAILY_MODIFY_LIMIT) {
      EventBus.emit(GE.TOAST_SHOW, { text: `❌ 今日编队修改次数已用完（${DAILY_MODIFY_LIMIT}/${DAILY_MODIFY_LIMIT}），今日无法再切换`, duration: 1800 });
      return;
    }

    gs.team.activeGroup = this.selectedGroup;
    gs.team.dailyModifyCount = (gs.team.dailyModifyCount || 0) + 1;
    devLog.info('[TeamPanel] 启用组', this.selectedGroup + 1, '今日已用', gs.team.dailyModifyCount);

    // SpiritArea / InfoPanel 等依赖此事件刷新队伍相关 UI（精灵名称/图标）
    EventBus.emit(GE.TEAM_CHANGE, { groupIdx: this.selectedGroup, activated: true });
    EventBus.emit(GE.TOAST_SHOW, { text: `✅ 已启用队伍 ${this.selectedGroup + 1}`, duration: 1200 });
    this._refresh();
  }

  show() { this.helper?.show(); }
  hide() { this.helper?.hide(); }
}

export default TeamPanel;
