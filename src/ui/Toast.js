// src/ui/Toast.js
// 全局 Toast 提示：订阅 GE.TOAST_SHOW，2 秒自动消失
// 挂载到 index.html 预留的 #toast-layer

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { createEl, qs } from './dom.js';

/** 默认显示时长（ms） */
const DEFAULT_DURATION = 2000;

export class Toast {
  constructor() {
    this.layer = null;
    this.activeToasts = new Set();
  }

  mount() {
    // 使用 index.html 里预留的 #toast-layer，不存在则动态创建
    this.layer = qs('#toast-layer');
    if (!this.layer) {
      this.layer = createEl('div', {
        class: ['toast-layer'],
        id: 'toast-layer',
        parent: qs('body'),
      });
    }

    // 覆盖层样式（确保居中在屏幕中央）
    this.layer.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      pointer-events: none;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    `;

    // 订阅事件
    EventBus.on(GE.TOAST_SHOW, ({ text, duration }) => {
      this.show(text, duration);
    });
  }

  /**
   * 显示一个 Toast
   * @param {string} text 提示文字
   * @param {number} [duration=2000] 显示时长（ms）
   */
  show(text, duration = DEFAULT_DURATION) {
    if (!this.layer || !text) return;

    const toast = createEl('div', {
      class: ['toast-item'],
      style: {
        padding: '10px 20px',
        backgroundColor: 'rgba(51, 51, 51, 0.92)',
        color: '#fff',
        fontSize: '16px',
        border: '2px solid #fff',
        borderRadius: '12px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        fontFamily: '"LXGW WenKai TC", sans-serif',
        fontWeight: '600',
        textShadow: '0 1px 2px rgba(0,0,0,0.5)',
        animation: 'toast-fade-in 0.2s ease-out',
      },
      text: text,
      parent: this.layer,
    });

    // 定时移除
    const timer = setTimeout(() => {
      toast.style.animation = 'toast-fade-out 0.3s ease-out';
      toast.addEventListener('animationend', () => {
        toast.remove();
        this.activeToasts.delete(toast);
      }, { once: true });
    }, duration);

    this.activeToasts.add(toast);

    // 防止内存泄漏
    toast.addEventListener('remove', () => clearTimeout(timer));
  }
}

export default Toast;
