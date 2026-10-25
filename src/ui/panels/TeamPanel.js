// src/ui/panels/TeamPanel.js
// Phase 4 —— 编队页面
// 顶部：4 个组标签（默认 activeGroup=0 高亮）
// 中部：当前组 2 个角色槽 + 1 个精灵槽，点槽 → 下拉选（或直接点击候选列表）
// 下部：候选池（3 角色头像 + 3 精灵头像）
// 右下：保存 / 启用 / 关闭
// 每日修改上限 3 次：gs.team.dailyModifyCount

import { EventBus } from '../../core/EventBus.js';
import { GE } from '../../core/GameEvents.js';
import { CHARACTERS, SPIRITS } from '../../data/characters.js';
import { createEl, qs } from '../dom.js';
import { devLog } from '../../core/Logger.js';

export class TeamPanel {
  constructor(director) {
    this.director = director;
    this.mask = null;
    this.panel = null;
    this.groupBar = null;
    this.slotsEl = null;
    this.poolEl = null;
    this.selectedGroup = 0;
    this.visible = false;
    // 候选池的选中状态（点击候选角色再点槽位 → 填入）
    this.pickedRoleId = null;
    this.pickedSpiritId = null;
  }

  mount(parent = qs('body')) {
    this.mask = createEl('div', {
      class: ['panel-mask'],
      parent,
      onclick: (e) => { if (e.target === this.mask) this.hide(); },
    });

    this.panel = createEl('div', {
      class: ['panel-card', 'team-panel'],
      style: {
        width: 'min(760px, 94vw)',
        maxHeight: 'min(640px, 86vh)',
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
      text: '👥 编队（K 切换）',
      parent: head,
    });
    createEl('button', {
      class: 'inventory-close', text: '✖', parent: head,
      onclick: () => this.hide(),
    });

    // 4 个组标签
    this.groupBar = createEl('div', {
      style: { display: 'flex', gap: '8px', padding: '8px', background: 'rgba(255,255,255,0.55)', border: '2px solid #b8a888', borderRadius: '12px' },
      parent: this.panel,
    });

    // 主 body：左槽位 + 右候选池
    const body = createEl('div', {
      style: {
        flex: '1', minHeight: '0',
        display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '12px',
      },
      parent: this.panel,
    });
    this.slotsEl = createEl('div', {
      style: { padding: '10px', background: 'rgba(255,255,255,0.55)', border: '2px solid #b8a888', borderRadius: '14px', display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto' },
      parent: body,
    });
    this.poolEl = createEl('div', {
      style: { padding: '10px', background: 'rgba(255,255,255,0.55)', border: '2px solid #b8a888', borderRadius: '14px', display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto' },
      parent: body,
    });

    // 底部：剩余次数 + 保存/启用/关闭
    this.footBar = createEl('div', {
      style: { display: 'flex', gap: '10px', alignItems: 'center', justifyContent: 'space-between', paddingTop: '8px', borderTop: '2px dashed #b8a888', flexShrink: 0 },
      parent: this.panel,
    });

    this._subscribeEvents();
    this.mask.style.display = 'none';
  }

  _refresh() {
    const gs = this._getGS();
    if (!gs) return;
    this.selectedGroup = gs.team?.activeGroup ?? 0;
    this._renderGroupBar();
    this._renderSlots();
    this._renderPool();
    this._renderFoot();
  }

  _renderGroupBar() {
    this.groupBar.innerHTML = '';
    const gs = this._getGS();
    const activeGroup = gs?.team?.activeGroup ?? 0;
    for (let i = 0; i < 4; i++) {
      const isSel = i === this.selectedGroup;
      const isActive = i === activeGroup;
      const btn = createEl('button', {
        style: {
          flex: 1, padding: '8px 4px',
          background: isSel ? '#ffe099' : 'rgba(255,255,255,0.7)',
          border: isSel ? '3px solid #e8a900' : '2px solid #b8a888',
          borderRadius: '10px', cursor: 'pointer',
          fontWeight: isSel ? '700' : '500',
          color: isSel ? '#3a2e20' : '#7a6a56',
          fontFamily: 'inherit',
          position: 'relative',
        },
        text: `组 ${i + 1}${isActive ? ' (启用)' : ''}`,
        parent: this.groupBar,
        onclick: () => { this.selectedGroup = i; this._refresh(); },
      });
      if (isActive) {
        btn.style.boxShadow = '0 0 0 2px rgba(232,169,0,0.35)';
      }
    }
  }

  _renderSlots() {
    this.slotsEl.innerHTML = '';
    const gs = this._getGS();
    if (!gs) return;
    const group = gs.team.groups[this.selectedGroup] || { roles: [], spirit: null };

    createEl('div', {
      style: { fontSize: '14px', fontWeight: '700', color: '#5a4a3a' },
      text: `当前组槽位（点击候选池 → 再点槽位填充；空槽位可清空）`,
      parent: this.slotsEl,
    });

    // 2 个角色槽
    for (let i = 0; i < 2; i++) {
      const roleId = group.roles[i] || null;
      const def = roleId ? CHARACTERS[roleId] : null;
      const slot = createEl('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '10px', background: 'rgba(255,255,255,0.8)',
          border: '2px solid #b8a888', borderRadius: '12px',
          cursor: 'pointer', transition: 'border-color 0.1s',
        },
        parent: this.slotsEl,
      });
      createEl('div', {
        style: { width: '22px', color: '#8a6a3a', fontWeight: '700' },
        text: `R${i + 1}`, parent: slot,
      });
      createEl('div', {
        style: {
          width: '48px', height: '48px', borderRadius: '10px',
          background: def ? '#fffbe6' : '#eee',
          border: '2px solid #b8a888', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '26px', fontFamily: '"Segoe UI Emoji",sans-serif',
        },
        text: def ? def.emoji : '—', parent: slot,
      });
      createEl('div', {
        style: { flex: '1' },
        parent: slot,
      }).innerHTML = def
        ? `<div style="font-weight:700;color:#3a2e20">${def.name}</div><div style="font-size:12px;color:#888">${def.element || ''}</div>`
        : `<div style="font-weight:700;color:#b0a090">（空）</div>`;

      slot.addEventListener('click', () => {
        // 若已填 → 清空；否则尝试放入 pickedRoleId
        if (roleId) {
          EventBus.emit(GE.DIALOG_SHOW, {
            title: '清空角色槽位',
            content: `确认清空 R${i + 1} 槽位？`,
            options: [
              { label: '取消', onSelect: () => {} },
              { label: '确定', onSelect: () => this._setRoleSlot(i, null) },
            ],
          });
        } else if (this.pickedRoleId) {
          this._setRoleSlot(i, this.pickedRoleId);
          this.pickedRoleId = null;
        } else {
          EventBus.emit(GE.TOAST_SHOW, { text: '请先在右侧候选池点选一个角色', duration: 1500 });
        }
      });
    }

    // 精灵槽
    const spiritDef = group.spirit ? SPIRITS[group.spirit] : null;
    const spSlot = createEl('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '10px', background: 'rgba(255,255,255,0.8)',
        border: '2px solid #b8a888', borderRadius: '12px', cursor: 'pointer',
      },
      parent: this.slotsEl,
    });
    createEl('div', {
      style: { width: '22px', color: '#8a6a3a', fontWeight: '700' },
      text: '精灵', parent: spSlot,
    });
    createEl('div', {
      style: {
        width: '48px', height: '48px', borderRadius: '10px',
        background: spiritDef ? '#fffbe6' : '#eee',
        border: '2px solid #b8a888', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '26px', fontFamily: '"Segoe UI Emoji",sans-serif',
      },
      text: spiritDef ? spiritDef.emoji : '—', parent: spSlot,
    });
    createEl('div', { style: { flex: '1' }, parent: spSlot }).innerHTML = spiritDef
      ? `<div style="font-weight:700;color:#3a2e20">${spiritDef.name}</div><div style="font-size:12px;color:#888">专属精灵</div>`
      : `<div style="font-weight:700;color:#b0a090">（空）</div>`;
    spSlot.addEventListener('click', () => {
      if (group.spirit) {
        EventBus.emit(GE.DIALOG_SHOW, {
          title: '清空精灵槽位',
          content: '确认清空精灵槽位？',
          options: [
            { label: '取消', onSelect: () => {} },
            { label: '确定', onSelect: () => this._setSpiritSlot(null) },
          ],
        });
      } else if (this.pickedSpiritId) {
        this._setSpiritSlot(this.pickedSpiritId);
        this.pickedSpiritId = null;
      } else {
        EventBus.emit(GE.TOAST_SHOW, { text: '请先在右侧候选池点选一个精灵', duration: 1500 });
      }
    });
  }

  _renderPool() {
    this.poolEl.innerHTML = '';
    // 角色候选
    createEl('div', {
      style: { fontSize: '13px', fontWeight: '700', color: '#5a4a3a', marginBottom: '4px' },
      text: '🎭 角色候选池',
      parent: this.poolEl,
    });
    const roleRow = createEl('div', {
      style: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
      parent: this.poolEl,
    });
    Object.values(CHARACTERS).forEach((c) => {
      const sel = this.pickedRoleId === c.id;
      const s = createEl('div', {
        style: {
          width: '64px', padding: '6px 4px',
          background: sel ? '#ffe099' : 'rgba(255,255,255,0.85)',
          border: sel ? '3px solid #e8a900' : '2px solid #b8a888',
          borderRadius: '10px', cursor: 'pointer',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
        },
        parent: roleRow,
      });
      createEl('div', {
        style: { fontSize: '26px', fontFamily: '"Segoe UI Emoji",sans-serif', lineHeight: '1' },
        text: c.emoji, parent: s,
      });
      createEl('div', {
        style: { fontSize: '11px', fontWeight: '700' },
        text: c.name, parent: s,
      });
      s.addEventListener('click', () => {
        this.pickedRoleId = sel ? null : c.id;
        this._renderPool();
      });
    });

    // 精灵候选
    createEl('div', {
      style: { fontSize: '13px', fontWeight: '700', color: '#5a4a3a', marginTop: '6px', marginBottom: '4px' },
      text: '🧚 精灵候选池',
      parent: this.poolEl,
    });
    const spRow = createEl('div', {
      style: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
      parent: this.poolEl,
    });
    Object.values(SPIRITS).forEach((sp) => {
      const sel = this.pickedSpiritId === sp.id;
      const s = createEl('div', {
        style: {
          width: '64px', padding: '6px 4px',
          background: sel ? '#ffe099' : 'rgba(255,255,255,0.85)',
          border: sel ? '3px solid #e8a900' : '2px solid #b8a888',
          borderRadius: '10px', cursor: 'pointer',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
        },
        parent: spRow,
      });
      createEl('div', {
        style: { fontSize: '26px', fontFamily: '"Segoe UI Emoji",sans-serif', lineHeight: '1' },
        text: sp.emoji, parent: s,
      });
      createEl('div', {
        style: { fontSize: '11px', fontWeight: '700' },
        text: sp.name, parent: s,
      });
      s.addEventListener('click', () => {
        this.pickedSpiritId = sel ? null : sp.id;
        this._renderPool();
      });
    });
  }

  _renderFoot() {
    this.footBar.innerHTML = '';
    const gs = this._getGS();
    const leftInfo = createEl('div', {
      style: { fontSize: '12px', color: '#7a6a56' },
      parent: this.footBar,
    });
    const daily = gs?.team?.dailyModifyCount ?? 0;
    leftInfo.textContent = `今日已修改 ${daily} / 3 次`;

    const btnRow = createEl('div', { style: { display: 'flex', gap: '8px' }, parent: this.footBar });
    createEl('button', {
      class: 'action-btn', text: '关闭', parent: btnRow,
      onclick: () => this.hide(),
    });
    createEl('button', {
      class: 'action-btn', text: '💾 保存', parent: btnRow,
      onclick: () => this._saveCurrentGroup(),
    });
    createEl('button', {
      class: 'action-btn', text: '✅ 启用此组', parent: btnRow,
      onclick: () => this._activateCurrentGroup(),
    });
  }

  _setRoleSlot(idx, roleId) {
    const gs = this._getGS();
    if (!gs) return;
    const g = gs.team.groups[this.selectedGroup];
    g.roles[idx] = roleId;
    EventBus.emit(GE.INVENTORY_CHANGE, {}); // 触发布局刷新（任何事件都行）
    this._refresh();
  }
  _setSpiritSlot(spiritId) {
    const gs = this._getGS();
    if (!gs) return;
    gs.team.groups[this.selectedGroup].spirit = spiritId;
    this._refresh();
  }

  _saveCurrentGroup() {
    const gs = this._getGS();
    if (!gs) return;
    const daily = gs.team.dailyModifyCount || 0;
    if (daily >= 3) {
      EventBus.emit(GE.TOAST_SHOW, { text: '⚠️ 今日已达修改上限（3 次）', duration: 1800 });
      return;
    }
    gs.team.dailyModifyCount = daily + 1;
    EventBus.emit(GE.TEAM_CHANGE, { groupIdx: this.selectedGroup, activeGroup: gs.team.activeGroup });
    EventBus.emit(GE.TOAST_SHOW, { text: `💾 组 ${this.selectedGroup + 1} 已保存`, duration: 1500 });
    devLog.info('[TeamPanel] TEAM_CHANGE', this.selectedGroup);
    this._renderFoot();
  }

  _activateCurrentGroup() {
    const gs = this._getGS();
    if (!gs) return;
    gs.team.activeGroup = this.selectedGroup;
    EventBus.emit(GE.TEAM_CHANGE, { groupIdx: this.selectedGroup, activeGroup: this.selectedGroup, activated: true });
    EventBus.emit(GE.TOAST_SHOW, { text: `✅ 已启用组 ${this.selectedGroup + 1}`, duration: 1500 });
    devLog.info('[TeamPanel] activate group', this.selectedGroup);
    this._refresh();
  }

  _subscribeEvents() {
    EventBus.on(GE.UI_PANEL_OPEN, ({ panel }) => {
      if (panel === 'settings' && this.visible) this.hide();
      if (panel === 'team') this.toggle();
    });
    EventBus.on(GE.UI_PANEL_CLOSE, ({ panel }) => {
      if (panel === 'team' && this.visible) this.hide();
    });
    EventBus.on(GE.STATE_RESET, () => { if (this.visible) this._refresh(); });
  }

  show() {
    if (!this.mask || this.visible) return;
    this.visible = true;
    this.mask.style.display = 'flex';
    const gs = this._getGS();
    if (gs) { gs.uiState = gs.uiState || {}; gs.uiState.activePanel = 'team'; }
    this.pickedRoleId = null; this.pickedSpiritId = null;
    this._refresh();
  }
  hide() {
    if (!this.mask || !this.visible) return;
    this.visible = false;
    this.mask.style.display = 'none';
    const gs = this._getGS();
    if (gs && gs.uiState && gs.uiState.activePanel === 'team') gs.uiState.activePanel = null;
    EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'team' });
  }
  toggle() { this.visible ? this.hide() : this.show(); }

  _getGS() {
    if (this.director?.getGS) return this.director.getGS();
    if (window.__gameDirector?.getGS) return window.__gameDirector.getGS();
    return null;
  }
}

export default TeamPanel;
