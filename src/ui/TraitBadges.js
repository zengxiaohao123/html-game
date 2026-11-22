// src/ui/TraitBadges.js
// **展示词条（trait，【永恒】【唯一】等）**的统一徽章渲染入口 —— 与「术语」严格分开：
//   · 展示词条 = 物品属性静态标签（traits），显眼独立徽章 → renderTraitBadges（本文件）。
//   · 术语 = 正文里【X】形式、可查词条字典的名词（粘液 / 虚弱…）→ 行内组件 src/ui/TermText.js，禁止用本函数。
// 所有详情视图（背包 / 图鉴 / 信息区 / 角色·技能·天赋 / 载具 / 生物 / 已放置内容）
// 必须调用本函数，禁止各面板自行拼 description 或重复写徽章 DOM。
// 备注字段 note 永不上屏；本函数只接收 traits 展示词条。
// renderStateBadges 是**运行时状态（buff/debuff）**的动态徽章入口，同样只渲染名称，不负责术语释义。

import { createEl } from './dom.js';
import { renderTermText } from './TermText.js';
import { rarityFill, SUPPRESSED_FILL, SUPPRESSED_TEXT } from '../data/fieldTraits.js';

/**
 * @param {HTMLElement} parent 详情视图容器
 * @param {string[]} traits 展示词条列表（空/undefined 时不渲染）
 * @param {{ marginBottom?: string, marginTop?: string }} [opts]
 * @returns {HTMLElement|null} 徽章行
 */
export function renderTraitBadges(parent, traits, opts = {}) {
  const list = (traits || []).filter((t) => typeof t === 'string' && t.trim());
  if (!list.length) return null;
  const row = createEl('div', {
    class: 'trait-badge-row',
    style: {
      ...(opts.marginTop ? { marginTop: opts.marginTop } : {}),
      ...(opts.marginBottom ? { marginBottom: opts.marginBottom } : {}),
    },
    parent,
  });
  list.forEach((t) => createEl('span', { class: 'trait-badge', text: t, parent: row }));
  return row;
}

/**
 * 运行时状态徽章（与「展示词条」严格区分）：
 *   traits  —— 物品/生物的静态展示标签（【永恒】【唯一】等），永不随运行时变化；
 *   states  —— 实例当前的动态状态（生物的【已投喂】/【饥饿】、buff/debuff 等）。
 * 名称与含义一律取自数据层（状态名来自物品库 GLOSSARY / 状态定义 BUFFS），禁止自造词。
 *
 * @param {HTMLElement} parent 详情视图容器
 * @param {Array<{name:string, emoji?:string, tone?:'good'|'bad'|'neutral'}>} states
 * @param {{ marginBottom?: string, marginTop?: string }} [opts]
 * @returns {HTMLElement|null} 徽章行
 */
export function renderStateBadges(parent, states, opts = {}) {
  const list = (states || []).filter((s) => s && s.name);
  if (!list.length) return null;
  const row = createEl('div', {
    class: 'state-badge-row',
    style: {
      ...(opts.marginTop ? { marginTop: opts.marginTop } : {}),
      ...(opts.marginBottom ? { marginBottom: opts.marginBottom } : {}),
    },
    parent,
  });
  list.forEach((s) => createEl('span', {
    // 状态底色统一原色（不再区分好 / 坏语义色）
    class: ['trait-badge', 'state-badge'],
    text: s.emoji ? `${s.emoji} ${s.name}` : s.name,
    parent: row,
  }));
  return row;
}

/**
 * 地块内容行渲染（特性 / 非特性说明）：
 *   · 特性行按来源稀有度上底色；被封禁时整条红底 + 红色删除线；
 *   · 非特性说明保持原色（不参与封禁）；
 *   · 行内【术语】统一走 TermText。
 * @param {HTMLElement} parent
 * @param {Array<{text:string, kind:'trait'|'note', rarity:number, suppressed:boolean, activation?:boolean}>} rows
 */
export function renderContentRows(parent, rows) {
  for (const r of rows || []) {
    if (r.kind === 'note') {
      renderTermText(parent, r.text, { tag: 'div', class: 'facility-desc-row' });
      continue;
    }
    const el = createEl('div', {
      class: r.suppressed ? ['trait-line', 'is-suppressed'] : 'trait-line',
      parent,
    });
    el.style.background = r.suppressed ? SUPPRESSED_FILL : rarityFill(r.rarity);
    if (r.suppressed) {
      el.style.textDecoration = 'line-through';
      el.style.color = SUPPRESSED_TEXT;
    }
    renderTermText(el, r.text);
    // 条件型激活：行末追加彩色状态后缀；被禁用（删除线）时不显示激活态
    if (typeof r.activation === 'boolean' && !r.suppressed) {
      createEl('span', {
        style: { color: r.activation ? '#2e7d32' : '#c62828' },
        text: `（${r.activation ? '已激活' : '未激活'}）`,
        parent: el,
      });
    }
  }
}
