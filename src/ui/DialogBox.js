// src/ui/DialogBox.js
// Phase 4 —— 统一确认弹窗（所有面板的依赖组件）
// 外观严格对齐 InventoryPanel（panel-card + 奶油白 + 关闭按钮 ✖ + 92vw×86vh → Dialog 版缩小到 460px）
//
// 第 11 批 §16.4 选项模式：
//   · 鼠标点击或数字键 1~6（最多 6 个），两者等效
//   · 第一次点击 = 选中：浅绿色背景，下方小字「你确定这么做？」
//   · 点击别处 = 取消选中；点击其他选项 = 切换选中
//   · 再次点击已选中项 = 确认：选项闪烁 + 淡金色背景，2 秒后淡出并触发结果
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

const SELECT_BG = '#d9efdc';   // §16.4 选中：浅绿色背景
const CONFIRM_BG = '#f7e6a8';  // §16.4 确认：淡金色背景
const CONFIRM_FADE_MS = 2000;  // §16.4 确认后 2 秒淡出

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
    this._optBtns = [];
    this._opts = [];
    this._selectedIdx = -1;
    this._confirming = false;
    this._confirmTimer = null;
    this._fadeTimer = null;
    this._hintEl = null;
    this.confirmFadeMs = CONFIRM_FADE_MS; // 冒烟测试可覆写以加速
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

    // §16.4：选中选项后下方出现的确认小字
    this._hintEl = createEl('div', {
      style: {
        fontSize: '12px', color: '#7a6a4f', textAlign: 'center',
        flexShrink: 0, display: 'none',
      },
      text: '你确定这么做？',
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

    // 选项最多 6 个（§16.4 数字键 1~6）
    while (this.optionsWrap.firstChild) this.optionsWrap.removeChild(this.optionsWrap.firstChild);
    const opts = Array.isArray(options) && options.length ? options.slice(0, 6) : [{ label: '确定', onSelect: () => {} }];
    this._opts = opts;
    this._optBtns = [];
    this._selectedIdx = -1;
    this._confirming = false;
    if (this._hintEl) this._hintEl.style.display = 'none';
    opts.forEach((opt, i) => {
      const btn = createEl('button', {
        class: ['action-btn', 'dialog-opt'],
        text: opt.label || '确定',
        parent: this.optionsWrap,
        onclick: () => this._chooseOption(i),
      });
      btn.style.padding = '8px 16px';
      btn.style.transition = 'background 0.15s ease';
      btn.setAttribute('data-opt-idx', String(i));
      this._optBtns.push(btn);
    });

    this.visible = true;
    this.mask.style.opacity = '1';
    this.mask.style.transition = 'opacity 0.3s ease';
    this.mask.style.display = 'flex';

    // §16.4：点击别处 = 取消选中（有选中时不关闭）；无选中时沿用 backdropClose 关闭
    this.mask.onclick = (e) => {
      if (e.target !== this.mask || this._confirming) return;
      if (this._selectedIdx >= 0) { this._deselect(); return; }
      if (backdropClose) this.hide();
    };

    this._keyHandler = (e) => {
      if (!this.visible) return;
      if ((e.key === 'Escape' || e.key === 'Esc') && escClose) { this.hide(); return; }
      // §16.4：数字键 1~6 与鼠标点击等效
      const n = Number.parseInt(e.key, 10);
      if (n >= 1 && n <= this._optBtns.length) {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        this._chooseOption(n - 1);
      }
    };
    window.addEventListener('keydown', this._keyHandler);
  }

  // §16.4：第一次点击 = 选中；再次点击已选中项 = 确认
  _chooseOption(i) {
    if (!this.visible || this._confirming) return;
    if (this._selectedIdx === i) { this._confirmOption(i); return; }
    this._selectedIdx = i;
    this._optBtns.forEach((btn, k) => {
      btn.style.background = k === i ? SELECT_BG : '';
    });
    if (this._hintEl) this._hintEl.style.display = 'block';
  }

  _deselect() {
    this._selectedIdx = -1;
    for (const btn of this._optBtns) btn.style.background = '';
    if (this._hintEl) this._hintEl.style.display = 'none';
  }

  // §16.4：确认 —— 闪烁 + 淡金底，2 秒后淡出并触发结果
  _confirmOption(i) {
    this._confirming = true;
    const btn = this._optBtns[i];
    const opt = this._opts[i];
    btn.style.background = CONFIRM_BG;
    btn.classList.add('dialog-opt-flash');
    if (this._hintEl) this._hintEl.style.display = 'none';
    this._confirmTimer = setTimeout(() => {
      this._confirmTimer = null;
      this.mask.style.opacity = '0'; // 淡出
      this._fadeTimer = setTimeout(() => {
        this._fadeTimer = null;
        this.hide();
        try { if (typeof opt.onSelect === 'function') opt.onSelect(); }
        catch (err) { devLog.error('[DialogBox] onSelect:', err); }
      }, 320);
    }, this.confirmFadeMs);
  }

  hide() {
    if (this._confirmTimer) { clearTimeout(this._confirmTimer); this._confirmTimer = null; }
    if (this._fadeTimer) { clearTimeout(this._fadeTimer); this._fadeTimer = null; }
    if (!this.visible) return;
    this.visible = false;
    this.currentPayload = null;
    this.mask.style.display = 'none';
    this.mask.style.opacity = '1';
    this._optBtns = [];
    this._opts = [];
    this._selectedIdx = -1;
    this._confirming = false;
    if (this._hintEl) this._hintEl.style.display = 'none';
    if (this._keyHandler) {
      window.removeEventListener('keydown', this._keyHandler);
      this._keyHandler = null;
    }
  }
}

export default DialogBox;
