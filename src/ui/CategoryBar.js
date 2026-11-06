// src/ui/CategoryBar.js
// 背包 / 商店共用的分类 tab 栏（§16.15 背包页面 / §16.21 商店售卖页）
//
// 设计文档要求两处「同一套分组、同一套图标、同一套排版宽度与选中态」，
// 因此分类定义与 DOM 结构必须只有这一份实现，禁止面板内另拼一套。
//
// 用法：
//   const { bar, btns } = createCategoryBar({ parent, activeIdx, onSelect });
//   activeIdx 选中项加 .active；点击回调收到索引；切换选中态由调用方维护。

import { ITEMS } from '../data/items.js';
import { createEl } from './dom.js';

const tier2Is = (t) => (id) => ITEMS[id]?.tier2 === t;
const tier1Is = (t) => (id) => ITEMS[id]?.tier1 === t;

/** 8 个分类（顺序即展示顺序，总览含全部，其余互斥） */
export const CATEGORY_TABS = [
  { id: 'all', label: '总览', match: () => true },
  { id: 'facility', label: '设施', match: tier2Is('设施') },
  { id: 'resource', label: '资源', match: tier2Is('资源') },
  { id: 'skill', label: '技能', match: tier2Is('技能') },
  { id: 'terrain', label: '地形', match: tier1Is('地形') },
  { id: 'item', label: '产物', match: tier1Is('产物') },
  { id: 'consum', label: '道具', match: tier1Is('道具') },
  { id: 'misc', label: '杂物', match: tier1Is('杂物') },
];

/**
 * 渲染分类 tab 栏（与背包左侧部分是同一份 DOM 与样式）
 * @param {object} opts
 * @param {Element} opts.parent 挂载容器
 * @param {number} [opts.activeIdx=0] 选中索引
 * @param {(idx:number)=>void} [opts.onSelect] 点击回调
 * @param {string[]} [opts.class] 额外 class（如滚动容器需要）
 * @returns {{ bar: Element, btns: Element[] }}
 */
export function createCategoryBar({ parent, activeIdx = 0, onSelect, class: extraClass = [] } = {}) {
  const bar = createEl('div', { class: ['tab-bar', ...extraClass], parent });
  const btns = CATEGORY_TABS.map((t, i) => createEl('button', {
    class: ['tab-btn', i === activeIdx ? 'active' : ''],
    text: t.label,
    attrs: { 'data-tab': String(i), 'data-cat': t.id },
    parent: bar,
    onclick: () => onSelect?.(i),
  }));
  return { bar, btns };
}
