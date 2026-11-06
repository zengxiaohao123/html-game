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
