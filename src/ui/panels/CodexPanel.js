// CodexPanel.js —— Phase 4 新建（图鉴占位面板）
// 快捷键 K（可后续在 InputManager 里绑定；目前靠 GE.UI_PANEL_OPEN({panel:'codex'}) 打开）
// 4 个 tab：物品 / 天赋 / 技能 / 收藏品
// 外观严格套 _panelHelper.createStandardPanel 模板

import { EventBus } from '../../core/EventBus.js';
import { GE } from '../../core/GameEvents.js';
import { ITEMS } from '../../data/items.js';
import { TALENTS } from '../../data/talents.js';
import { SKILLS, CHARACTERS, getLeadRoleId } from '../../data/characters.js';
import { COLLECTIBLES } from '../../data/collectibles.js';
import { createStandardPanel } from './_panelHelper.js';
import { createEl, iconEl } from '../dom.js';
import { renderTraitBadges } from '../TraitBadges.js';

const TABS = [
  { id: 'items',        label: '📦 物品' },
  { id: 'talents',      label: '🌟 天赋' },
  { id: 'skills',       label: '⚔️ 技能' },
  { id: 'collectibles', label: '🏆 收藏品' },
];

const EMOJI_FONT = '"Segoe UI Emoji",sans-serif';

/** 按物品库归类取 iconEl 的 group（与 ForgePanel 同约定） */
function iconGroupOfItem(it) {
  if (it?.tier2 === '设施') return 'facilities';
  if (it?.tier2 === '资源') return 'resources';
  if (it?.tier1 === '地形') return 'terrains';
  return 'items';
}

export class CodexPanel {
  constructor(director) {
    this.director = director;
    this.helper = null;
    this.tabsRow = null;
    this.listEl = null;
    this.detailEl = null;
    this.activeTab = 'items';
    this.selectedKey = null;  // 条目的 id（itemId / talentId / skillId / collectibleId）
  }

  mount() {
    this.helper = createStandardPanel({
      panelKey: 'codex',
      width: 'min(92vw, 900px)',
      height: 'min(86vh, 720px)',
      onMount: (_p, body) => this._build(body),
    });
    this._subscribe();
  }

  _build(body) {
    // tab 切换（第 10 批：统一基准 .tab-bar/.tab-btn，点击即更新高亮）
    // 右上角 ✖ 浮在面板角上：tab 条右侧留出按钮宽度，避免首个内容行被遮住 / 点不到
    this.tabsRow = createEl('div', { class: ['tab-bar'], style: { paddingRight: '44px' }, parent: body });
    this.tabBtns = TABS.map((t) => createEl('button', {
      class: this.activeTab === t.id ? ['tab-btn', 'active'] : ['tab-btn'],
      text: t.label, parent: this.tabsRow,
      onclick: () => {
        this.activeTab = t.id; this.selectedKey = null;
        this.tabBtns.forEach((b, i) => {
          if (TABS[i].id === t.id) b.classList.add('active'); else b.classList.remove('active');
        });
        this._refresh();
      },
    }));

    // 主区：左列表 + 右详情
    const main = createEl('div', {
      style: { flex: '1', minHeight: '0', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' },
      parent: body,
    });
    this.listEl = createEl('div', {
      style: { padding: '10px', background: 'rgba(255,255,255,0.55)', border: '2px solid #b8a888', borderRadius: '12px', overflowY: 'auto' },
      parent: main,
    });
    this.detailEl = createEl('div', {
      style: { padding: '12px', background: 'rgba(255,255,255,0.55)', border: '2px solid #b8a888', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto' },
      parent: main,
    });

    this._refresh();
  }

  _subscribe() {
    // 幂等显示：已显示 → 只刷新；隐藏 → 显示。绝不 toggle 关闭
    // （开新面板关旧面板由 GameDirector 中央发 UI_PANEL_CLOSE 处理）
    EventBus.on(GE.UI_PANEL_OPEN, ({ panel }) => { if (panel === 'codex') this.show(); });
    EventBus.on(GE.UI_PANEL_CLOSE, ({ panel }) => { if (panel === 'codex' && this.helper?.visible) this.helper.hide(); });
    // 通用技能归属随 1 号位实时变化 → 图鉴打开时立即重绘
    EventBus.on(GE.TEAM_CHANGE, () => { if (this.helper?.visible) this._refresh(); });
  }

  /** 技能归属文案：专属技能显示角色；通用技能显示当前 1 号位 */
  _skillOwnerText(sk) {
    if (sk.roleId) {
      const role = CHARACTERS[sk.roleId];
      return role ? `${role.emoji} ${role.name}` : '—';
    }
    if (sk.roleId !== null) return '—';
    const lead = getLeadRoleId(this.director?.gs);
    const role = lead ? CHARACTERS[lead] : null;
    return role ? `通用 · 当前归属：${role.emoji} ${role.name}` : '通用 · 当前归属：—';
  }

  show() { this.helper?.show(); this._refresh(); }
  hide() { this.helper?.hide(); }
  toggle() { this.helper?.toggle(); }

  _refresh() {
    this._refreshList();
    this._refreshDetail();
  }

  // ── 左侧列表 ──
  _refreshList() {
    this.listEl.innerHTML = '';

    if (this.activeTab === 'items') {
      this._listEntries(Object.values(ITEMS), (it) => ({
        emoji: it.emoji,
        name: it.name,
        id: it.id,
        group: iconGroupOfItem(it),
        def: it,
        sub: `${it.tier1 || ''}${it.tier2 ? ' · ' + it.tier2 : ''}`,
        rarity: it.rarity,
      }));
    } else if (this.activeTab === 'talents') {
      this._listEntries(Object.values(TALENTS), (t) => {
        const role = CHARACTERS[t.roleId];
        return {
          emoji: t.emoji,
          name: t.name,
          id: t.id,
          group: 'ui',
          def: t,
          sub: role ? `${role.emoji} ${role.name}` : '',
          rarity: null,
        };
      });
    } else if (this.activeTab === 'skills') {
      this._listEntries(Object.values(SKILLS), (sk) => {
        return {
          emoji: sk.emoji,
          name: sk.name + (sk.isLinkSkill ? ' ⚡' : ''),
          id: sk.id,
          group: 'ui',
          def: sk,
          sub: this._skillOwnerText(sk),
          rarity: null,
        };
      });
    } else if (this.activeTab === 'collectibles') {
      this._listEntries(Object.values(COLLECTIBLES), (c) => ({
        emoji: c.emoji,
        name: c.name,
        id: c.id,
        group: 'items',
        def: c,
        sub: c.effectType || '',
        rarity: null,
      }));
    }
  }

  _listEntries(entries, mapper) {
    if (!entries || entries.length === 0) {
      createEl('div', {
        style: { color: '#b0a090', fontSize: '12px', fontStyle: 'italic', padding: '10px' },
        text: '（暂无条目）', parent: this.listEl,
      });
      return;
    }
    entries.forEach((entry) => {
      const m = mapper(entry);
      const sel = this.selectedKey === m.id;
      const row = createEl('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', marginBottom: '4px',
          background: sel ? '#ffe099' : 'rgba(255,255,255,0.7)',
          border: sel ? '3px solid #e8a900' : '2px solid #b8a888', borderRadius: '8px', cursor: 'pointer',
        },
        parent: this.listEl,
      });
      row.appendChild(iconEl(m.group, m.id, { size: '20px', def: m.def, fallback: m.emoji }));
      const info = createEl('div', { style: { flex: '1', minWidth: 0 }, parent: row });
      createEl('div', { style: { fontWeight: '800', fontSize: '13px' }, text: m.name, parent: info });
      if (m.sub) {
        createEl('div', { style: { fontSize: '11px', color: '#7a6a56' }, text: m.sub, parent: info });
      }
      // rarity 星星
      if (m.rarity != null) {
        const stars = '★'.repeat(Math.min(m.rarity, 5));
        createEl('div', { style: { fontSize: '11px', color: '#e8a900' }, text: stars, parent: row });
      }
      row.addEventListener('click', () => { this.selectedKey = m.id; this._refresh(); });
    });
  }

  // ── 右侧详情 ──
  _refreshDetail() {
    this.detailEl.innerHTML = '';
    if (!this.selectedKey) {
      createEl('div', {
        style: { color: '#b0a090', fontSize: '13px', textAlign: 'center', padding: '40px 10px', fontStyle: 'italic' },
        text: '← 点击左侧条目查看详情', parent: this.detailEl,
      });
      return;
    }

    let entry = null;
    if (this.activeTab === 'items') entry = ITEMS[this.selectedKey];
    else if (this.activeTab === 'talents') entry = TALENTS[this.selectedKey];
    else if (this.activeTab === 'skills') entry = SKILLS[this.selectedKey];
    else if (this.activeTab === 'collectibles') entry = COLLECTIBLES[this.selectedKey];

    if (!entry) {
      createEl('div', { style: { color: '#c0392b' }, text: '⚠️ 未找到对应条目', parent: this.detailEl });
      return;
    }

    // 大标题行
    const header = createEl('div', {
      style: { display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '2px solid #3a3a3a', paddingBottom: '6px', marginBottom: '6px' },
      parent: this.detailEl,
    });
    const group = this.activeTab === 'items' ? iconGroupOfItem(entry)
      : this.activeTab === 'collectibles' ? 'items' : 'ui';
    header.appendChild(iconEl(group, entry.id, { size: '36px', def: entry, fallback: entry.emoji }));
    createEl('div', { style: { flex: '1' }, parent: header });
    createEl('div', { style: { fontSize: '18px', fontWeight: '900' }, text: entry.name, parent: header });

    // 展示词条：统一徽章入口，独立于描述正文
    renderTraitBadges(this.detailEl, entry.traits, { marginBottom: '6px' });

    // 公共字段：description（pre-line 保留换行）
    if (entry.description) {
      createEl('div', {
        style: { fontSize: '13px', color: '#4a3a2a', lineHeight: '1.7', padding: '6px 8px', background: 'rgba(255,255,255,0.7)', borderRadius: '6px', whiteSpace: 'pre-line' },
        text: entry.description, parent: this.detailEl,
      });
    }

    // Tab 专属字段
    if (this.activeTab === 'items') {
      this._detailItem(entry);
    } else if (this.activeTab === 'talents') {
      this._detailTalent(entry);
    } else if (this.activeTab === 'skills') {
      this._detailSkill(entry);
    } else if (this.activeTab === 'collectibles') {
      this._detailCollectible(entry);
    }
  }

  _detailItem(it) {
    const rows = [
      ['分类', [it.tier1, it.tier2, it.tier3].filter(Boolean).join(' · ') || '—'],
      ['稀有度', it.rarity != null ? '★'.repeat(Math.min(it.rarity, 5)) : '—'],
      ['价值', it.value != null ? `🪙 ${it.value}` : '—'],
      ['叠放', it.stackable ? `✓ 上限 ${it.stackMax || 999}` : '× 不可叠放'],
    ];
    rows.forEach(([k, v]) => this._addDetailRow(k, v));
    if (it.hiddenTags && it.hiddenTags.length) {
      this._addDetailRow('词条', it.hiddenTags.join(' · '));
    }
  }

  _detailTalent(t) {
    const role = CHARACTERS[t.roleId];
    const isPassive = t.triggerCondition === 'passive';
    const triggerLabel = isPassive ? '🔵 被动（常驻）' : `🟡 触发型（${t.triggerCondition}）`;
    const rows = [
      ['所属角色', role ? `${role.emoji} ${role.name}` : t.roleId || '—'],
      ['触发条件', triggerLabel],
      ['效果类型', t.effectType || '—'],
    ];
    rows.forEach(([k, v]) => this._addDetailRow(k, v));
    if (t.effectParams && Object.keys(t.effectParams).length) {
      createEl('div', { style: { fontSize: '11px', color: '#8a7a66', marginTop: '2px' }, text: `参数：${JSON.stringify(t.effectParams).replace(/[{}]/g, '')}`, parent: this.detailEl });
    }
  }

  _detailSkill(sk) {
    const rows = [
      ['所属角色', this._skillOwnerText(sk)],
      ['元素', sk.element || '—'],
      ['伤害倍率', sk.damageMultiplier != null ? `×${sk.damageMultiplier}` : '—'],
      ['冷却', sk.cooldown != null ? `${sk.cooldown} 回合` : '—'],
      ['范围', sk.range != null ? `${sk.range} 格` : '—'],
      ['连携技', sk.isLinkSkill ? '⚡ 是' : '否'],
    ];
    rows.forEach(([k, v]) => this._addDetailRow(k, v));
    if (sk.extraEffect) {
      createEl('div', { style: { fontSize: '11px', color: '#8a7a66', marginTop: '2px' }, text: `特殊效果：${sk.extraEffect.type}`, parent: this.detailEl });
    }
  }

  _detailCollectible(c) {
    const rows = [
      ['效果类型', c.effectType || '—'],
      ['触发条件', c.triggerCondition || '—'],
    ];
    rows.forEach(([k, v]) => this._addDetailRow(k, v));
    if (c.effectParams && Object.keys(c.effectParams).length) {
      createEl('div', { style: { fontSize: '11px', color: '#8a7a66', marginTop: '2px' }, text: `参数：${JSON.stringify(c.effectParams).replace(/[{}]/g, '')}`, parent: this.detailEl });
    }
    if (c.effectParams?.unique) {
      createEl('div', { style: { fontSize: '11px', color: '#c07a20', fontWeight: '700' }, text: '【唯一】同一效果只生效一次', parent: this.detailEl });
    }
  }

  _addDetailRow(label, value) {
    const row = createEl('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '2px 0' }, parent: this.detailEl });
    createEl('span', { style: { color: '#7a6a56', fontWeight: '700' }, text: label, parent: row });
    createEl('span', { style: { color: '#3a2e20' }, text: value, parent: row });
  }
}

export default CodexPanel;
