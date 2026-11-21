// src/ui/InputGuard.js
// 输入分发公共层：保证「一次鼠标点击只对一个最高层级的功能选项生效」，
// 且淡出 / 惯性元素不会把本次点击穿透给下层按钮。
//
// 规则（§2.4.7）：
//   ① 点击盾：带 data-click-shield 的元素（正在淡出的弹窗 / 卡片 / 选项区）
//      仍参与命中测试，但捕获阶段直接吞掉点击 —— 既不重复生效，也不穿透到下层。
//      不用 pointer-events:none：那会让点击落到下面的按钮上（就是穿透本身）。
//   ② 最高层级判定：按 elementFromPoint 的实际命中点确定唯一动作元素；
//      命中点被更高层的另一个功能选项覆盖时，只让最高层的那个生效。
//   ③ 不抢点击：除 ①② 外一律不调用 preventDefault / stopPropagation，
//      按钮原本的效果照常执行；术语浮层的关闭监听与这里互不干扰。

const SHIELD_ATTR = 'data-click-shield';

const ACTIONABLE_TAGS = new Set([
  'BUTTON', 'A', 'SELECT', 'TEXTAREA', 'INPUT', 'SUMMARY', 'LABEL',
]);

const ACTIONABLE_CLASSES = [
  'action-btn', 'dialog-opt',
  'hotbar-slot', 'inv-slot', 'inventory-slot', 'bag-slot',
  'story-option', 'story-choice', 'story-skip',
  'map-tile', 'fence-tile',
  'panel-card', 'team-cell', 'codex-item',
];

let _installed = false;

function hasClass(el, cls) {
  return !!(el && el.classList && typeof el.classList.contains === 'function' && el.classList.contains(cls));
}

/** 该元素本身是否是「有明确作用的功能选项」 */
export function isActionable(el) {
  if (!el || !el.tagName) return false;
  if (ACTIONABLE_TAGS.has(String(el.tagName).toUpperCase())) return true;
  if (typeof el.getAttribute === 'function') {
    if (el.getAttribute('role') === 'button') return true;
    if (el.getAttribute('data-action') != null) return true;
  }
  return ACTIONABLE_CLASSES.some((c) => hasClass(el, c));
}

/** 向上找最近的功能选项（含自身）；没有则 null */
export function closestAction(start) {
  let n = start;
  while (n && n.tagName) {
    if (isActionable(n)) return n;
    n = n.parentNode;
  }
  return null;
}

/** 标记「淡出中 / 已失效」：保留命中测试但吞掉点击，杜绝穿透与重复触发 */
export function shield(el) {
  if (el && typeof el.setAttribute === 'function') el.setAttribute(SHIELD_ATTR, '1');
}

export function unshield(el) {
  if (!el) return;
  if (typeof el.removeAttribute === 'function') el.removeAttribute(SHIELD_ATTR);
  else if (el.attributes) delete el.attributes[SHIELD_ATTR];
}

/** 目标自身或任一祖先是否处于点击盾状态 */
export function isShielded(start) {
  let n = start;
  while (n && n.tagName) {
    if (typeof n.getAttribute === 'function' && n.getAttribute(SHIELD_ATTR) != null) return true;
    n = n.parentNode;
  }
  return false;
}

function swallow(e) {
  e.preventDefault?.();
  e.stopPropagation?.();
}

// ② 最高层级唯一动作：只有「实际命中点属于更高层的另一个选项」时才改判
function arbitrate(e) {
  if (!e || e.__inputGuardRetarget) return;
  const target = e.target;
  const targetAction = closestAction(target);
  if (!targetAction) return;
  if (typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') return;
  let top = null;
  try { top = document.elementFromPoint(e.clientX, e.clientY); } catch { top = null; }
  if (!top) return;
  if (top === target || target?.contains?.(top) || top.contains?.(target)) return;
  const topAction = closestAction(top);
  if (!topAction || topAction === targetAction) return;

  // 本次点击落点被更高层的选项覆盖：下层不生效，动作交给最高层那一个
  swallow(e);
  if (typeof topAction.click === 'function') {
    const run = () => {
      try { topAction.click(); } catch { /* 忽略：点击失败不影响输入分发 */ }
    };
    if (typeof queueMicrotask === 'function') queueMicrotask(run);
    else setTimeout(run, 0);
  }
}

/** 安装输入分发守卫（幂等；main.js 启动时调用一次） */
export function installInputGuard() {
  if (_installed) return;
  if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
  _installed = true;
  document.addEventListener('pointerdown', (e) => { if (isShielded(e?.target)) swallow(e); }, true);
  document.addEventListener('click', (e) => { if (isShielded(e?.target)) swallow(e); }, true);
  document.addEventListener('click', arbitrate, true);
}

export default { installInputGuard, shield, unshield, isShielded, isActionable, closestAction };
