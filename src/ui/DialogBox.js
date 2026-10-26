// src/ui/DialogBox.js
// Phase 4 —— 统一确认弹窗（所有面板的依赖组件）
// 外观严格对齐 InventoryPanel（panel-card + 奶油白 + 关闭按钮 ✖ + 92vw×86vh → Dialog 版缩小到 460px）
//
// 调用：
//   EventBus.emit(GE.DIALOG_SHOW, {
//     title: '确认合成？',
//     content: '1 小麦 + 1 稻草 → 1 肥料',
//     options: [
//       { label: '取消', onSelect: () => {} },
//       { label: '确定', onSelect: () => { ... } },
//     ],
//     escClose: true,          // 默认 true
//     backdropClose: true,     // 默认 true
//   });

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { createEl, qs } from './dom.js';
import { devLog } from '../core/Logger.js';

export class DialogBox {
  constructor() {
    this.mask = null;
    this.box = null;
    this.titleEl = null;
    this.contentEl = null;
    this.optionsWrap = null;
    this.visible = false;
    this.currentPayload = null;
    this._keyHandler = null;
  }

  mount(parent = qs('body')) {
    // 遮罩 —— zIndex 必须高于 PanelHelper 的 6000，取 9000
    this.mask = createEl('div', {
      style: {
        position: 'fixed', inset: 0,
        backgroundColor: 'rgba(0,0,0,0.55)',
        zIndex: 9000,
        display: 'none', alignItems: 'center', justifyContent: 'center',
      },
      parent,
    });

    // 卡片 —— 复用 InventoryPanel 的 panel-card 视觉模板（小尺寸版）
    this.box = createEl('div', {
      class: ['panel-card'],
      style: {
        width: 'min(460px, 92vw)',
        maxWidth: '460px',
        maxHeight: 'min(520px, 86vh)',
        background: 'linear-gradient(135deg, #fffbf0 0%, #fff3c4 100%)',
        border: '3px solid #3a3a3a',
        borderRadius: '14px',
        boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
        padding: '14px 16px',
        display: 'flex', flexDirection: 'column', gap: '10px',
        fontFamily: '"LXGW WenKai TC", "Microsoft YaHei", sans-serif',
        color: '#3a2e20',
      },
      parent: this.mask,
    });

    // 头部：大标题
    this.titleEl = createEl('div', {
      style: {
        fontSize: '17px', fontWeight: '800', color: '#3a2e20',
        paddingBottom: '6px', borderBottom: '2px solid #3a3a3a', flexShrink: 0,
      },
      parent: this.box,
    });

    // 正文（可滚动）
    this.contentEl = createEl('div', {
      style: {
        flex: '1', overflowY: 'auto',
        fontSize: '14px', lineHeight: '1.7', color: '#3a2e20',
        whiteSpace: 'pre-wrap', minHeight: '40px',
        background: 'rgba(255,255,255,0.65)', padding: '8px 10px',
        border: '1px dashed #b8a888', borderRadius: '6px',
      },
      parent: this.box,
    });

    // 选项按钮行
    this.optionsWrap = createEl('div', {
      style: {
        display: 'flex', flexWrap: 'wrap', gap: '8px',
        justifyContent: 'center', paddingTop: '8px',
        borderTop: '2px dashed #b8a888', flexShrink: 0,
      },
      parent: this.box,
    });

    EventBus.on(GE.DIALOG_SHOW, (p = {}) => this.show(p));
    this.mask.style.display = 'none';
  }

  show(payload) {
    if (!payload) return;
    this.currentPayload = payload;
    const {
      title = '提示', content = '',
      options = [{ label: '确定', onSelect: () => {} }],
      escClose = true, backdropClose = true,
    } = payload;

    this.titleEl.textContent = title;
    this.contentEl.textContent = content || '';

    // 选项最多 6 个
    while (this.optionsWrap.firstChild) this.optionsWrap.removeChild(this.optionsWrap.firstChild);
    const opts = Array.isArray(options) && options.length ? options.slice(0, 6) : [{ label: '确定', onSelect: () => {} }];
    opts.forEach((opt) => {
      createEl('button', {
        class: ['action-btn'],
        text: opt.label || '确定',
        parent: this.optionsWrap,
        onclick: () => {
          this.hide();
          try { if (typeof opt.onSelect === 'function') opt.onSelect(); }
          catch (err) { devLog.error('[DialogBox] onSelect:', err); }
        },
      }).style.padding = '8px 16px';
    });

    this.visible = true;
    this.mask.style.display = 'flex';

    this.mask.onclick = backdropClose
      ? (e) => { if (e.target === this.mask) this.hide(); }
      : null;

    this._keyHandler = (e) => {
      if (!this.visible) return;
      if ((e.key === 'Escape' || e.key === 'Esc') && escClose) this.hide();
    };
    window.addEventListener('keydown', this._keyHandler);
  }

  hide() {
    if (!this.visible) return;
    this.visible = false;
    this.currentPayload = null;
    this.mask.style.display = 'none';
    if (this._keyHandler) {
      window.removeEventListener('keydown', this._keyHandler);
      this._keyHandler = null;
    }
  }
}

export default DialogBox;
