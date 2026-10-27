// RolePanel.js —— Phase 4 重写
// 快捷键 C  ·  外观严格套 InventoryPanel 模板（_panelHelper）
// 3 角色 emoji 横排（余默🧑💧 夏阳🔥 陆悠悠🌪️风属性——characters.js 实导出为准）
// 中间 tab：技能 / 羁绊
// 右侧属性栏
// 纯查看页 —— 没有"选此角色"概念，角色切换直接点头像

import { EventBus } from '../../core/EventBus.js';
import { GE } from '../../core/GameEvents.js';
import { CHARACTERS, SPIRITS, SKILLS, getSkillsByRole } from '../../data/characters.js';
import { TALENTS } from '../../data/talents.js';
import { createStandardPanel } from './_panelHelper.js';
import { createEl, qs } from '../dom.js';
import { devLog } from '../../core/Logger.js';

const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';

// 元素 emoji —— characters.js 实导出：yumo=water 💧 / xiayang=fire 🔥 / luyouyou=wind 🌪️
const ELEMENT_EMOJI = { water: '💧', fire: '🔥', wind: '🌪️', lightning: '⚡', earth: '🪨', ice: '❄️' };

export class RolePanel {
  constructor(director) {
    this.director = director;
    this.helper = null;
    this.headsRow = null;
    this.tabsRow = null;
    this.tabBody = null;
    this.attrCol = null;
    this.activeTab = 'skills';   // 'skills' | 'bond'
    this.selectedRoleId = 'yumo';
  }

  mount() {
    this.helper = createStandardPanel({
      title: '👤 角色图鉴（C 切换）',
      panelKey: 'role',
      width: 'min(92vw, 900px)',
      height: 'min(86vh, 720px)',
      onMount: (_panel, body) => this._buildBody(body),
    });
    this._subscribe();
  }

  _buildBody(body) {
    // 1. 角色头像横排
    this.headsRow = createEl('div', {
      style: {
        display: 'flex', gap: '12px', padding: '10px', marginBottom: '4px',
        background: 'rgba(255,255,255,0.55)', border: '2px solid #b8a888', borderRadius: '12px',
        justifyContent: 'center',
      },
      parent: body,
    });
    // 2. 主区：左 tab body + 右属性栏
    const main = createEl('div', {
      style: { flex: '1', minHeight: '0', display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '10px' },
      parent: body,
    });
    this.tabBody = createEl('div', {
      style: { padding: '10px', background: 'rgba(255,255,255,0.55)', border: '2px solid #b8a888', borderRadius: '12px', overflowY: 'auto' },
      parent: main,
    });
    this.attrCol = createEl('div', {
      style: { padding: '12px', background: 'rgba(255,255,255,0.55)', border: '2px solid #b8a888', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '6px' },
      parent: main,
    });

    // tab 切换（只有两个：技能、羁绊）
    this.tabsRow = createEl('div', {
      style: { display: 'flex', gap: '6px', marginBottom: '6px' },
      parent: body,
    });
    ['skills', 'bond'].forEach((k) => {
      const label = k === 'skills' ? '📚 技能' : '💞 羁绊';
      createEl('button', {
        class: ['action-btn'],
        style: {
          background: this.activeTab === k ? '#ffe099' : 'rgba(255,255,255,0.7)',
          border: this.activeTab === k ? '3px solid #e8a900' : '2px solid #b8a888',
          fontWeight: this.activeTab === k ? '800' : '600',
        },
        text: label, parent: this.tabsRow,
        onclick: () => { this.activeTab = k; this._refresh(); },
      });
    });

    this._refresh();
  }

  _subscribe() {
    EventBus.on(GE.UI_PANEL_OPEN, ({ panel }) => { if (panel === 'role') this.toggle(); });
    EventBus.on(GE.UI_PANEL_CLOSE, ({ panel }) => { if (panel === 'role' && this.helper?.visible) this.helper.hide(); });
  }

  _refresh() {
    // heads —— 点头像直接切换，无确认
    this.headsRow.innerHTML = '';
    Object.values(CHARACTERS).forEach((c) => {
      const sel = this.selectedRoleId === c.id;
      const col = ELEMENT_EMOJI[c.element] || '';
      const slot = createEl('div', {
        style: {
          width: '88px', padding: '6px', background: sel ? '#ffe099' : 'rgba(255,255,255,0.75)',
          border: sel ? '3px solid #e8a900' : '2px solid #b8a888', borderRadius: '12px',
          cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
          transition: 'transform 0.08s',
        },
        parent: this.headsRow,
      });
      slot.addEventListener('click', () => { this.selectedRoleId = c.id; this._refresh(); });
      createEl('div', { style: { fontSize: '34px', lineHeight: '1', fontFamily: EMOJI_FONT }, text: c.emoji, parent: slot });
      createEl('div', { style: { fontSize: '13px', fontWeight: '800', color: '#3a2e20' }, text: c.name, parent: slot });
      createEl('div', { style: { fontSize: '11px', color: '#8a6a3a' }, text: col + ' ' + (c.element || ''), parent: slot });
    });

    // tab body
    this.tabBody.innerHTML = '';
    const c = CHARACTERS[this.selectedRoleId];
    if (!c) return;

    if (this.activeTab === 'skills') {
      // —— 上半区：天赋 ——
      const myTalents = Object.values(TALENTS).filter(t => t.roleId === c.id);
      createEl('div', { style: { fontSize: '13px', fontWeight: '800', color: '#5a4a3a', marginBottom: '4px' }, text: '🌟 天赋', parent: this.tabBody });
      if (myTalents.length === 0) {
        createEl('div', { style: { color: '#b0a090', fontSize: '12px', fontStyle: 'italic', padding: '6px 10px', border: '2px dashed #b8a888', borderRadius: '8px', marginBottom: '8px' }, text: '（暂无私属天赋）', parent: this.tabBody });
      } else {
        myTalents.forEach((t) => {
          const isPassive = t.triggerCondition === 'passive';
          const triggerLabel = isPassive ? '🔵 被动' : '🟡 触发型';
          const row = createEl('div', {
            style: { padding: '6px 10px', marginBottom: '4px', background: 'rgba(255,255,255,0.8)', border: '2px solid #b8a888', borderRadius: '10px' },
            parent: this.tabBody,
          });
          const top = createEl('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }, parent: row });
          createEl('span', { style: { fontSize: '16px', fontFamily: EMOJI_FONT }, text: t.emoji, parent: top });
          createEl('span', { style: { fontWeight: '800', fontSize: '14px' }, text: t.name, parent: top });
          createEl('span', { style: { fontSize: '10px', color: isPassive ? '#2a8a3a' : '#c07a20', background: isPassive ? '#e8f5e9' : '#ffe099', padding: '0 6px', borderRadius: '8px', marginLeft: 'auto', border: `1px solid ${isPassive ? '#2a8a3a' : '#c07a20'}` }, text: triggerLabel, parent: top });
          createEl('div', { style: { fontSize: '11px', color: '#7a6a56', marginBottom: '1px' }, text: `触发：${t.triggerCondition}`, parent: row });
          createEl('div', { style: { fontSize: '12px', color: '#4a3a2a', lineHeight: '1.5' }, text: t.description || '', parent: row });
        });
      }

      // —— 下半区：技能 ——
      const skills = getSkillsByRole(c.id);
      createEl('div', { style: { fontSize: '13px', fontWeight: '800', color: '#5a4a3a', marginTop: '8px', marginBottom: '4px' }, text: '⚔️ 技能', parent: this.tabBody });
      skills.forEach((sk) => {
        const row = createEl('div', {
          style: { padding: '6px 10px', marginBottom: '4px', background: 'rgba(255,255,255,0.8)', border: '2px solid #b8a888', borderRadius: '10px' },
          parent: this.tabBody,
        });
        const top = createEl('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }, parent: row });
        createEl('span', { style: { fontSize: '18px', fontFamily: EMOJI_FONT }, text: sk.emoji, parent: top });
        createEl('span', { style: { fontWeight: '800', fontSize: '14px' }, text: sk.name, parent: top });
        if (sk.isLinkSkill) {
          createEl('span', { style: { fontSize: '10px', color: '#c07a20', background: '#ffe099', padding: '0 6px', borderRadius: '8px', marginLeft: 'auto', border: '1px solid #c07a20' }, text: '连携技', parent: top });
        }
        createEl('div', { style: { fontSize: '12px', color: '#4a3a2a', lineHeight: '1.5' }, text: sk.description || '', parent: row });
      });
    } else {
      // bond tab
      createEl('div', {
        style: { color: '#8a7a66', fontSize: '13px', padding: '20px', textAlign: 'center', fontStyle: 'italic' },
        text: '💞 羁绊等级 / 好感度（Phase 5 开放）\n敬请期待～',
        parent: this.tabBody,
      });
    }

    // 属性栏
    this.attrCol.innerHTML = '';
    const spirit = SPIRITS[c.spiritId] || null;
    createEl('div', {
      style: { fontSize: '16px', fontWeight: '900', color: '#3a2e20', textAlign: 'center', paddingBottom: '6px', borderBottom: '2px solid #e8a900' },
      text: `${c.emoji}  ${c.name}`, parent: this.attrCol,
    });
    const rows = [
      ['💧 元素', (ELEMENT_EMOJI[c.element] || '') + ' ' + (c.element || '')],
      ['🧚 专属精灵', spirit ? `${spirit.emoji} ${spirit.name}` : '—'],
      ['⚔️ 定位', c.isMainChar ? '主角 / 核心' : '辅助'],
      ['💞 羁绊等级', 'Lv.1（Phase 5）'],
      ['💌 好感度', '—（Phase 5）'],
    ];
    rows.forEach(([k, v]) => {
      const r = createEl('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '13px' }, parent: this.attrCol });
      createEl('span', { style: { color: '#7a6a56' }, text: k, parent: r });
      createEl('span', { style: { fontWeight: '800', color: '#3a2e20' }, text: v, parent: r });
    });
  }

  show() { this.helper?.show(); }
  hide() { this.helper?.hide(); }
  toggle() { this.helper?.toggle(); }
}

export default RolePanel;
