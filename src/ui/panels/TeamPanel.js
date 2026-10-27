// TeamPanel.js —— Phase 4 重写  ·  快捷键 L
// 4 组 tab × 每组 3 角色 + 1 精灵槽
// 候选池：3 角色 + 3 精灵（emoji 对齐 characters.js 实导出）
// 启用按钮切 activeGroup；合法校验：角色数∈[1,3] + 精灵存在
// 每日 3 次修改限制（gs.team.dailyModifyCount 由 DaySystem.startNewDay 清零）
// 快捷编队 → 右侧展开选人交互

import { EventBus } from '../../core/EventBus.js';
import { GE } from '../../core/GameEvents.js';
import { CHARACTERS, SPIRITS } from '../../data/characters.js';
import { createStandardPanel } from './_panelHelper.js';
import { createEl, qs } from '../dom.js';
import { devLog } from '../../core/Logger.js';

const EMOJI_FONT = '"Segoe UI Emoji", sans-serif';
const SLOT_COUNT = 3;

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
    this._beforeEditSnapshot = null;
    this._quickEditMode = false;
    this._quickSlots = [null, null, null]; // 快捷编队临时选中
    this._quickSpiritId = null;
    this._quickCurrentSlot = null; // 当前正在填充的序号 (0/1/2)
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

    // 底部操作：关闭 / 快捷编队 / 启用
    const foot = createEl('div', {
      style: { display: 'flex', gap: '8px', justifyContent: 'flex-end', borderTop: '2px dashed #b8a888', paddingTop: '8px' },
      parent: body,
    });
    createEl('button', { class: 'action-btn', text: '关闭', parent: foot, onclick: () => this.hide() });
    createEl('button', { class: 'action-btn', text: '⚡ 快捷编队', parent: foot, onclick: () => this._toggleQuickEdit() });
    createEl('button', { class: 'action-btn', text: '✅ 启用', parent: foot, onclick: () => this._activate() });

    // 进入时拍快照
    this._takeSnapshot();
    this._refresh();
  }

  _subscribe() {
    EventBus.on(GE.UI_PANEL_OPEN, ({ panel }) => {
      if (panel === 'team') {
        if (!this.helper?.visible) {
          this._takeSnapshot();
          this._quickEditMode = false;
        }
        this.toggle();
      }
    });
    EventBus.on(GE.UI_PANEL_CLOSE, ({ panel }) => { if (panel === 'team' && this.helper?.visible) this.helper.hide(); });
  }

  _getGS() { return this.director?.getGS?.(); }

  _takeSnapshot() {
    const gs = this._getGS(); if (!gs?.team) return;
    const g = gs.team.groups[this.selectedGroup];
    this._beforeEditSnapshot = {
      roles: [...(g?.roles || [])],
      spirit: g?.spirit || null,
    };
    devLog.info('[TeamPanel] snapshot taken', this._beforeEditSnapshot);
  }

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
        onclick: () => {
          this.selectedGroup = i;
          this._quickEditMode = false;
          this._takeSnapshot();
          this._refresh();
        },
      });
    }

    const group = gs?.team?.groups?.[this.selectedGroup] || { roles: [], spirit: null };
    if (!group.roles) group.roles = [];

    if (this._quickEditMode) {
      this._renderQuickEdit(group);
    } else {
      this._renderNormal(group);
    }
  }

  // ── 普通模式渲染 ──
  _renderNormal(group) {
    this.slotsWrap.innerHTML = '';
    this.poolWrap.innerHTML = '';

    createEl('div', { style: { fontSize: '13px', fontWeight: '700', color: '#5a4a3a', marginBottom: '6px' }, text: `🎭 槽位（${SLOT_COUNT} 角色 + 1 精灵；点候选池 → 再点槽位；点已填槽可清空）`, parent: this.slotsWrap });

    for (let i = 0; i < SLOT_COUNT; i++) {
      this._buildRoleSlot(group.roles[i] || null, i, this.slotsWrap);
    }
    this._buildSpiritSlot(group.spirit || null, this.slotsWrap);

    // 候选池
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

  // ── 快捷编队模式渲染 ──
  _renderQuickEdit(group) {
    // 初始化临时数据（只在第一次进入时从当前组拷贝）
    if (!this._quickSlotsInited) {
      this._quickSlots = [];
      for (let i = 0; i < SLOT_COUNT; i++) this._quickSlots.push(group.roles[i] || null);
      this._quickSpiritId = group.spirit || null;
      this._quickSlotsInited = true;
    }

    // 左：槽位预览（大）
    this.slotsWrap.innerHTML = '';
    createEl('div', { style: { fontSize: '13px', fontWeight: '800', color: '#c07a20', marginBottom: '6px' }, text: '⚡ 快捷编队模式', parent: this.slotsWrap });
    for (let i = 0; i < SLOT_COUNT; i++) {
      this._buildQuickRoleSlot(this._quickSlots[i], i, this.slotsWrap);
    }
    this._buildQuickSpiritSlot(this._quickSpiritId, this.slotsWrap);

    // 右：候选池（变宽）
    this.poolWrap.innerHTML = '';
    createEl('div', { style: { fontSize: '12px', fontWeight: '800', color: '#5a4a3a', marginBottom: '4px' }, text: '🎭 角色（点 → 填入当前高亮槽位）', parent: this.poolWrap });
    const rRow = createEl('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }, parent: this.poolWrap });
    Object.values(CHARACTERS).forEach((c) => {
      const idx = this._quickSlots.indexOf(c.id);
      const inUse = idx >= 0;
      const el = createEl('div', {
        style: {
          padding: '6px', background: inUse ? '#e8f5e9' : 'rgba(255,255,255,0.8)',
          border: inUse ? '3px solid #2a8a3a' : '2px solid #b8a888', borderRadius: '10px',
          cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
          position: 'relative',
        },
        parent: rRow,
      });
      if (inUse) {
        createEl('div', { style: { position: 'absolute', top: '-4px', left: '-4px', width: '18px', height: '18px', background: '#2a8a3a', color: '#fff', borderRadius: '50%', fontSize: '11px', fontWeight: '800', display: 'flex', alignItems: 'center', justifyContent: 'center' }, text: String(idx + 1), parent: el });
      }
      createEl('div', { style: { fontSize: '26px', fontFamily: EMOJI_FONT }, text: c.emoji, parent: el });
      createEl('div', { style: { fontSize: '11px', fontWeight: '700' }, text: c.name, parent: el });
      el.addEventListener('click', () => this._quickPickRole(c.id));
    });

    createEl('div', { style: { fontSize: '12px', fontWeight: '800', color: '#5a4a3a', marginTop: '6px' }, text: '🧚 精灵（点 → 填入精灵槽）', parent: this.poolWrap });
    const sRow = createEl('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }, parent: this.poolWrap });
    Object.values(SPIRITS).forEach((s) => {
      const sel = this._quickSpiritId === s.id;
      const el = createEl('div', {
        style: {
          padding: '6px', background: sel ? '#e8f5e9' : 'rgba(255,255,255,0.8)',
          border: sel ? '3px solid #2a8a3a' : '2px solid #b8a888', borderRadius: '10px',
          cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
        },
        parent: sRow,
      });
      createEl('div', { style: { fontSize: '26px', fontFamily: EMOJI_FONT }, text: s.emoji, parent: el });
      createEl('div', { style: { fontSize: '11px', fontWeight: '700' }, text: s.name, parent: el });
      el.addEventListener('click', () => { this._quickSpiritId = sel ? null : s.id; this._refresh(); });
    });

    // 快捷编队底部：覆盖一个"保存"按钮（临时改 DOM）
    const quickFoot = createEl('div', {
      style: { display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '8px' },
      parent: this.poolWrap,
    });
    createEl('button', {
      class: 'action-btn',
      style: { background: '#e8f5e9', border: '3px solid #2a8a3a', fontWeight: '800' },
      text: '💾 保存到组',
      parent: quickFoot,
      onclick: () => this._quickSave(),
    });
    createEl('button', {
      class: 'action-btn',
      text: '取消',
      parent: quickFoot,
      onclick: () => { this._quickEditMode = false; this._quickSlotsInited = false; this._refresh(); },
    });
  }

  _toggleQuickEdit() {
    this._quickEditMode = !this._quickEditMode;
    this._quickSlotsInited = false; // 让它下次从 group 重新拷贝
    this._refresh();
  }

  _quickPickRole(roleId) {
    // 如果角色已在某个槽位，点击=移除
    const existingIdx = this._quickSlots.indexOf(roleId);
    if (existingIdx >= 0) {
      this._quickSlots[existingIdx] = null;
      this._refresh();
      return;
    }
    // 找第一个空槽
    const emptyIdx = this._quickSlots.findIndex(s => s === null);
    if (emptyIdx >= 0) {
      this._quickSlots[emptyIdx] = roleId;
    } else {
      // 都满了，覆盖第一个
      this._quickSlots[0] = roleId;
    }
    this._refresh();
  }

  _quickSave() {
    const gs = this._getGS(); if (!gs) return;
    const g = gs.team.groups[this.selectedGroup];
    g.roles = this._quickSlots.slice();
    g.spirit = this._quickSpiritId;
    this._quickEditMode = false;
    this._quickSlotsInited = false;
    // 保存后更新快照
    this._takeSnapshot();
    EventBus.emit(GE.TOAST_SHOW, { text: `💾 已保存到组 ${this.selectedGroup + 1}`, duration: 1200 });
    this._refresh();
  }

  _buildQuickRoleSlot(roleId, idx, parent) {
    const def = roleId ? CHARACTERS[roleId] : null;
    const row = createEl('div', {
      style: { padding: '8px 10px', marginBottom: '6px', background: 'rgba(255,255,255,0.8)', border: '2px solid #2a8a3a', borderRadius: '10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' },
      parent,
    });
    createEl('div', { style: { width: '26px', height: '26px', background: '#2a8a3a', color: '#fff', borderRadius: '50%', fontWeight: '800', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px' }, text: String(idx + 1), parent: row });
    createEl('div', { style: { width: '44px', height: '44px', borderRadius: '10px', background: def ? '#fffbe6' : '#eee', border: '2px solid #b8a888', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', fontFamily: EMOJI_FONT }, text: def ? def.emoji : '—', parent: row });
    createEl('div', { style: { flex: '1' }, parent: row }).innerHTML = def
      ? `<div style="font-weight:800;color:#3a2e20">${def.name}</div><div style="font-size:11px;color:#888">${def.element}</div>`
      : `<div style="font-weight:800;color:#b0a090">（空 — 点右侧角色填入）</div>`;

    row.addEventListener('click', () => {
      if (roleId) {
        this._quickSlots[idx] = null;
        this._refresh();
      }
    });
  }

  _buildQuickSpiritSlot(spiritId, parent) {
    const def = spiritId ? SPIRITS[spiritId] : null;
    const row = createEl('div', {
      style: { padding: '8px 10px', background: 'rgba(255,255,255,0.8)', border: '2px solid #c07a20', borderRadius: '10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' },
      parent,
    });
    createEl('div', { style: { width: '44px', height: '44px', borderRadius: '10px', background: def ? '#fffbe6' : '#eee', border: '2px solid #b8a888', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', fontFamily: EMOJI_FONT }, text: def ? def.emoji : '🧚', parent: row });
    createEl('div', { style: { flex: '1' }, parent: row }).innerHTML = def
      ? `<div style="font-weight:800;color:#3a2e20">${def.name}</div><div style="font-size:11px;color:#888">专属精灵</div>`
      : `<div style="font-weight:800;color:#b0a090">（空 — 点右侧精灵填入）</div>`;

    row.addEventListener('click', () => {
      if (spiritId) {
        this._quickSpiritId = null;
        this._refresh();
      }
    });
  }

  // ── 普通模式下的槽位构建 ──
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

  _activate() {
    const gs = this._getGS(); if (!gs) return;
    const group = gs.team.groups[this.selectedGroup];

    // ── 合法性校验 ──
    const validRoles = (group.roles || []).filter(r => r); // 过滤空槽
    if (validRoles.length < 1 || validRoles.length > SLOT_COUNT) {
      EventBus.emit(GE.TOAST_SHOW, { text: `❌ 必须有 1~${SLOT_COUNT} 名角色`, duration: 1500 });
      // 还原快照
      gs.team.groups[this.selectedGroup] = JSON.parse(JSON.stringify(this._beforeEditSnapshot));
      this._refresh();
      return;
    }
    if (!group.spirit) {
      EventBus.emit(GE.TOAST_SHOW, { text: '❌ 必须有且只有 1 名精灵', duration: 1500 });
      gs.team.groups[this.selectedGroup] = JSON.parse(JSON.stringify(this._beforeEditSnapshot));
      this._refresh();
      return;
    }

    // ── 比对顺序变化：角色集合 + 精灵是否实质改变 ──
    const before = this._beforeEditSnapshot || { roles: [], spirit: null };
    const newRoles = [...validRoles].sort();
    const oldRoles = [...(before.roles || []).filter(r => r)].sort();
    const rolesSame = JSON.stringify(newRoles) === JSON.stringify(oldRoles);
    const spiritSame = (group.spirit || null) === (before.spirit || null);
    const noEffectiveChange = rolesSame && spiritSame;

    if (!noEffectiveChange) {
      // ── 每日 3 次限制 ──
      if ((gs.team.dailyModifyCount || 0) >= 3) {
        EventBus.emit(GE.TOAST_SHOW, { text: '❌ 今日已修改 3 次，请明天再来～', duration: 1800 });
        gs.team.groups[this.selectedGroup] = JSON.parse(JSON.stringify(this._beforeEditSnapshot));
        this._refresh();
        return;
      }
      gs.team.dailyModifyCount = (gs.team.dailyModifyCount || 0) + 1;
    }

    // ── 启用 ──
    gs.team.activeGroup = this.selectedGroup;

    // 无论有没有实质内容变化 —— 只要 activeGroup 变了就 emit TEAM_CHANGE
    // SpiritArea / InfoPanel 等依赖此事件刷新队伍相关 UI（精灵名称/图标）
    EventBus.emit(GE.TEAM_CHANGE, { groupIdx: this.selectedGroup, activated: true });

    if (!noEffectiveChange) {
      devLog.info('[TeamPanel] team changed to group', this.selectedGroup + 1);
    } else {
      EventBus.emit(GE.TOAST_SHOW, { text: `✅ 已启用组 ${this.selectedGroup + 1}`, duration: 1200 });
    }

    // 更新快照为当前状态
    this._takeSnapshot();
    this._refresh();
  }

  show() { this.helper?.show(); }
  hide() { this.helper?.hide(); }
  toggle() { this.helper?.toggle(); }
}

export default TeamPanel;
