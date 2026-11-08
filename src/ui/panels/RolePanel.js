// RolePanel.js —— 第 5 批 UI 对齐（§16.11 角色页面，快捷键 C）
// 全屏。顶部一行所有角色头像（无文字），点击切换，默认余默。
// 左侧一列分页 tab：天赋 / 技能 / 羁绊等级（天赋与技能各自独立成页）。
// 天赋页：该角色的天赋列表；技能页：主动技能 + 连携技；羁绊等级页：羁绊效果（数据未实装 → 空态）。
// 纯查看页 —— 没有"把技能放到地块"的入口。

import { EventBus } from '../../core/EventBus.js';
import { GE } from '../../core/GameEvents.js';
import { CHARACTERS, SPIRITS, getSkillsByRole } from '../../data/characters.js';
import { TALENTS } from '../../data/talents.js';
import { ELEMENTS } from '../../data/elements.js';
import { createStandardPanel } from './_panelHelper.js';
import { createEl, iconEl } from '../dom.js';
import { renderTraitBadges } from '../TraitBadges.js';
import { renderTermText } from '../TermText.js';
import { devLog } from '../../core/Logger.js';

const BOX_BG = 'rgba(255,255,255,0.55)';
const BOX_BORDER = '2px solid #b8a888';
// 分页顺序即左侧 tab 的展示顺序
const TABS = [
  { key: 'talents', label: '🌟 天赋' },
  { key: 'skills', label: '⚔️ 技能' },
  { key: 'bond', label: '💞 羁绊等级' },
];

export class RolePanel {
  constructor(director) {
    this.director = director;
    this.helper = null;
    this.headsRow = null;
    this.tabsCol = null;
    this.tabBody = null;
    this.attrCol = null;
    this.activeTab = 'talents';   // 'talents' | 'skills' | 'bond'
    this.selectedRoleId = 'yumo'; // §16.11：默认余默
  }

  mount() {
    this.helper = createStandardPanel({
      panelKey: 'role',
      width: '100vw',   // §16.11：全屏
      height: '100vh',
      onMount: (_panel, body) => this._buildBody(body),
    });
    this._subscribe();
  }

  _buildBody(body) {
    // 1. 顶部一行：所有角色头像（无文字），点击切换
    this.headsRow = createEl('div', {
      style: {
        display: 'flex', gap: '12px', padding: '10px',
        background: BOX_BG, border: BOX_BORDER, borderRadius: '12px',
        justifyContent: 'center', flexShrink: '0',
      },
      parent: body,
    });

    // 2. 主区：左列 tab + 中间内容 + 右属性栏
    const main = createEl('div', {
      style: {
        flex: '1', minHeight: '0', display: 'grid',
        gridTemplateColumns: '120px 1fr 250px', gap: '10px',
      },
      parent: body,
    });

    // 左侧一列分页 tab
    this.tabsCol = createEl('div', {
      style: { display: 'flex', flexDirection: 'column', gap: '8px' },
      parent: main,
    });
    ['talents', 'skills', 'bond'].forEach((k) => {
      const label = TABS.find((t) => t.key === k)?.label || k;
      createEl('button', {
        class: ['action-btn'],
        style: {
          background: this.activeTab === k ? '#ffe099' : 'rgba(255,255,255,0.7)',
          border: this.activeTab === k ? '3px solid #e8a900' : BOX_BORDER,
          fontWeight: this.activeTab === k ? '800' : '600',
          padding: '10px 8px', fontSize: '14px',
        },
        text: label, parent: this.tabsCol,
        onclick: () => { this.activeTab = k; this._refresh(); },
      });
    });

    // 中间内容区
    this.tabBody = createEl('div', {
      style: {
        padding: '10px', background: BOX_BG, border: BOX_BORDER, borderRadius: '12px',
        minHeight: '0', display: 'flex', flexDirection: 'column', gap: '8px',
      },
      parent: main,
    });

    // 右侧属性栏
    this.attrCol = createEl('div', {
      style: {
        padding: '12px', background: BOX_BG, border: BOX_BORDER, borderRadius: '12px',
        display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto',
      },
      parent: main,
    });

    this._refresh();
  }

  _subscribe() {
    // 幂等显示：隐藏 → 显示；已显示 → 只刷新（绝不 toggle 关闭）
    EventBus.on(GE.UI_PANEL_OPEN, ({ panel }) => {
      if (panel !== 'role') return;
      if (this.helper?.visible) {
        this._refresh();
      } else {
        this.show();
        this._refresh();
      }
    });
    EventBus.on(GE.UI_PANEL_CLOSE, ({ panel }) => {
      if (panel === 'role' && this.helper?.visible) this.helper.hide();
    });
    // 生命/攻击为全角色共用值（gs.player），数值变化时刷新
    EventBus.on(GE.STAT_CHANGE, () => { if (this.helper?.visible) this._refresh(); });
    // 属性栏展示的「最大生命 / 攻击力」也可能单独变化（如清风祝福只改 atk）
    EventBus.on(GE.ATK_CHANGE, () => { if (this.helper?.visible) this._refresh(); });
    EventBus.on(GE.HP_CHANGE, () => { if (this.helper?.visible) this._refresh(); });
    EventBus.on(GE.STATE_RESET, () => { if (this.helper?.visible) this._refresh(); });
  }

  _getGS() { return this.director?.getGS?.(); }

  _refresh() {
    if (!this.headsRow) return;

    // ── 顶部头像行（无文字，点击切换）──
    this.headsRow.innerHTML = '';
    Object.values(CHARACTERS).forEach((c) => {
      const sel = this.selectedRoleId === c.id;
      const slot = createEl('div', {
        style: {
          width: '64px', height: '64px',
          background: sel ? '#ffe099' : 'rgba(255,255,255,0.75)',
          border: sel ? '3px solid #e8a900' : BOX_BORDER, borderRadius: '12px',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        },
        attrs: { title: c.name },
        parent: this.headsRow,
      });
      slot.appendChild(iconEl('ui', c.id, { def: c, fallback: c.emoji, size: '44px' }));
      slot.addEventListener('click', () => { this.selectedRoleId = c.id; this._refresh(); });
    });

    // ── 左列 tab 高亮 ──
    if (this.tabsCol) {
      [...this.tabsCol.children].forEach((btn, i) => {
        const k = TABS[i]?.key;
        const on = this.activeTab === k;
        btn.style.background = on ? '#ffe099' : 'rgba(255,255,255,0.7)';
        btn.style.border = on ? '3px solid #e8a900' : BOX_BORDER;
        btn.style.fontWeight = on ? '800' : '600';
      });
    }

    const c = CHARACTERS[this.selectedRoleId];
    if (!c) return;

    // ── 中间内容 ──
    this.tabBody.innerHTML = '';
    if (this.activeTab === 'talents') {
      this._renderTalentsTab(c);
    } else if (this.activeTab === 'skills') {
      this._renderSkillsTab(c);
    } else {
      this._renderBondTab(c);
    }

    // ── 右侧属性栏 ──
    this._renderAttrCol(c);
  }

  // 天赋页：只展示该角色的天赋（天赋与技能不再混在同一页）
  _renderTalentsTab(c) {
    // 角色详情：展示词条统一徽章入口
    renderTraitBadges(this.tabBody, c.traits, { marginBottom: '6px' });
    const talentSec = createEl('div', {
      style: { flex: '1', minHeight: '0', display: 'flex', flexDirection: 'column', border: '2px dashed #b8a888', borderRadius: '10px', padding: '8px' },
      parent: this.tabBody,
    });
    createEl('div', { style: { fontSize: '14px', fontWeight: '800', color: '#5a4a3a', marginBottom: '6px', flexShrink: '0' }, text: '🌟 天赋', parent: talentSec });
    const talentList = createEl('div', { style: { flex: '1', minHeight: '0', overflowY: 'auto' }, parent: talentSec });
    const myTalents = Object.values(TALENTS).filter(t => t.roleId === c.id);
    if (myTalents.length === 0) {
      createEl('div', { style: { color: '#b0a090', fontSize: '12px', fontStyle: 'italic', padding: '6px 10px', border: '2px dashed #b8a888', borderRadius: '8px' }, text: '（暂无天赋）', parent: talentList });
    } else {
      myTalents.forEach((t) => {
        const isPassive = t.triggerCondition === 'passive';
        const triggerLabel = isPassive ? '🔵 被动' : '🟡 触发型';
        const row = createEl('div', {
          style: { padding: '6px 10px', marginBottom: '4px', background: 'rgba(255,255,255,0.8)', border: BOX_BORDER, borderRadius: '10px' },
          parent: talentList,
        });
        const top = createEl('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }, parent: row });
        top.appendChild(iconEl('ui', t.id, { def: t, fallback: t.emoji, size: '18px' }));
        createEl('span', { style: { fontWeight: '800', fontSize: '14px' }, text: t.name, parent: top });
        createEl('span', { style: { fontSize: '10px', color: isPassive ? '#2a8a3a' : '#c07a20', background: isPassive ? '#e8f5e9' : '#ffe099', padding: '0 6px', borderRadius: '8px', marginLeft: 'auto', border: `1px solid ${isPassive ? '#2a8a3a' : '#c07a20'}` }, text: triggerLabel, parent: top });
        renderTraitBadges(row, t.traits);
        // 天赋描述：逐字取数据层，其中【术语】走统一行内术语组件
        renderTermText(row, t.description || '', { tag: 'div', style: { fontSize: '12px', color: '#4a3a2a', lineHeight: '1.5' } });
      });
    }
  }

  // 技能页：主动技能 + 连携技
  _renderSkillsTab(c) {
    // 角色详情：展示词条统一徽章入口
    renderTraitBadges(this.tabBody, c.traits, { marginBottom: '6px' });
    const skillSec = createEl('div', {
      style: { flex: '1', minHeight: '0', display: 'flex', flexDirection: 'column', border: '2px dashed #b8a888', borderRadius: '10px', padding: '8px' },
      parent: this.tabBody,
    });
    createEl('div', { style: { fontSize: '14px', fontWeight: '800', color: '#5a4a3a', marginBottom: '6px', flexShrink: '0' }, text: '⚔️ 技能', parent: skillSec });
    const skillList = createEl('div', { style: { flex: '1', minHeight: '0', overflowY: 'auto' }, parent: skillSec });
    const skills = getSkillsByRole(c.id);
    if (skills.length === 0) {
      createEl('div', { style: { color: '#b0a090', fontSize: '12px', fontStyle: 'italic', padding: '6px 10px', border: '2px dashed #b8a888', borderRadius: '8px' }, text: '（暂无技能）', parent: skillList });
    } else {
      skills.forEach((sk) => {
        const row = createEl('div', {
          style: { padding: '6px 10px', marginBottom: '4px', background: 'rgba(255,255,255,0.8)', border: BOX_BORDER, borderRadius: '10px' },
          parent: skillList,
        });
        const top = createEl('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }, parent: row });
        top.appendChild(iconEl('ui', sk.id, { def: sk, fallback: sk.emoji, size: '20px' }));
        createEl('span', { style: { fontWeight: '800', fontSize: '14px' }, text: sk.name, parent: top });
        if (sk.isLinkSkill) {
          createEl('span', { style: { fontSize: '10px', color: '#c07a20', background: '#ffe099', padding: '0 6px', borderRadius: '8px', marginLeft: 'auto', border: '1px solid #c07a20' }, text: '连携技', parent: top });
        }
        renderTraitBadges(row, sk.traits);
        renderTermText(row, sk.description || '', { tag: 'div', style: { fontSize: '12px', color: '#4a3a2a', lineHeight: '1.5' } });
      });
    }
  }

  // 羁绊等级页：羁绊每级效果及可获得技能 —— 数据未实装（§17 待补充），显示空态
  _renderBondTab(c) {
    // 角色详情：展示词条统一徽章入口
    renderTraitBadges(this.tabBody, c.traits, { marginBottom: '6px' });
    createEl('div', {
      style: {
        flex: '1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: '8px', color: '#8a7a66', fontSize: '13px', fontStyle: 'italic', textAlign: 'center',
        border: '2px dashed #b8a888', borderRadius: '10px', padding: '20px',
      },
      html: `💞 ${c.name} 的羁绊等级效果与可获得技能<br>羁绊数据尚未开放，敬请期待`,
      parent: this.tabBody,
    });
  }

  // 右侧属性栏：角色名、最大生命、攻击力、元素属性、精灵
  //（羁绊等级 / 好感度数据不存在 → 不显示该行）
  _renderAttrCol(c) {
    this.attrCol.innerHTML = '';
    const gs = this._getGS();
    const spirit = SPIRITS[c.spiritId] || null;
    const ele = ELEMENTS[c.element] || null;
    // 精灵详情：展示词条统一徽章入口
    renderTraitBadges(this.attrCol, spirit?.traits);

    const head = createEl('div', {
      style: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', paddingBottom: '8px', borderBottom: '2px solid #e8a900' },
      parent: this.attrCol,
    });
    head.appendChild(iconEl('ui', c.id, { def: c, fallback: c.emoji, size: '36px' }));
    createEl('div', { style: { fontSize: '16px', fontWeight: '900', color: '#3a2e20' }, text: c.name, parent: head });

    const rows = [
      ['❤️ 最大生命', String(gs?.player?.maxHp ?? '—')],
      ['⚔️ 攻击力', String(gs?.player?.atk ?? '—')],
      ['🔮 元素属性', ele ? `${ele.emoji} ${ele.name}` : (c.element || '—')],
    ];
    rows.forEach(([k, v]) => {
      const r = createEl('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '13px' }, parent: this.attrCol });
      createEl('span', { style: { color: '#7a6a56' }, text: k, parent: r });
      createEl('span', { style: { fontWeight: '800', color: '#3a2e20' }, text: v, parent: r });
    });

    // 精灵行（图标 + 名字）
    const sr = createEl('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px' }, parent: this.attrCol });
    createEl('span', { style: { color: '#7a6a56' }, text: '🧚 精灵', parent: sr });
    if (spirit) {
      const sv = createEl('span', { style: { fontWeight: '800', color: '#3a2e20', display: 'flex', alignItems: 'center', gap: '4px' }, parent: sr });
      sv.appendChild(iconEl('ui', spirit.id, { def: spirit, fallback: spirit.emoji, size: '18px' }));
      createEl('span', { text: spirit.name, parent: sv });
    } else {
      createEl('span', { style: { fontWeight: '800', color: '#3a2e20' }, text: '—', parent: sr });
    }

    devLog.info('[RolePanel] refresh', c.id, this.activeTab);
  }

  show() { this.helper?.show(); }
  hide() { this.helper?.hide(); }
}

export default RolePanel;
