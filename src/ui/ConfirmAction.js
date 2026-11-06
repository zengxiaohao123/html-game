// src/ui/ConfirmAction.js
// 统一「二次确认」交互规范 —— 全项目唯一实现，所有面板 / 按钮 / 快捷键复用，
// 禁止各面板自己再写一套 armed / 计时器逻辑（商店「离开」按钮为已定稿例外，保持原实现）。
//
// 规范（§16.4 / §16.10 / §16.16 / §16.21）：
//   ① 首次点击：按钮进入待确认态 —— 底色变化 + 紧邻位置出现「你确定这么做？」
//   ② 二次点击：同一 tick 立即执行业务回调（不许延迟、不许先复原再执行）
//   ③ 执行后：目标面板 / 卡片在 1.5 秒内淡出，期间 pointer-events:none，重复点击无效
//   ④ 首次点击后点别处（空白 / 切 tab / 其它按钮）：取消待确认态并复原
//   ⑤ 快捷键与按钮共用同一状态机（不允许「按钮要确认、快捷键一键生效」的双标）
//
// 用法：
//   ConfirmAction.arm(btn);                                   // 进入待确认
//   ConfirmAction.trigger(btn, onConfirm, { fadeTarget });    // 二次点击 → 立即执行 + 淡出
//   ConfirmAction.bindKey('sleep', btn, run);                 // 注册快捷键入口
//   ConfirmAction.keyTrigger('sleep');                        // 快捷键按下（首次 arm / 二次 trigger）
//   ConfirmAction.handleOutsideClick(target);                 // 点别处取消（document 捕获阶段自动挂）

import { createEl } from './dom.js';
import { devLog } from '../core/Logger.js';

export const CONFIRM_TEXT = '你确定这么做？';
export const CONFIRM_FADE_MS = 1500;      // 统一淡出时长（常量，不得各面板自行定义）
export const CONFIRM_ARM_BG = '#d9efdc';  // 待确认态：浅绿色底
export const CONFIRM_DONE_BG = '#f7e6a8'; // 已确认（淡出中）：淡金色底

const STYLE_KEYS = ['background', 'borderColor', 'boxShadow', 'pointerEvents', 'cursor'];

/** @type {Map<object, {btn:object, phase:'armed'|'done', orig:object, hint:object|null, ownedHint:boolean, fadeTimer:any, fadeMs:number, onFaded?:Function}>} */
const records = new Map();
/** 快捷键动作 → { btn, run, opts } */
const keyBindings = new Map();
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
  // 复用调用方提供的提示元素（如 DialogBox 的选项下方小字），否则自动在按钮上创建
  if (opts.hintEl) {
    rec.hint = opts.hintEl;
    rec.ownedHint = false;
    rec.hint.textContent = opts.text || CONFIRM_TEXT;
    rec.hint.style.display = 'block';
    return;
  }
  if (!rec.hint) {
    rec.hint = createHintElement(rec.btn);
    rec.ownedHint = true;
  }
  if (rec.hint) {
    rec.hint.textContent = opts.text || CONFIRM_TEXT;
    rec.hint.style.display = 'block';
  }
}

function createHintElement(btn) {
  if (!btn?.style) return null;
  // 提示挂在按钮内部（absolute，不影响按钮布局），视觉上紧贴按钮下方
  if (!btn.style.position) btn.style.position = 'relative';
  return createEl('div', {
    class: ['confirm-hint'],
    style: {
      position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
      marginTop: '4px', padding: '2px 8px',
      background: 'rgba(255,251,240,0.96)', border: '2px solid #3a3a3a',
      borderRadius: '8px', fontSize: '11px', fontWeight: '800', color: '#3a2e20',
      lineHeight: '1.4', whiteSpace: 'nowrap', zIndex: '6000', pointerEvents: 'none',
    },
    text: CONFIRM_TEXT,
    parent: btn,
  });
}

function hideHint(rec) {
  if (!rec.hint) return;
  if (rec.ownedHint) {
    rec.hint.remove?.();
    rec.hint = null;
  } else {
    rec.hint.style.display = 'none';
  }
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
    ownedHint: false,
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

/**
 * 注册快捷键入口（与按钮共用同一状态机）。
 * @param {string} action 动作名（如 'sleep'）
 * @param {HTMLElement} btn 作为视觉锚点的按钮
 * @param {Function} run 业务回调
 * @param {object} [opts] 透传给 arm / trigger（hintEl / fadeTarget / fadeMs / onFaded）
 */
export function bindKey(action, btn, run, opts = {}) {
  keyBindings.set(action, { btn, run, opts });
}

export function unbindKey(action) {
  keyBindings.delete(action);
}

/**
 * 快捷键按下：首次按下 = arm（与鼠标首次点击等效）；再次按下 = 立即执行。
 * @param {string} action
 * @returns {boolean|null} 已执行 true；仅进入待确认 false；无绑定 null
 */
export function keyTrigger(action) {
  const b = keyBindings.get(action);
  if (!b || !b.btn) return null;
  if (isArmed(b.btn)) return trigger(b.btn, b.run, b.opts);
  arm(b.btn, b.opts);
  return false;
}

export default {
  CONFIRM_TEXT, CONFIRM_FADE_MS, CONFIRM_ARM_BG, CONFIRM_DONE_BG,
  arm, disarm, disarmAll, trigger, isArmed, isConfirming,
  handleOutsideClick, bindKey, unbindKey, keyTrigger,
};
