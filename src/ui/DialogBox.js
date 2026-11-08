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

// 全局只有一个 DialogBox（main.js 单例）；多实例（冒烟测试会反复 new）时，
// 只让最后挂载的实例响应 DIALOG_SHOW，避免多个实例抢同一事件、互相 disarm。
let _activeDialog = null;

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
    // 「点别处取消」的 pointerdown 只负责取消待确认，随后同一次手势的 click
    // 不得顺手把弹窗关掉；用该标记吞掉这一次 mask click
    this._suppressBackdropClose = false;
    this._offDisarm = null;
    this.confirmFadeMs = CONFIRM_FADE_MS; // 冒烟测试可覆写以加速（文档口径 1.5 秒）
  }

  mount(parent = qs('body')) {
    _activeDialog = this;
    // 遮罩 —— §16.4 选项在信息区：透明遮罩（不压暗主界面），仅承接「点击别处」语义
    // zIndex 必须高于 PanelHelper 的 6000，且高于剧情区 / 选项区（9000）：确认弹窗 9100
    this.mask = createEl('div', {
      style: {
        position: 'fixed', inset: 0,
        backgroundColor: 'rgba(0,0,0,0)',
        zIndex: 9100,
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
    // 取消待确认态的唯一复位入口：ConfirmAction 的任何 disarm（点别处 / ESC / disarmAll）
    // 都会通知到这里，_selectedIdx 必须同步归零；否则下次点击会命中「已选中」分支而跳过 arm。
    this._offDisarm = ConfirmAction.onDisarm((btn) => {
      if (!this._optBtns.includes(btn)) return; // 其它面板 / 其它弹窗实例的按钮
      this._selectedIdx = -1;
      if (this._hintEl) this._hintEl.style.display = 'none';
      if (this.visible) this._suppressBackdropClose = true;
    });
    this.mask.style.display = 'none';
  }

  show(payload) {
    if (!payload) return;
    if (this !== _activeDialog) {
      // 非当前活动实例不抢同一事件；若它还留在屏幕上（旧实例），一并收起，
      // 避免残留的选项按钮 / 快捷键监听干扰当前弹窗的状态机
      if (this.visible) this.hide();
      return;
    }
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
    this._suppressBackdropClose = false;
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
      // 同一次手势的 pointerdown 已判定为「点别处取消」→ 这次 click 只用于取消，不关闭弹窗
      const swallow = this._suppressBackdropClose;
      this._suppressBackdropClose = false;
      if (swallow) return;
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
  // 「取消」这类安全选项可声明 safe:true —— 单击即关闭，不进入待确认（与睡觉/卸下等破坏性选项区分）
  _chooseOption(i) {
    if (!this.visible || this._confirming) return;
    if (this._opts[i]?.safe) { this._confirmOption(i); return; }
    const btn = this._optBtns[i];
    // 状态唯一依据 = 共享组件是否处于待确认态；_selectedIdx 只是镜像，
    // 绝不拿可能过期的它判断「第二次点击」，否则取消后会跳过 arm 直接执行
    if (ConfirmAction.isArmed(btn)) { this._confirmOption(i); return; }
    // arm 内部会 disarmAll（可能触发 onDisarm 把 _selectedIdx 归零），所以先 arm 再写镜像
    if (!ConfirmAction.arm(btn, { hintEl: this._hintEl, text: CONFIRM_TEXT })) return;
    this._selectedIdx = i;
    this._suppressBackdropClose = false;
  }

  _deselect() {
    // 取消的唯一入口：disarmAll → onDisarm 监听器统一复位 _selectedIdx / 提示
    ConfirmAction.disarmAll();
    this._suppressBackdropClose = false;
  }

  // §16.4：确认 —— 立即调用 onSelect（业务先于动画），随后整卡 1.5 秒淡出
  _confirmOption(i) {
    this._confirming = true;
    const btn = this._optBtns[i];
    const opt = this._opts[i];
    // safe 选项单击直达确认：先补一次 arm 让共享组件正常走 trigger，同一 tick 内完成 arm→trigger
    if (!ConfirmAction.isArmed(btn)) ConfirmAction.arm(btn, { hintEl: this._hintEl, text: CONFIRM_TEXT });
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
    this._suppressBackdropClose = false;
    if (this._hintEl) this._hintEl.style.display = 'none';
    if (this._keyHandler) {
      window.removeEventListener('keydown', this._keyHandler);
      this._keyHandler = null;
    }
  }
}

export default DialogBox;
