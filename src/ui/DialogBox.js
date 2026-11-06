// src/ui/DialogBox.js
// Phase 4 —— 统一确认弹窗（所有面板的依赖组件）
//
// §16.4 选项模式：选项放在信息区（右侧信息面板位置），不是屏幕中央模态弹窗：
//   · 卡片定位与 InfoPanel 一致（右侧 380px、垂直居中），遮罩透明不压暗主界面
//   · 鼠标点击或数字键 1~6（最多 6 个），两者等效
//   · 第一次点击 = 待确认：浅绿色背景，下方小字「你确定这么做？」
//   · 点击别处 = 取消待确认；点击其他选项 = 切换待确认项
//   · 再次点击已选中项 = 确认：同一 tick 立即执行结果，随后整卡 1.5 秒淡出
//     （统一走 ConfirmAction.js，不再有「延迟 2 秒生效 / 先复原再执行」）
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
import * as ConfirmAction from './ConfirmAction.js';
import { CONFIRM_TEXT, CONFIRM_FADE_MS } from './ConfirmAction.js';

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
    this._hintEl = null;
    this.confirmFadeMs = CONFIRM_FADE_MS; // 冒烟测试可覆写以加速（文档口径 1.5 秒）
  }

  mount(parent = qs('body')) {
    // 遮罩 —— §16.4 选项在信息区：透明遮罩（不压暗主界面），仅承接「点击别处」语义
    // zIndex 必须高于 PanelHelper 的 6000，取 9000
    this.mask = createEl('div', {
      style: {
        position: 'fixed', inset: 0,
        backgroundColor: 'rgba(0,0,0,0)',
        zIndex: 9000,
        display: 'none',
      },
      parent,
    });

    // 卡片 —— 定位与 InfoPanel 一致：右侧信息区、垂直居中（§16.4）
    this.box = createEl('div', {
      class: ['panel-card'],
      style: {
        position: 'absolute',
        right: '20px', top: '52%', transform: 'translate(0, -50%)',
        width: '380px',
        maxWidth: 'calc(100vw - 40px)',
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
      text: CONFIRM_TEXT,
      parent: this.box,
    });

    EventBus.on(GE.DIALOG_SHOW, (p = {}) => this.show(p));
    this.mask.style.display = 'none';
  }

  show(payload) {
    if (!payload) return;
    // 重入防护（连点/弹窗叠开）：上一个弹窗的待确认态 / 淡出计时器必须先清掉，
    // 避免旧计时器把新弹窗误关、或旧按钮的确认态残留。
    ConfirmAction.disarmAll();
    if (this._keyHandler) {
      window.removeEventListener('keydown', this._keyHandler);
      this._keyHandler = null;
    }
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
    this.mask.style.display = 'block';

    // §16.4：点击别处 = 取消选中（有选中时不关闭）；无选中时沿用 backdropClose 关闭
    this.mask.onclick = (e) => {
      if (e.target !== this.mask || this._confirming) return;
      if (this._selectedIdx >= 0) { this._deselect(); return; }
      if (backdropClose) this.hide();
    };

    this._keyHandler = (e) => {
      if (!this.visible) return;
      if ((e.key === 'Escape' || e.key === 'Esc') && escClose) {
        // 标记本次 ESC 已被弹窗消费：InputManager 据此跳过面板栈逻辑（与监听顺序无关）
        e._dialogConsumedEsc = true;
        this.hide();
        return;
      }
      // §16.4：数字键 1~6 与鼠标点击等效
      const n = Number.parseInt(e.key, 10);
      if (n >= 1 && n <= this._optBtns.length) {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        this._chooseOption(n - 1);
      }
    };
    window.addEventListener('keydown', this._keyHandler);
  }

  // §16.4：第一次点击 = 待确认；再次点击已选中项 = 确认（同一 tick 立即执行）
  _chooseOption(i) {
    if (!this.visible || this._confirming) return;
    if (this._selectedIdx === i) { this._confirmOption(i); return; }
    this._selectedIdx = i;
    this._optBtns.forEach((btn, k) => {
      if (k === i) ConfirmAction.arm(btn, { hintEl: this._hintEl, text: CONFIRM_TEXT });
      else ConfirmAction.disarm(btn);
    });
  }

  _deselect() {
    this._selectedIdx = -1;
    ConfirmAction.disarmAll();
    if (this._hintEl) this._hintEl.style.display = 'none';
  }

  // §16.4：确认 —— 立即调用 onSelect（业务先于动画），随后整卡 1.5 秒淡出
  _confirmOption(i) {
    this._confirming = true;
    const btn = this._optBtns[i];
    const opt = this._opts[i];
    btn?.classList?.add('dialog-opt-flash');
    if (this._hintEl) this._hintEl.style.display = 'none';
    ConfirmAction.trigger(btn, () => {
      if (typeof opt?.onSelect === 'function') opt.onSelect();
    }, {
      fadeTarget: this.mask,
      fadeMs: this.confirmFadeMs,
      onFaded: () => this.hide(),
    });
  }

  hide() {
    ConfirmAction.disarmAll();
    if (!this.visible) return;
    this.visible = false;
    this.currentPayload = null;
    this.mask.style.display = 'none';
    this.mask.style.opacity = '1';
    this.mask.style.pointerEvents = '';
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
