// src/ui/TermText.js
// 术语（term）行内展示组件 —— 唯一的术语渲染入口。
//
// 三层概念（设计文档 §15.0）：
//   · 术语（term）：玩家可见正文里以【X】出现、在「词条字典」（GLOSSARY）能查到释义的名词，
//     如【粘液】【燃烧】【虚弱】【易伤】【心力交瘁】。行内呈现：保留【】、颜色区别于正文、
//     无底色 / 边框 / 图标 / 胶囊，点击在词附近浮出释义浮层（fixed 定位 + 视口边界翻转）。
//   · buff / debuff：作用在角色 / 生物 / 地块上的状态实体，与术语是不同维度的归纳，
//     部分术语同时是 buff/debuff（粘液、心力交瘁、虚弱…）。
//   · 展示词条（traits）：物品属性徽章（【永恒】【唯一】），走 TraitBadges.js，
//     **不属于术语**，两套组件、两套视觉，严禁复用本组件。
//
// 释义一律逐字取自 GLOSSARY（src/data/generated/library.js ← 物品库「词条字典」），
// 任何地方都不得自写措辞或缩写。

import { createEl, clearChildren } from './dom.js';
import { GLOSSARY } from '../data/items.js';

/** 展示词条类型：属于物品属性，不是术语，不参与术语行内化 */
const TRAIT_GLOSSARY_TYPE = '展示标签';

/** 术语名 → 词条字典条目（排除展示词条） */
const TERM_INDEX = new Map(
  (GLOSSARY || [])
    .filter((g) => g && g.term && g.type !== TRAIT_GLOSSARY_TYPE)
    .map((g) => [g.term, g]),
);

/** 术语行内配色：可辨识但低调，不加底色 / 边框 / 图标 */
export const TERM_COLOR = '#2f6f8f';

const TERM_STYLE = {
  color: TERM_COLOR,
  cursor: 'pointer',
  background: 'transparent',
  border: '0',
  padding: '0',
  borderRadius: '0',
  textDecoration: 'none',
  fontWeight: 'inherit',
  font: 'inherit',
};

const TERM_RE = /【([^】]+)】/g;

// ────────────────────────────────────────── 行内渲染

/**
 * 把文本渲染为「普通正文 + 行内术语」。换行、缩进、列表符号原样保留（white-space: pre-line）。
 * 只有词条字典里能查到的【X】会变成术语；查不到的【X】（如技能名【粘液喷吐】）保持纯文本。
 *
 * @param {HTMLElement} parent 容器
 * @param {string} text 文本
 * @param {{ tag?: string, class?: string|string[], style?: object }} [opts]
 * @returns {HTMLElement} 渲染后的容器
 */
export function renderTermText(parent, text, opts = {}) {
  const host = createEl(opts.tag || 'span', {
    class: opts.class,
    style: { whiteSpace: 'pre-line', ...(opts.style || {}) },
    parent,
  });

  const src = String(text ?? '');
  let last = 0;
  for (const m of src.matchAll(TERM_RE)) {
    const name = m[1];
    const entry = TERM_INDEX.get(name);
    if (!entry) continue; // 非术语：留给后面的纯文本段，原样显示
    if (m.index > last) {
      createEl('span', { text: src.slice(last, m.index), style: { whiteSpace: 'pre-line' }, parent: host });
    }
    const termEl = createEl('span', {
      class: 'term-inline',
      text: m[0],
      attrs: { 'data-term': name, title: entry.meaning || '' },
      style: TERM_STYLE,
      parent: host,
    });
    termEl.addEventListener('click', (e) => {
      e.preventDefault?.();
      e.stopPropagation?.();
      showTermPopover(termEl, name, entry);
    });
    last = m.index + m[0].length;
  }
  if (last < src.length) {
    createEl('span', { text: src.slice(last), style: { whiteSpace: 'pre-line' }, parent: host });
  }
  // 整段没有术语时也保留原文（避免空容器丢文本）
  if (last === 0 && !src) host.textContent = '';
  return host;
}

// ────────────────────────────────────────── 释义浮层

let popoverEl = null;

function ensurePopover() {
  if (popoverEl) return popoverEl;
  popoverEl = createEl('div', {
    class: 'term-popover',
    attrs: { 'data-term-popover': '1' },
    style: {
      position: 'fixed',
      zIndex: '8600',
      display: 'none',
      maxWidth: '280px',
      minWidth: '120px',
      padding: '10px 12px',
      background: '#fffbe6',
      border: '1px solid #c8b88a',
      borderRadius: '8px',
      boxShadow: '0 6px 18px rgba(58,46,32,0.22)',
      color: '#3a2e20',
      fontSize: '13px',
      lineHeight: '1.6',
      pointerEvents: 'auto',
    },
    parent: document.body,
  });
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onDocKey);
  window.addEventListener('scroll', hideTermPopover, true);
  window.addEventListener('resize', hideTermPopover);
  return popoverEl;
}

function onDocClick(e) {
  if (!popoverEl || popoverEl.style.display === 'none') return;
  const t = e?.target;
  // 点浮层内部不关闭
  if (t && typeof t === 'object' && popoverEl.contains?.(t)) return;
  // 点另一个术语：交给术语自己的 click 重新定位
  const hitTerm = (typeof t?.closest === 'function' && t.closest('.term-inline'))
    || (t && t._classes && t._classes.has && t._classes.has('term-inline'));
  if (hitTerm) return;
  hideTermPopover();
}

function onDocKey(e) {
  if (e?.key === 'Escape') hideTermPopover();
}

/** 在术语附近浮出释义（fixed 定位，靠近视口边缘时自动翻转 / 夹回视口内） */
export function showTermPopover(anchorEl, termName, entry) {
  const e = entry || TERM_INDEX.get(termName);
  if (!e || !anchorEl) return;
  const pop = ensurePopover();
  clearChildren(pop);
  createEl('div', {
    style: { fontWeight: '700', marginBottom: '4px' },
    text: `【${e.term}】`,
    parent: pop,
  });
  // 释义逐字取自词条字典（不使用 notes 备注字段）
  createEl('div', {
    style: { whiteSpace: 'pre-line' },
    text: e.meaning || '',
    parent: pop,
  });

  pop.style.display = 'block';
  const vw = window.innerWidth || 1280;
  const vh = window.innerHeight || 720;
  const w = pop.offsetWidth || 260;
  const h = pop.offsetHeight || 110;
  const rect = anchorEl.getBoundingClientRect?.() || { left: 0, top: 0, right: 0, bottom: 0 };

  // 默认在词条下方；下方放不下则向上翻转
  let top = rect.bottom + 6;
  if (top + h > vh - 8) top = rect.top - h - 6;
  top = Math.max(8, Math.min(top, vh - h - 8));

  let left = rect.left;
  left = Math.max(8, Math.min(left, vw - w - 8));

  pop.style.top = `${Math.round(top)}px`;
  pop.style.left = `${Math.round(left)}px`;
}

/** 关闭释义浮层（点别处 / ESC / 滚动时调用） */
export function hideTermPopover() {
  if (!popoverEl) return;
  popoverEl.style.display = 'none';
}

/** 测试入口：当前浮层节点（未创建返回 null） */
export function getTermPopover() {
  return popoverEl;
}

