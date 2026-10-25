// src/ui/panels/_panelHelper.js
// Phase 4 —— 公共 Panel 模板工厂
// 所有 Panel 的外观严格对齐 InventoryPanel（panel-card + 92vw×86vh + 奶油白 + 关闭按钮 ✖）
// 避免每个 Panel 自己发明 inline style

import { EventBus } from '../../core/EventBus.js';
import { GE } from '../../core/GameEvents.js';
import { createEl, qs } from '../dom.js';

/**
 * 创建一个标准 Panel 容器：mask + panel-card + header（标题 + ✖）+ body + ESC 关闭
 * @param {object} opts
 *   - title: string          头部大标题（左上）
 *   - panelKey: string       用于 GE.UI_PANEL_CLOSE 的 panel key（'role' | 'team' | 'forge' | ...）
 *   - width: string          默认 'min(92vw, 880px)'
 *   - height: string         默认 'min(86vh, 700px)'
 *   - onMount(panel, body):  panel-card 与 body 已经挂好，让调用方往 body 里填内容
 *   - defaultClose: boolean  默认 true，ESC 关闭 + 遮罩点击关闭
 * @returns {object} { root, bodyEl, show(), hide(), toggle() }
 */
export function createStandardPanel(opts = {}) {
  const {
    title = '未命名面板',
    panelKey = '',
    width = 'min(92vw, 880px)',
    height = 'min(86vh, 700px)',
    defaultClose = true,
    onMount = null,
    parent = qs('body'),
  } = opts;

  const mask = createEl('div', {
    class: ['panel-mask'],
    style: {
      position: 'fixed', inset: 0,
      backgroundColor: 'rgba(0,0,0,0.55)',
      display: 'none', alignItems: 'center', justifyContent: 'center',
      zIndex: 6000,
    },
    parent,
  });
  const panel = createEl('div', {
    class: ['panel-card'],
    style: {
      width, maxWidth: width, height, maxHeight: height,
      background: 'linear-gradient(135deg, #fffbf0 0%, #fff3c4 100%)',
      border: '3px solid #3a3a3a',
      borderRadius: '16px',
      padding: '14px 16px',
      boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
      display: 'flex', flexDirection: 'column', gap: '12px',
      fontFamily: '"LXGW WenKai TC", "Microsoft YaHei", sans-serif',
      color: '#3a2e20',
    },
    parent: mask,
  });

  // header：左上标题 + 右上 ✖
  const header = createEl('div', {
    class: ['inventory-header'],
    style: {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      borderBottom: '3px solid #3a3a3a', paddingBottom: '8px', marginBottom: '4px', flexShrink: 0,
    },
    parent: panel,
  });
  createEl('div', {
    style: { fontSize: '20px', fontWeight: '800', color: '#3a2e20', letterSpacing: '1px' },
    text: title, parent: header,
  });
  const closeBtn = createEl('button', {
    class: ['inventory-close'],
    text: '✖',
    parent: header,
    style: {
      width: '34px', height: '34px',
      border: '2px solid #3a3a3a', borderRadius: '8px',
      background: '#fffbe6', cursor: 'pointer',
      fontSize: '18px', fontWeight: '700', color: '#3a2e20',
    },
  });

  // body
  const body = createEl('div', {
    style: { flex: '1', minHeight: '0', display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto' },
    parent: panel,
  });

  let visible = false;
  let keyHandler = null;

  function hide() {
    if (!visible) return;
    visible = false;
    mask.style.display = 'none';
    if (keyHandler) {
      window.removeEventListener('keydown', keyHandler);
      keyHandler = null;
    }
    if (panelKey) EventBus.emit(GE.UI_PANEL_CLOSE, { panel: panelKey });
  }
  function show() {
    if (visible) return;
    visible = true;
    mask.style.display = 'flex';
    if (defaultClose) {
      mask.onclick = (e) => { if (e.target === mask) hide(); };
      keyHandler = (e) => { if (e.key === 'Escape') hide(); };
      window.addEventListener('keydown', keyHandler);
    }
  }
  function toggle() { visible ? hide() : show(); }

  closeBtn.addEventListener('click', hide);

  if (typeof onMount === 'function') onMount(panel, body);

  return { root: mask, panel, bodyEl: body, show, hide, toggle, get visible() { return visible; } };
}

export default createStandardPanel;
