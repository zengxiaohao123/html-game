// src/ui/panels/RolePanel.js
// Phase 4 —— 角色页面
// 顶部：3 个角色头像横排（点击切换）
// 左：技能列表（天赋 + 核心技能）
// 右：属性卡（角色名 / 元素 / 精灵 / 羁绊等级 / 好感度）
// 底部：【启用此角色编队】按钮 → 弹 DialogBox 确认 → emit GE.CHARACTER_SELECTED

import { EventBus } from '../../core/EventBus.js';
import { GE } from '../../core/GameEvents.js';
import { Assets } from '../../core/Assets.js';
import { CHARACTERS, SKILLS, SPIRITS, getSkillsByRole } from '../../data/characters.js';
import { createEl, qs } from '../dom.js';
import { devLog } from '../../core/Logger.js';

/** 返回角色已解锁状态（Phase 4：默认全部解锁，只占位置留 Phase 5 扩展） */
function isUnlocked(roleId) {
  return true;
}

export class RolePanel {
  constructor(director) {
    this.director = director;
    this.mask = null;
    this.panel = null;
    this.headBar = null;
    this.bodyEl = null;
    this.skillListEl = null;
    this.attrEl = null;
    this.selectedRoleId = 'yumo';
    this.visible = false;
  }

  mount(parent = qs('body')) {
    this.mask = createEl('div', {
      class: ['panel-mask'],
      parent,
      onclick: (e) => { if (e.target === this.mask) this.hide(); },
    });

    this.panel = createEl('div', {
      class: ['panel-card', 'role-panel'],
      style: {
        width: 'min(720px, 94vw)',
        maxHeight: 'min(620px, 86vh)',
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      },
      parent: this.mask,
    });

    // 头部栏：标题 + 关闭
    const headRow = createEl('div', {
      style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
      parent: this.panel,
    });
    createEl('div', {
      style: { fontSize: '20px', fontWeight: '700', color: '#3a2e20' },
      text: '👤 角色图鉴（J 切换）',
      parent: headRow,
    });
    createEl('button', {
      class: 'inventory-close',
      text: '✖',
      parent: headRow,
      onclick: () => this.hide(),
    });

    // 角色头像横排
    this.headBar = createEl('div', {
      style: {
        display: 'flex', gap: '14px', padding: '10px',
        background: 'rgba(255,255,255,0.55)',
        border: '2px solid #b8a888', borderRadius: '14px',
        justifyContent: 'center',
      },
      parent: this.panel,
    });
    this._buildRoleHeads();

    // 主 body：左技能列表 + 右属性卡
    this.bodyEl = createEl('div', {
      style: {
        flex: '1', minHeight: '0',
        display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '12px',
      },
      parent: this.panel,
    });

    this.skillListEl = createEl('div', {
      style: {
        overflowY: 'auto', padding: '10px',
        background: 'rgba(255,255,255,0.55)',
        border: '2px solid #b8a888', borderRadius: '14px',
      },
      parent: this.bodyEl,
    });
    this.attrEl = createEl('div', {
      style: {
        padding: '12px',
        background: 'linear-gradient(135deg, #fffaf0 0%, #fff3c4 100%)',
        border: '2px solid #b8a888', borderRadius: '14px',
        display: 'flex', flexDirection: 'column', gap: '8px',
      },
      parent: this.bodyEl,
    });

    // 底部操作区
    const footRow = createEl('div', {
      style: {
        display: 'flex', gap: '10px', justifyContent: 'flex-end',
        borderTop: '2px dashed #b8a888', paddingTop: '10px', flexShrink: 0,
      },
      parent: this.panel,
    });
    createEl('button', {
      class: 'action-btn',
      text: '关闭',
      parent: footRow,
      onclick: () => this.hide(),
    });
    createEl('button', {
      class: 'action-btn',
      text: '✅ 确认选此角色',
      parent: footRow,
      onclick: () => this._confirmSelect(),
    });

    this._subscribeEvents();
    this.mask.style.display = 'none';
  }

  _buildRoleHeads() {
    this.headBar.innerHTML = '';
    Object.values(CHARACTERS).forEach((c) => {
      const unlocked = isUnlocked(c.id);
      const selected = this.selectedRoleId === c.id;
      const slot = createEl('div', {
        style: {
          width: '72px', padding: '6px 4px',
          background: selected ? '#ffe099' : 'rgba(255,255,255,0.7)',
          border: selected ? '3px solid #e8a900' : '2px solid #b8a888',
          borderRadius: '12px', cursor: 'pointer',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
          boxShadow: selected ? '0 0 0 2px rgba(232,169,0,0.35)' : 'none',
          opacity: unlocked ? 1 : 0.45,
          transition: 'transform 0.1s, box-shadow 0.1s',
        },
        parent: this.headBar,
      });
      createEl('div', {
        style: {
          fontSize: '32px', lineHeight: '1',
          fontFamily: '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif',
        },
        text: c.emoji,
        parent: slot,
      });
      createEl('div', {
        style: { fontSize: '12px', fontWeight: '700', color: '#3a2e20' },
        text: c.name,
        parent: slot,
      });
      if (!unlocked) {
        createEl('div', {
          style: { fontSize: '10px', color: '#888' },
          text: '未解锁',
          parent: slot,
        });
      }

      slot.addEventListener('click', () => {
        if (!unlocked) return;
        this.selectedRoleId = c.id;
        this._buildRoleHeads();
        this._renderBody();
      });
    });
  }

  _renderBody() {
    this.skillListEl.innerHTML = '';
    this.attrEl.innerHTML = '';

    const c = CHARACTERS[this.selectedRoleId];
    if (!c) return;

    // 技能列表
    const skills = getSkillsByRole(c.id);
    createEl('div', {
      style: { fontSize: '15px', fontWeight: '700', color: '#5a4a3a', marginBottom: '8px' },
      text: `${c.name} 的技能 / 天赋`,
      parent: this.skillListEl,
    });

    if (skills.length === 0) {
      createEl('div', {
        style: { color: '#b0a090', fontSize: '13px' },
        text: '（暂无数据）',
        parent: this.skillListEl,
      });
    } else {
      skills.forEach((sk) => {
        const row = createEl('div', {
          style: {
            padding: '8px 10px', marginBottom: '6px',
            background: 'rgba(255,255,255,0.8)', border: '2px solid #b8a888',
            borderRadius: '10px',
          },
          parent: this.skillListEl,
        });
        const top = createEl('div', {
          style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' },
          parent: row,
        });
        createEl('span', {
          style: { fontSize: '20px', lineHeight: '1', fontFamily: '"Segoe UI Emoji",sans-serif' },
          text: sk.emoji, parent: top,
        });
        createEl('span', {
          style: { fontWeight: '700', fontSize: '14px', color: '#3a2e20' },
          text: sk.name, parent: top,
        });
        if (sk.isLinkSkill) {
          createEl('span', {
            style: { fontSize: '10px', color: '#c07a20', background: '#ffe099', padding: '0 5px', borderRadius: '8px', marginLeft: 'auto' },
            text: '连携技', parent: top,
          });
        }
        createEl('div', {
          style: { fontSize: '12px', color: '#4a3a2a', lineHeight: '1.6' },
          text: sk.description || '',
          parent: row,
        });
      });
    }

    // 属性卡
    const spirit = SPIRITS[c.spiritId] || null;
    createEl('div', {
      style: { fontSize: '16px', fontWeight: '700', color: '#3a2e20', textAlign: 'center', paddingBottom: '6px', borderBottom: '2px solid #e8a900' },
      text: `${c.emoji}  ${c.name}`,
      parent: this.attrEl,
    });
    const rows = [
      ['元素', c.element],
      ['精灵', spirit ? `${spirit.emoji} ${spirit.name}` : '—'],
      ['定位', c.isMainChar ? '主角 / 核心' : '辅助'],
      ['羁绊等级', 'Lv.1（Phase 5 开放）'],
      ['好感度', '—（Phase 5 开放）'],
    ];
    rows.forEach(([k, v]) => {
      const row = createEl('div', {
        style: { display: 'flex', justifyContent: 'space-between', fontSize: '13px' },
        parent: this.attrEl,
      });
      createEl('span', { style: { color: '#7a6a56' }, text: k, parent: row });
      createEl('span', { style: { fontWeight: '700', color: '#3a2e20' }, text: v, parent: row });
    });
  }

  _subscribeEvents() {
    EventBus.on(GE.UI_PANEL_OPEN, ({ panel }) => {
      if (panel === 'settings' && this.visible) this.hide();
      if (panel === 'role') this.toggle();
    });
    EventBus.on(GE.UI_PANEL_CLOSE, ({ panel }) => {
      if (panel === 'role' && this.visible) this.hide();
    });
    EventBus.on(GE.STATE_RESET, () => { if (this.visible) this._renderBody(); });
  }

  show() {
    if (!this.mask || this.visible) return;
    this.visible = true;
    this.mask.style.display = 'flex';
    const gs = this._getGS();
    if (gs) { gs.uiState = gs.uiState || {}; gs.uiState.activePanel = 'role'; }
    this._buildRoleHeads();
    this._renderBody();
  }
  hide() {
    if (!this.mask || !this.visible) return;
    this.visible = false;
    this.mask.style.display = 'none';
    const gs = this._getGS();
    if (gs && gs.uiState && gs.uiState.activePanel === 'role') gs.uiState.activePanel = null;
    EventBus.emit(GE.UI_PANEL_CLOSE, { panel: 'role' });
  }
  toggle() { this.visible ? this.hide() : this.show(); }

  _confirmSelect() {
    const c = CHARACTERS[this.selectedRoleId];
    if (!c) return;
    // 走 DialogBox 二次确认（验收标准：DialogBox 触发场景之一）
    EventBus.emit(GE.DIALOG_SHOW, {
      title: '确认角色选择',
      content: `你确认将角色 ${c.emoji} ${c.name} 设为目标角色吗？`,
      options: [
        { label: '取消', onSelect: () => {} },
        { label: '确定', onSelect: () => {
          EventBus.emit(GE.CHARACTER_SELECTED, { roleId: c.id });
          EventBus.emit(GE.TOAST_SHOW, { text: `✅ 已选择角色：${c.name}`, duration: 1500 });
          devLog.info('[RolePanel] CHARACTER_SELECTED', c.id);
        }},
      ],
    });
  }

  _getGS() {
    if (this.director?.getGS) return this.director.getGS();
    if (window.__gameDirector?.getGS) return window.__gameDirector.getGS();
    return null;
  }
}

export default RolePanel;
