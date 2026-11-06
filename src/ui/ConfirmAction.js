// src/ui/ConfirmAction.js
// 统一「二次确认」交互规范 —— 全项目唯一实现，所有面板 / 弹窗选项复用，
// 禁止各面板自己再写一套 armed / 计时器逻辑（商店「离开」按钮为已定稿例外，保持原实现）。
//
// 规范（§16.4 / §16.10 / §16.16 / §16.21）：
//   ① 需确认的动作先进入文字弹窗（DialogBox），在弹窗内点目标选项才进入待确认态：
//      按钮底色变化 + 弹窗内出现「你确定这么做？」（不允许在图标旁 / 屏幕角落出现行内提示）
//   ② 二次点击：同一 tick 立即执行业务回调（不许延迟、不许先复原再执行）
//   ③ 执行后：弹窗 / 卡片在 1.5 秒内淡出，期间 pointer-events:none，重复点击无效
//   ④ 首次点击后点别处（空白 / 切 tab / 其它按钮）：取消待确认态并复原
//   ⑤ 快捷键与鼠标点击共用同一入口（睡觉 P 键与按钮都先弹同一个文字弹窗）
//
// 用法：
//   ConfirmAction.arm(btn, { hintEl });                        // 进入待确认（hintEl = 弹窗内提示元素）
//   ConfirmAction.trigger(btn, onConfirm, { fadeTarget });    // 二次点击 → 立即执行 + 淡出
//   ConfirmAction.handleOutsideClick(target);                 // 点别处取消（document 捕获阶段自动挂）

import { devLog } from '../core/Logger.js';

export const CONFIRM_TEXT = '你确定这么做？';
export const CONFIRM_FADE_MS = 1500;      // 统一淡出时长（常量，不得各面板自行定义）
export const CONFIRM_ARM_BG = '#d9efdc';  // 待确认态：浅绿色底
export const CONFIRM_DONE_BG = '#f7e6a8'; // 已确认（淡出中）：淡金色底

const STYLE_KEYS = ['background', 'borderColor', 'boxShadow', 'pointerEvents', 'cursor'];

/** @type {Map<object, {btn:object, phase:'armed'|'done', orig:object, hint:object|null, fadeTimer:any, fadeMs:number}>} */
const records = new Map();
let _guardInstalled = false;

function snapshot(btn) {
  const s = {};
  for (const k of STYLE_KEYS) s[k] = btn?.style ? btn.style[k] : undefined;
  return s;
}

function restore(btn, s) {
  if (!btn?.style) return;
  for (const k of STYLE_KEYS) {
    // 快照里没有的（'' / undefined）统一恢复为空，避免残留底色
    btn.style[k] = s[k] === undefined ? '' : s[k];
  }
}

function applyArmedStyle(btn, opts) {
  if (!btn?.style) return;
  btn.style.background = opts.armedBackground || CONFIRM_ARM_BG;
  btn.style.borderColor = opts.armedBorderColor || '#4f8f5a';
  btn.style.boxShadow = '0 0 0 3px rgba(79,143,90,0.45)';
  btn.style.cursor = 'pointer';
  btn.classList.add('confirm-armed');
}

function applyDoneStyle(btn) {
  if (!btn?.style) return;
  btn.style.background = CONFIRM_DONE_BG;
  btn.style.borderColor = '#b8912f';
  btn.style.boxShadow = 'none';
  btn.style.pointerEvents = 'none';  // 淡出期间不可再点
  btn.style.cursor = 'default';
  btn.classList.add('confirm-done');
}

function ensureHint(rec, opts) {
  // 待确认文案只能出现在调用方指定的位置（DialogBox 弹窗内），绝不自动悬浮在按钮 / 图标旁
  if (!opts.hintEl) { rec.hint = null; return; }
  rec.hint = opts.hintEl;
  rec.hint.textContent = opts.text || CONFIRM_TEXT;
  rec.hint.style.display = 'block';
}

function hideHint(rec) {
  if (rec.hint) rec.hint.style.display = 'none';
}

function ensureGuard() {
  if (_guardInstalled) return;
  if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
  _guardInstalled = true;
  // 捕获阶段：先取消旧的待确认态，再由目标按钮自己的 click 处理进入新待确认态
  document.addEventListener('pointerdown', (e) => handleOutsideClick(e?.target), true);
}

/**
 * 进入待确认态（首次点击）
 * @param {HTMLElement} btn
 * @param {{hintEl?:HTMLElement, text?:string, armedBackground?:string, armedBorderColor?:string}} [opts]
 * @returns {boolean} 是否成功进入待确认态
 */
export function arm(btn, opts = {}) {
  if (!btn || btn.disabled === true) return false;
  const existing = records.get(btn);
  if (existing?.phase === 'done') return false; // 淡出中：忽略一切重复点击

  // 只允许一个按钮处于待确认态：进入新按钮时先复原旧按钮
  disarmAll();

  const rec = {
    btn,
    phase: 'armed',
    orig: snapshot(btn),
    hint: null,
    fadeTimer: null,
    fadeMs: CONFIRM_FADE_MS,
  };
  records.set(btn, rec);
  applyArmedStyle(btn, opts);
  ensureHint(rec, opts);
  ensureGuard();
  return true;
}

/** 取消待确认态并复原（点别处 / 切换选中对象时调用） */
export function disarm(btn) {
  const rec = records.get(btn);
  if (!rec) return false;
  if (rec.fadeTimer) { clearTimeout(rec.fadeTimer); rec.fadeTimer = null; }
  restore(btn, { ...rec.orig, pointerEvents: rec.orig.pointerEvents });
  btn?.classList?.remove('confirm-armed');
  btn?.classList?.remove('confirm-done');
  hideHint(rec);
  records.delete(btn);
  return true;
}

/** 取消全部待确认态（已进入淡出的也一并清理，用于面板关闭 / 重新 show） */
export function disarmAll() {
  for (const btn of [...records.keys()]) disarm(btn);
}

export function isArmed(btn) {
  return records.get(btn)?.phase === 'armed';
}

export function isConfirming(btn) {
  return records.get(btn)?.phase === 'done';
}

/**
 * 二次点击：同一 tick 立即执行 onConfirm，然后目标面板 1.5 秒淡出。
 * 业务执行永远先于动画，动画失败 / 取消都不拦截业务。
 * @param {HTMLElement} btn
 * @param {Function} onConfirm 业务回调（必须同步执行）
 * @param {{fadeTarget?:HTMLElement, onFaded?:Function, fadeMs?:number}} [opts]
 * @returns {boolean} 是否执行
 */
export function trigger(btn, onConfirm, opts = {}) {
  const rec = records.get(btn);
  if (!rec || rec.phase !== 'armed') return false;

  rec.phase = 'done';
  applyDoneStyle(btn);
  hideHint(rec);
  // 立即执行业务 —— 不允许 setTimeout / 请求动画帧延迟
  try {
    if (typeof onConfirm === 'function') onConfirm();
  } catch (err) {
    devLog.error('[ConfirmAction] onConfirm:', err);
  }

  const fadeMs = Number.isFinite(opts.fadeMs) ? opts.fadeMs : CONFIRM_FADE_MS;
  rec.fadeMs = fadeMs;
  const target = opts.fadeTarget || null;
  if (target?.style) {
    target.style.transition = `opacity ${fadeMs}ms ease`;
    target.style.opacity = '0';
    target.style.pointerEvents = 'none';
  }
  rec.fadeTimer = setTimeout(() => {
    rec.fadeTimer = null;
    try {
      if (typeof opts.onFaded === 'function') opts.onFaded();
    } catch (err) {
      devLog.error('[ConfirmAction] onFaded:', err);
    }
    disarm(btn);
  }, fadeMs);
  return true;
}

/**
 * 点别处取消：目标不在任何待确认按钮 / 提示内部时，复原全部待确认态。
 * 浏览器里由 document 捕获阶段自动调用；冒烟测试可直接传元素模拟。
 */
export function handleOutsideClick(target) {
  for (const [btn, rec] of [...records]) {
    if (rec.phase !== 'armed') continue;
    let inside = false;
    if (target && typeof btn?.contains === 'function' && btn.contains(target)) inside = true;
    if (!inside && target && rec.hint && typeof rec.hint.contains === 'function') {
      inside = rec.hint.contains(target);
    }
    if (!inside) disarm(btn);
  }
}

export default {
  CONFIRM_TEXT, CONFIRM_FADE_MS, CONFIRM_ARM_BG, CONFIRM_DONE_BG,
  arm, disarm, disarmAll, trigger, isArmed, isConfirming, handleOutsideClick,
};
