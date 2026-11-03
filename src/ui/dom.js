// src/ui/dom.js
// DOM 操作工具：统一封装 DOM 创建、查询、事件绑定等
// 所有 UI 模块都通过本工具操作 DOM，避免重复写原生 API

import { Assets } from '../core/Assets.js';

/**
 * 创建一个 DOM 元素
 * @param {string} tag 标签名（如 'div', 'span'）
 * @param {object} [options] 可选配置
 * @param {string} [options.id] id 属性
 * @param {string|string[]} [options.class] 类名（单字符串或数组）
 * @param {string} [options.text] 文本内容（等价于 textContent）
 * @param {string} [options.html] innerHTML（优先于 text）
 * @param {object} [options.style] 内联样式对象（如 { color: 'red', fontSize: '14px' }）
 * @param {object} [options.attrs] 其他属性（如 { title: 'tooltip', 'data-idx': '0' }）
 * @param {Function|object} [options.onclick] 点击事件处理函数（或含多个事件的对象）
 * @param {HTMLElement} [options.parent] 创建后立即 appendChild 到该父元素
 * @returns {HTMLElement}
 */
export function createEl(tag, options = {}) {
  const el = document.createElement(tag);

  // id
  if (options.id) el.id = options.id;

  // class
  if (options.class) {
    const cls = Array.isArray(options.class) ? options.class.join(' ') : options.class;
    el.className = cls;
  }

  // text / html
  if (options.html !== undefined) {
    el.innerHTML = options.html;
  } else if (options.text !== undefined) {
    el.textContent = options.text;
  }

  // style
  if (options.style) {
    for (const [k, v] of Object.entries(options.style)) {
      el.style[k] = v;
    }
  }

  // 其他属性
  if (options.attrs) {
    for (const [k, v] of Object.entries(options.attrs)) {
      el.setAttribute(k, v);
    }
  }

  // 事件绑定
  if (options.onclick) {
    if (typeof options.onclick === 'function') {
      el.addEventListener('click', options.onclick);
    } else if (typeof options.onclick === 'object') {
      // { click: fn, mouseenter: fn } 形式
      for (const [evt, fn] of Object.entries(options.onclick)) {
        el.addEventListener(evt, fn);
      }
    }
  }

  // 立即挂载
  if (options.parent) options.parent.appendChild(el);

  return el;
}

/**
 * 选择单个元素（委托给 document.querySelector）
 * @param {string} selector CSS 选择器
 * @param {HTMLElement} [root=document] 搜索根节点
 * @returns {HTMLElement|null}
 */
export function qs(selector, root = document) {
  return root.querySelector(selector);
}

/**
 * 选择多个元素（返回数组而非 NodeList）
 * @param {string} selector CSS 选择器
 * @param {HTMLElement} [root=document] 搜索根节点
 * @returns {HTMLElement[]}
 */
export function qsa(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

/**
 * 给元素添加一个或多个类名
 * @param {HTMLElement} el
 * @param {string|string[]} cls
 */
export function addClass(el, cls) {
  if (!el) return;
  const list = Array.isArray(cls) ? cls : cls.split(/\s+/);
  list.forEach(c => el.classList.add(c));
}

/**
 * 给元素移除一个或多个类名
 * @param {HTMLElement} el
 * @param {string|string[]} cls
 */
export function removeClass(el, cls) {
  if (!el) return;
  const list = Array.isArray(cls) ? cls : cls.split(/\s+/);
  list.forEach(c => el.classList.remove(c));
}

/**
 * 清空元素的所有子节点
 * @param {HTMLElement} el
 */
export function clearChildren(el) {
  while (el && el.firstChild) {
    el.removeChild(el.firstChild);
  }
}

/**
 * 图标元素（第 5 批 UI 对齐：getIcon 预留入口）
 * 渲染优先级：
 *   1. opts.def.icon（数据对象自带的 PNG 路径，如 creatures/characters 的 icon 字段）
 *   2. Assets.getIcon(group, id)（Assets.icons 登记的真实 PNG）
 *   3. 回退 emoji：opts.fallback ?? Assets.getEmoji(group, id)
 * 美术批次只需往 Assets.icons / 数据 icon 字段补 PNG 路径，UI 结构不再改动。
 *
 * @param {string} group 'facilities'|'resources'|'terrains'|'ui'|'items'|'creatures'
 * @param {string} id    资源 id（如 'facility_wheat' / 'item_egg'）
 * @param {object} [opts]
 *   - size: string      图标尺寸（默认 '28px'；emoji 用作 fontSize，PNG 用作宽高）
 *   - fallback: string  强制指定回退 emoji（跳过 Assets.getEmoji 查表）
 *   - def: object       数据定义对象（读 def.icon / def.emoji）
 *   - cls: string       追加类名
 *   - style: object     追加内联样式
 * @returns {HTMLElement} <img>（有 PNG 时）或 <span>（emoji 回退）
 */
export function iconEl(group, id, opts = {}) {
  const size = opts.size || '28px';
  const extraStyle = opts.style || {};
  const cls = ['game-icon', opts.cls || ''];

  // 1. 数据对象自带 PNG 路径
  const defIcon = opts.def && typeof opts.def.icon === 'string' && opts.def.icon
    ? opts.def.icon : null;
  const png = defIcon || Assets.getIcon(group, id);
  if (png) {
    return createEl('img', {
      class: cls.concat('ui-icon-img'),
      attrs: { src: png, alt: id || '', 'data-icon-id': id || '' },
      style: {
        width: size, height: size, objectFit: 'contain',
        display: 'inline-block', verticalAlign: 'middle',
        ...extraStyle,
      },
    });
  }

  // 2. emoji 回退
  const emoji = opts.fallback
    ?? (opts.def && opts.def.emoji ? opts.def.emoji : Assets.getEmoji(group, id));
  return createEl('span', {
    class: cls.concat('ui-icon-emoji'),
    text: emoji,
    attrs: { 'data-icon-id': id || '' },
    style: {
      fontSize: size, lineHeight: '1', display: 'inline-block',
      fontFamily: '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif',
      ...extraStyle,
    },
  });
}
