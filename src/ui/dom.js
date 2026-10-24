// src/ui/dom.js
// DOM 操作工具：统一封装 DOM 创建、查询、事件绑定等
// 所有 UI 模块都通过本工具操作 DOM，避免重复写原生 API

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
