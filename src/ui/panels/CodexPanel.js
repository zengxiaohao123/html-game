// CodexPanel.js —— Phase 4 新建（图鉴占位面板）
// 快捷键 K（可后续在 InputManager 里绑定；目前靠 GE.UI_PANEL_OPEN({panel:'codex'}) 打开）
// 分类：与背包一致的物品分类（不含「总览」）+ 天赋 + 生物
// 外观严格套 _panelHelper.createStandardPanel 模板

import { EventBus } from '../../core/EventBus.js';
import { GE } from '../../core/GameEvents.js';
import { ITEMS, getBuyPrice } from '../../data/items.js';
import { TALENTS } from '../../data/talents.js';
import { SKILLS, CHARACTERS, getLeadRoleId } from '../../data/characters.js';
import { COLLECTIBLES } from '../../data/collectibles.js';
import { CREATURES } from '../../data/creatures.js';
import { CATEGORY_TABS } from '../CategoryBar.js';
import { createStandardPanel } from './_panelHelper.js';
import { createEl, iconEl } from '../dom.js';
import { renderTraitBadges, renderContentRows } from '../TraitBadges.js';
import { renderTermText } from '../TermText.js';
import { fieldContentRows, rarityFill } from '../../data/fieldTraits.js';

// 物品分类：与背包 CategoryBar 完全同源（跳过「总览」），再补天赋 / 生物
const ITEM_CATEGORY_TABS = CATEGORY_TABS.filter((t) => t.id !== 'all');
const TABS = [
  ...ITEM_CATEGORY_TABS.map((t) => ({ id: t.id, label: t.label, match: t.match })),
  { id: 'talents', label: '天赋' },
  { id: 'creatures', label: '生物' },
];

const EMOJI_FONT = '"Segoe UI Emoji",sans-serif';

/** 按物品库归类取 iconEl 的 group（与 ForgePanel 同约定） */
function iconGroupOfItem(it) {
  if (it?.tier2 === '田块' || it?.tier2 === '设施') return 'facilities';
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
    this.activeTab = ITEM_CATEGORY_TABS[0]?.id || 'field';
    this.selectedKey = null;  // 条目的 id（itemId / talentId / skillId / collectibleId）
    this.searchText = '';
  }

  mount() {
    this.helper = createStandardPanel({
      panelKey: 'codex',
      width: 'min(96vw, 1080px)',
      height: 'min(88vh, 760px)',
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

    // 主区：左网格 + 右详情（图鉴页面尺寸固定：左 5 列 × 92px 正方形格）
    const main = createEl('div', {
      style: { flex: '1', minHeight: '0', display: 'grid', gridTemplateColumns: '540px 1fr', gap: '10px' },
      parent: body,
    });
    this.listEl = createEl('div', {
      style: { padding: '10px', background: 'rgba(255,255,255,0.55)', border: '2px solid #b8a888', borderRadius: '12px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' },
      parent: main,
    });
    // 搜索（保留，按名称过滤当前分类）
    this.searchEl = createEl('input', {
      attrs: {
        type: 'text',
        placeholder: '搜索…',
        value: this.searchText,
      },
      style: {
        width: '100%', boxSizing: 'border-box', padding: '6px 10px', fontSize: '13px',
        border: '2px solid #b8a888', borderRadius: '8px', outline: 'none',
        background: 'rgba(255,255,255,0.85)',
      },
      parent: this.listEl,
    });
    this.searchEl.addEventListener('input', () => {
      this.searchText = this.searchEl.value || '';
      this._refreshList();
    });
    this.gridEl = createEl('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 92px)',
        gridAutoRows: '92px',
        gap: '6px',
        alignContent: 'start',
      },
      parent: this.listEl,
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

  // ── 左侧列表（5 列 × 92px 正方形格，按分类 tab 分页） ──
  _refreshList() {
    this.gridEl.innerHTML = '';

    const itemTab = ITEM_CATEGORY_TABS.find((t) => t.id === this.activeTab);
    if (itemTab) {
      this._listEntries(
        Object.values(ITEMS).filter((it) => itemTab.match(it.id)),
        (it) => ({
          emoji: it.emoji,
          name: it.name,
          id: it.id,
          group: iconGroupOfItem(it),
          def: it,
          sub: `${it.tier1 || ''}${it.tier2 ? ' · ' + it.tier2 : ''}`,
          rarity: it.rarity,
        }),
      );
    } else if (this.activeTab === 'items') {
      // 兼容旧入口：不分分类时展示全部物品
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
    } else if (this.activeTab === 'creatures') {
      this._listEntries(Object.entries(CREATURES), ([id, c]) => ({
        emoji: c.emoji,
        name: c.name,
        id,
        group: 'ui',
        def: c,
        sub: c.category === 'danger' ? '危险' : c.category === 'friendly' ? '友善' : '',
        rarity: null,
      }));
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
    const keyword = String(this.searchText || '').trim().toLowerCase();
    const list = (entries || [])
      .map(mapper)
      .filter((m) => !keyword || String(m.name || '').toLowerCase().includes(keyword));

    if (list.length === 0) {
      createEl('div', {
        style: { color: '#b0a090', fontSize: '12px', fontStyle: 'italic', padding: '10px' },
        text: '（暂无条目）', parent: this.gridEl,
      });
      return;
    }
    list.forEach((m) => {
      const sel = this.selectedKey === m.id;
      const cell = createEl('div', {
        style: {
          width: '92px', height: '92px', boxSizing: 'border-box',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: '2px', padding: '4px',
          background: sel ? '#ffe099' : rarityFill(m.rarity),
          border: sel ? '3px solid #e8a900' : '2px solid #b8a888',
          borderRadius: '10px', cursor: 'pointer', overflow: 'hidden',
        },
        parent: this.gridEl,
      });
      cell.appendChild(iconEl(m.group, m.id, { size: '30px', def: m.def, fallback: m.emoji }));
      createEl('div', {
        style: {
          fontSize: '11px', lineHeight: '1.15', textAlign: 'center', color: '#3a2e20',
          display: '-webkit-box', WebkitLineClamp: '2', WebkitBoxOrient: 'vertical',
          overflow: 'hidden', wordBreak: 'break-all',
        },
        text: m.name,
        parent: cell,
      });
      cell.title = m.name;
      cell.addEventListener('click', () => { this.selectedKey = m.id; this._refresh(); });
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
    const itemTab = ITEM_CATEGORY_TABS.find((t) => t.id === this.activeTab);
    if (itemTab || this.activeTab === 'items') entry = ITEMS[this.selectedKey];
    else if (this.activeTab === 'talents') entry = TALENTS[this.selectedKey];
    else if (this.activeTab === 'skills') entry = SKILLS[this.selectedKey];
    else if (this.activeTab === 'collectibles') entry = COLLECTIBLES[this.selectedKey];
    else if (this.activeTab === 'creatures') entry = CREATURES[this.selectedKey];

    if (!entry) {
      createEl('div', { style: { color: '#c0392b' }, text: '⚠️ 未找到对应条目', parent: this.detailEl });
      return;
    }
    const entryId = entry.id || this.selectedKey;

    // 大标题行
    const header = createEl('div', {
      style: { display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '2px solid #3a3a3a', paddingBottom: '6px', marginBottom: '6px' },
      parent: this.detailEl,
    });
    const group = (itemTab || this.activeTab === 'items') ? iconGroupOfItem(entry)
      : this.activeTab === 'collectibles' ? 'items' : 'ui';
    header.appendChild(iconEl(group, entryId, { size: '36px', def: entry, fallback: entry.emoji }));
    createEl('div', { style: { flex: '1' }, parent: header });
    createEl('div', { style: { fontSize: '18px', fontWeight: '900' }, text: entry.name, parent: header });

    // 展示词条：统一徽章入口，独立于描述正文
    renderTraitBadges(this.detailEl, entry.traits, { marginBottom: '6px' });

    // 公共字段：description（pre-line 保留换行；其中的【术语】走统一行内术语组件，可点开释义）
    // 图鉴中的田块只显示地块原始特性（与玩家进度无关、不受魔导书影响），且永不显示封禁红。
    if (entry.description) {
      if ((itemTab || this.activeTab === 'items') && entry.tier2 === '田块') {
        renderContentRows(this.detailEl, fieldContentRows(null, entryId, { codex: true }));
      } else {
        renderTermText(this.detailEl, entry.description, {
          tag: 'div',
          style: { fontSize: '13px', color: '#4a3a2a', lineHeight: '1.7', padding: '6px 8px', background: 'rgba(255,255,255,0.7)', borderRadius: '6px' },
        });
      }
    }

    // Tab 专属字段
    if (itemTab || this.activeTab === 'items') {
      this._detailItem(entry);
    } else if (this.activeTab === 'talents') {
      this._detailTalent(entry);
    } else if (this.activeTab === 'skills') {
      this._detailSkill(entry);
    } else if (this.activeTab === 'collectibles') {
      this._detailCollectible(entry);
    } else if (this.activeTab === 'creatures') {
      this._detailCreature(entry);
    }
  }

  _detailItem(it) {
    const rows = [
      ['分类', [it.tier1, it.tier2, it.tier3].filter(Boolean).join(' · ') || '—'],
      ['价值', it.value != null ? `🪙 ${it.value}` : '—'],
    ];
    // 价格：取物品库随机池里的买价；没有价格的物品不显示这一行
    const price = getBuyPrice(it.id);
    if (price != null) rows.push(['价格', `🪙 ${price}`]);
    rows.forEach(([k, v]) => this._addDetailRow(k, v));
    if (it.hiddenTags && it.hiddenTags.length) {
      this._addDetailRow('词条', it.hiddenTags.join(' · '));
    }
  }

  _detailCreature(c) {
    const categoryLabel = c.category === 'danger' ? '危险' : c.category === 'friendly' ? '友善' : (c.category || '—');
    const rows = [
      ['分类', categoryLabel],
      ['生命值', c.hp != null ? `${c.hp}` : '—'],
      ['攻击力', c.atk != null ? `${c.atk}` : '—'],
      ['元素', c.element || '—'],
    ];
    if (c.speedPerTile != null) rows.push(['移速', `${c.speedPerTile} 秒/格`]);
    if (c.drops && c.drops.length) {
      rows.push(['掉落', c.drops.map((d) => `${ITEMS[d.itemId]?.name || d.itemId} ×${d.qty}`).join(' · ')]);
    }
    rows.forEach(([k, v]) => this._addDetailRow(k, v));
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
      // 【唯一】是展示词条（物品属性），走徽章组件，不能用术语行内样式
      renderTraitBadges(this.detailEl, ['唯一'], { marginBottom: '2px' });
      createEl('div', { style: { fontSize: '11px', color: '#c07a20', fontWeight: '700' }, text: '同一效果只生效一次', parent: this.detailEl });
    }
  }

  _addDetailRow(label, value) {
    const row = createEl('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '2px 0' }, parent: this.detailEl });
    createEl('span', { style: { color: '#7a6a56', fontWeight: '700' }, text: label, parent: row });
    createEl('span', { style: { color: '#3a2e20' }, text: value, parent: row });
  }
}

export default CodexPanel;
