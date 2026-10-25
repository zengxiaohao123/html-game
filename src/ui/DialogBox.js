// src/ui/DialogBox.js
// Phase 4 —— 统一确认弹窗（核心组件）
// 任何需要弹确认框的地方都：
//   EventBus.emit(GE.DIALOG_SHOW, {
//     title: '标题',
//     content: '正文（可多行/滚动）',
//     options: [
//       { label: '取消', onSelect: () => {} },
//       { label: '确定', onSelect: () => { ... } },
//     ],
//     escClose: true,          // 默认 true，ESC 关闭
//     backdropClose: true,     // 默认 true，点遮罩关闭
//   });
//
// DialogBox 订阅 GE.DIALOG_SHOW；options 最多 6 个。ESC 关闭触发 onSelect(null) 或仅关闭。

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
    // 遮罩（z-index 必须高于 panel-mask 的 5000，取 9000）
    this.mask = createEl('div', {
      class: ['dialog-mask'],
      style: {
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.55)',
        zIndex: 9000,
        display: 'none',
        alignItems: 'center',
        justifyContent: 'center',
      },
      parent,
    });

    // 卡片（复用 panel-card 的风格）
    this.box = createEl('div', {
      class: ['panel-card', 'dialog-box'],
      style: {
        width: 'min(460px, 92vw)',
        maxHeight: 'min(520px, 86vh)',
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        fontFamily: '"LXGW WenKai TC", "Microsoft YaHei", sans-serif',
        color: '#3a2e20',
      },
      parent: this.mask,
    });

    // 标题
    this.titleEl = createEl('div', {
      style: {
        fontSize: '18px',
        fontWeight: '700',
        color: '#3a2e20',
        paddingBottom: '6px',
        borderBottom: '2px solid #e8a900',
        flexShrink: 0,
      },
      parent: this.box,
    });

    // 正文（可滚动）
    this.contentEl = createEl('div', {
      style: {
        flex: '1',
        overflowY: 'auto',
        fontSize: '14px',
        lineHeight: '1.65',
        color: '#3a2e20',
        whiteSpace: 'pre-wrap',
        minHeight: '40px',
      },
      parent: this.box,
    });

    // 选项按钮行
    this.optionsWrap = createEl('div', {
      style: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: '8px',
        justifyContent: 'center',
        paddingTop: '8px',
        borderTop: '2px dashed #b8a888',
        flexShrink: 0,
      },
      parent: this.box,
    });

    // 事件订阅
    this._subscribeEvents();
    // 默认隐藏
    this.mask.style.display = 'none';
  }

  _subscribeEvents() {
    EventBus.on(GE.DIALOG_SHOW, (payload = {}) => this.show(payload));
  }

  show(payload) {
    if (!payload) return;
    this.currentPayload = payload;
    const {
      title = '提示',
      content = '',
      options = [{ label: '确定', onSelect: () => {} }],
      escClose = true,
      backdropClose = true,
    } = payload;

    // 标题
    this.titleEl.textContent = title;

    // 正文
    this.contentEl.textContent = content || '';

    // 选项：最多 6 个
    while (this.optionsWrap.firstChild) this.optionsWrap.removeChild(this.optionsWrap.firstChild);
    const opts = Array.isArray(options) ? options.slice(0, 6) : [];
    if (opts.length === 0) opts.push({ label: '确定', onSelect: () => {} });

    opts.forEach((opt) => {
      const btn = createEl('button', {
        class: ['action-btn', 'dialog-option-btn'],
        text: opt.label || '确定',
        parent: this.optionsWrap,
      });
      btn.style.padding = '8px 16px';
      btn.style.fontSize = '14px';
      btn.addEventListener('click', () => {
        this.hide();
        try { if (typeof opt.onSelect === 'function') opt.onSelect(); }
        catch (err) { devLog.error('[DialogBox] onSelect error:', err); }
      });
    });

    // 显示
    this.visible = true;
    this.mask.style.display = 'flex';

    // 点击遮罩关闭
    if (backdropClose) {
      this.mask.onclick = (e) => {
        if (e.target === this.mask) {
          this.hide();
        }
      };
    } else {
      this.mask.onclick = null;
    }

    // ESC 关闭
    this._keyHandler = (e) => {
      if (!this.visible) return;
      if (e.key === 'Escape' || e.key === 'Esc') {
        if (escClose) this.hide();
      }
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
