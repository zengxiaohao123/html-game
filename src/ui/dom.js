/**
 * ui/dom.js —— 极简 DOM 构造辅助（无框架）
 */

/**
 * 创建元素：h('div.cls#id', {props}, children)
 */
export function h(tag, attrs = {}, children = []) {
  let el;
  let tagName = tag;
  let id = null;
  let cls = null;
  const idMatch = tag.match(/#([\w-]+)/);
  if (idMatch) { id = idMatch[1]; tagName = tagName.replace(idMatch[0], ''); }
  const clsMatch = tagName.match(/\.(.+)$/);
  if (clsMatch) { cls = clsMatch[1].split('.'); tagName = tagName.split('.')[0]; }
  el = document.createElement(tagName || 'div');
  if (id) el.id = id;
  if (cls) el.classList.add(...cls);

  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'dataset') {
      Object.assign(el.dataset, v);
    } else if (k === 'style' && typeof v === 'object') {
      Object.assign(el.style, v);
    } else el.setAttribute(k, v === true ? '' : v);
  }
  const arr = Array.isArray(children) ? children : [children];
  for (const c of arr) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

export function mount(root, ...nodes) {
  clear(root);
  root.append(...nodes);
}

let toastTimer = [];
export function toast(text, kind = 'info', ms = 2200) {
  const layer = document.getElementById('toast-layer');
  if (!layer) return;
  const el = h('div.toast' + (kind !== 'info' ? '.' + kind : ''), { text });
  layer.append(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, ms - 300);
  setTimeout(() => el.remove(), ms);
}

export function screenFx(kind) {
  const layer = document.getElementById('fx-layer');
  if (!layer) return;
  if (kind === 'shake') {
    document.body.classList.add('fx-shake');
    setTimeout(() => document.body.classList.remove('fx-shake'), 520);
    return;
  }
  const cls = kind === 'black' ? 'fx-black' : 'fx-flash';
  const el = h(`div.${cls}`);
  layer.append(el);
  setTimeout(() => el.remove(), kind === 'black' ? 1100 : 420);
}
