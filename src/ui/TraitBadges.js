// src/ui/TraitBadges.js
// 展示词条（【永恒】【唯一】等）的统一徽章渲染入口。
// 所有详情视图（背包 / 图鉴 / 信息区 / 角色·技能·天赋 / 载具 / 生物 / 已放置内容）
// 必须调用本函数，禁止各面板自行拼 description 或重复写徽章 DOM。
// 备注字段 note 永不上屏；本函数只接收 traits 展示词条。

import { createEl } from './dom.js';

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
    class: ['trait-badge', 'state-badge', s.tone || 'neutral'],
    text: s.emoji ? `${s.emoji} ${s.name}` : s.name,
    parent: row,
  }));
  return row;
}
