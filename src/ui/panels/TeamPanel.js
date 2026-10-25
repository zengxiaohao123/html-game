// TeamPanel.js —— Phase 4 重写  ·  快捷键 L
// 4 组 tab × 每组 2 角色 + 1 精灵槽
// 候选池：3 角色 + 3 精灵（emoji 对齐 characters.js 实导出）
// 保存 emit GE.TEAM_CHANGE；启用按钮切 activeGroup
// 外观严格套 InventoryPanel 模板（_panelHelper）

import { EventBus } from '../../core/EventBus.js';
import { GE } from '../../core/GameEvents.js';
import { CHARACTERS, SPIRITS } from '../../data/characters.js';
import { createStandardPanel } from './_panelHelper.js';
import { createEl, qs } from '../dom.js';
import { devLog } from '../../core/Logger.js';

const EMOJI_FONT = '"Segoe UI Emoji", sans-serif';

export class TeamPanel {
  constructor(director) {
    this.director = director;
    this.helper = null;
    this.groupTabs = null;
    this.slotsWrap = null;
    this.poolWrap = null;
    this.selectedGroup = 0;
    this.pickedRoleId = null;
    this.pickedSpiritId = null;
  }

  mount() {
    this.helper = createStandardPanel({
      title: '👥 编队（L 切换）',
      panelKey: 'team',
      width: 'min(92vw, 900px)',
      height: 'min(86vh, 720px)',
      onMount: (_p, body) => this._build(body),
    });
    this._subscribe();
  }

  _build(body) {
    // 4 组 tab
    this.groupTabs = createEl('div', {
      style: { display: 'flex', gap: '8px', marginBottom: '6px' }, parent: body,
    });
    // 主区：左槽位 + 右候选池
    const main = createEl('div', {
      style: { flex: '1', minHeight: '0', display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: '10px' },
      parent: body,
    });
    this.slotsWrap = createEl('div', {
      style: { padding: '10px', background: 'rgba(255,255,255,0.55)', border: '2px solid #b8a888', borderRadius: '12px', overflowY: 'auto' },
      parent: main,
    });
    this.poolWrap = createEl('div', {
      style: { padding: '10px', background: 'rgba(255,255,255,0.55)', border: '2px solid #b8a888', borderRadius: '12px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' },
      parent: main,
    });

    // 底部操作：保存 / 启用 / 关闭
    const foot = createEl('div', {
      style: { display: 'flex', gap: '8px', justifyContent: 'flex-end', borderTop: '2px dashed #b8a888', paddingTop: '8px' },
      parent: body,
    });
    createEl('button', { class: 'action-btn', text: '关闭', parent: foot, onclick: () => this.hide() });
    createEl('button', { class: 'action-btn', text: '💾 保存组', parent: foot, onclick: () => this._save() });
    createEl('button', { class: 'action-btn', text: '✅ 启用此组', parent: foot, onclick: () => this._activate() });

    this._refresh();
  }

  _subscribe() {
    EventBus.on(GE.UI_PANEL_OPEN, ({ panel }) => { if (panel === 'team') this.toggle(); });
    EventBus.on(GE.UI_PANEL_CLOSE, ({ panel }) => { if (panel === 'team' && this.helper?.visible) this.helper.hide(); });
  }

  _getGS() { return this.director?.getGS?.(); }

  _refresh() {
    const gs = this._getGS();
    const activeGroup = gs?.team?.activeGroup ?? 0;

    // tab 行
    this.groupTabs.innerHTML = '';
    for (let i = 0; i < 4; i++) {
      const sel = i === this.selectedGroup;
      const isActive = i === activeGroup;
      createEl('button', {
        class: ['action-btn'],
        style: {
          background: sel ? '#ffe099' : 'rgba(255,255,255,0.7)',
          border: sel ? '3px solid #e8a900' : '2px solid #b8a888',
          fontWeight: sel || isActive ? '800' : '600',
        },
        text: `组 ${i + 1}${isActive ? ' ✅' : ''}`,
        parent: this.groupTabs,
        onclick: () => { this.selectedGroup = i; this._refresh(); },
      });
    }

    // 槽位
    this.slotsWrap.innerHTML = '';
    const group = gs?.team?.groups?.[this.selectedGroup] || { roles: [], spirit: null };
    if (!group.roles) group.roles = [];

    createEl('div', { style: { fontSize: '13px', fontWeight: '700', color: '#5a4a3a', marginBottom: '6px' }, text: '🎭 槽位（点候选池 → 再点槽位；点已填槽可清空）', parent: this.slotsWrap });

    for (let i = 0; i < 2; i++) {
      this._buildRoleSlot(group.roles[i] || null, i, this.slotsWrap);
    }
    this._buildSpiritSlot(group.spirit || null, this.slotsWrap);

    // 候选池
    this.poolWrap.innerHTML = '';
    createEl('div', { style: { fontSize: '12px', fontWeight: '700', color: '#5a4a3a' }, text: '🎭 角色候选', parent: this.poolWrap });
    const rRow = createEl('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' }, parent: this.poolWrap });
    Object.values(CHARACTERS).forEach((c) => {
      const sel = this.pickedRoleId === c.id;
      const el = createEl('div', {
        style: {
          width: '72px', padding: '6px', background: sel ? '#ffe099' : 'rgba(255,255,255,0.8)',
          border: sel ? '3px solid #e8a900' : '2px solid #b8a888', borderRadius: '10px',
          cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
        },
        parent: rRow,
      });
      createEl('div', { style: { fontSize: '26px', fontFamily: EMOJI_FONT }, text: c.emoji, parent: el });
      createEl('div', { style: { fontSize: '11px', fontWeight: '700' }, text: c.name, parent: el });
      el.addEventListener('click', () => { this.pickedRoleId = sel ? null : c.id; this._refresh(); });
    });

    createEl('div', { style: { fontSize: '12px', fontWeight: '700', color: '#5a4a3a', marginTop: '4px' }, text: '🧚 精灵候选', parent: this.poolWrap });
    const sRow = createEl('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' }, parent: this.poolWrap });
    Object.values(SPIRITS).forEach((s) => {
      const sel = this.pickedSpiritId === s.id;
      const el = createEl('div', {
        style: {
          width: '72px', padding: '6px', background: sel ? '#ffe099' : 'rgba(255,255,255,0.8)',
          border: sel ? '3px solid #e8a900' : '2px solid #b8a888', borderRadius: '10px',
          cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
        },
        parent: sRow,
      });
      createEl('div', { style: { fontSize: '26px', fontFamily: EMOJI_FONT }, text: s.emoji, parent: el });
      createEl('div', { style: { fontSize: '11px', fontWeight: '700' }, text: s.name, parent: el });
      el.addEventListener('click', () => { this.pickedSpiritId = sel ? null : s.id; this._refresh(); });
    });
  }

  _buildRoleSlot(roleId, idx, parent) {
    const def = roleId ? CHARACTERS[roleId] : null;
    const row = createEl('div', {
      style: { padding: '8px 10px', marginBottom: '6px', background: 'rgba(255,255,255,0.8)', border: '2px solid #b8a888', borderRadius: '10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' },
      parent,
    });
    createEl('div', { style: { width: '22px', color: '#8a6a3a', fontWeight: '800' }, text: `R${idx + 1}`, parent: row });
    createEl('div', { style: { width: '44px', height: '44px', borderRadius: '10px', background: def ? '#fffbe6' : '#eee', border: '2px solid #b8a888', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', fontFamily: EMOJI_FONT }, text: def ? def.emoji : '—', parent: row });
    createEl('div', { style: { flex: '1' }, parent: row }).innerHTML = def
      ? `<div style="font-weight:800;color:#3a2e20">${def.name}</div><div style="font-size:11px;color:#888">${def.element}</div>`
      : `<div style="font-weight:800;color:#b0a090">（空）</div>`;

    row.addEventListener('click', () => {
      if (roleId) {
        // 清空
        EventBus.emit(GE.DIALOG_SHOW, {
          title: '清空角色槽位',
          content: `确认清空 R${idx + 1} 槽位？`,
          options: [
            { label: '取消', onSelect: () => {} },
            { label: '确定', onSelect: () => this._setRole(idx, null) },
          ],
        });
      } else if (this.pickedRoleId) {
        this._setRole(idx, this.pickedRoleId);
        this.pickedRoleId = null;
      } else {
        EventBus.emit(GE.TOAST_SHOW, { text: '请先在右侧选一个角色', duration: 1200 });
      }
    });
  }

  _buildSpiritSlot(spiritId, parent) {
    const def = spiritId ? SPIRITS[spiritId] : null;
    const row = createEl('div', {
      style: { padding: '8px 10px', background: 'rgba(255,255,255,0.8)', border: '2px solid #b8a888', borderRadius: '10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' },
      parent,
    });
    createEl('div', { style: { width: '44px', height: '44px', borderRadius: '10px', background: def ? '#fffbe6' : '#eee', border: '2px solid #b8a888', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', fontFamily: EMOJI_FONT }, text: def ? def.emoji : '🧚', parent: row });
    createEl('div', { style: { flex: '1' }, parent: row }).innerHTML = def
      ? `<div style="font-weight:800;color:#3a2e20">${def.name}</div><div style="font-size:11px;color:#888">专属精灵</div>`
      : `<div style="font-weight:800;color:#b0a090">（空）</div>`;

    row.addEventListener('click', () => {
      if (spiritId) {
        EventBus.emit(GE.DIALOG_SHOW, { title: '清空精灵槽位', content: '确认清空精灵槽位？', options: [
          { label: '取消', onSelect: () => {} },
          { label: '确定', onSelect: () => this._setSpirit(null) },
        ]});
      } else if (this.pickedSpiritId) {
        this._setSpirit(this.pickedSpiritId);
        this.pickedSpiritId = null;
      } else {
        EventBus.emit(GE.TOAST_SHOW, { text: '请先在右侧选一个精灵', duration: 1200 });
      }
    });
  }

  _setRole(idx, roleId) {
    const gs = this._getGS(); if (!gs) return;
    const g = gs.team.groups[this.selectedGroup]; g.roles[idx] = roleId;
    this._refresh();
  }
  _setSpirit(spiritId) {
    const gs = this._getGS(); if (!gs) return;
    gs.team.groups[this.selectedGroup].spirit = spiritId;
    this._refresh();
  }

  _save() {
    EventBus.emit(GE.TEAM_CHANGE, { groupIdx: this.selectedGroup });
    EventBus.emit(GE.TOAST_SHOW, { text: `💾 组 ${this.selectedGroup + 1} 已保存`, duration: 1200 });
    devLog.info('[TeamPanel] TEAM_CHANGE group=', this.selectedGroup);
  }
  _activate() {
    const gs = this._getGS(); if (!gs) return;
    gs.team.activeGroup = this.selectedGroup;
    EventBus.emit(GE.TEAM_CHANGE, { groupIdx: this.selectedGroup, activated: true });
    EventBus.emit(GE.TOAST_SHOW, { text: `✅ 已启用组 ${this.selectedGroup + 1}`, duration: 1200 });
    this._refresh();
  }

  show() { this.helper?.show(); }
  hide() { this.helper?.hide(); }
  toggle() { this.helper?.toggle(); }
}

export default TeamPanel;
