// src/ui/SpiritArea.js
// 左侧精灵区：只有 momo 精灵圆形头像
// 按 ui-main.png 位置：top:150px left:15px，金色边框 3px #e8c547，白色圆底
// 下方的任务条（� + momo + 余默头像）留到 Phase 3 做
// Phase 1 Brief 里"🧑‍🎤 余默 + 👻 momo 头像"的描述是笔误，以 ui-main.png 为准

import { createEl, qs } from './dom.js';

export class SpiritArea {
  constructor() {
    this.root = null;
  }

  mount(parent = qs('#app')) {
    this.root = createEl('div', {
      class: ['spirit-area'],
      style: {
        position: 'absolute',
        left: '15px',
        top: '150px',
        width: '60px',
        height: '60px',
        borderRadius: '50%',
        border: '3px solid #e8c547',
        backgroundColor: '#ffffff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        cursor: 'pointer',
        transition: 'transform 0.15s',
      },
      attrs: { title: 'momo（点击祈福·Phase 2）' },
      parent,
    });

    // momo emoji（强制 emoji 字体）
    createEl('span', {
      text: '👻',
      style: {
        fontSize: '32px',
        lineHeight: '1',
        display: 'inline-block',
        fontFamily: '"Segoe UI Emoji", "Apple Color Emoji", "Segoe UI Symbol", "Noto Color Emoji", sans-serif',
      },
      parent: this.root,
    });

    // hover 效果
    this.root.addEventListener('mouseenter', () => {
      this.root.style.transform = 'scale(1.08)';
    });
    this.root.addEventListener('mouseleave', () => {
      this.root.style.transform = 'scale(1)';
    });
    this.root.addEventListener('click', () => {
      // Phase 2 接入祈福面板，Phase 1 只弹 Toast
      import('../core/EventBus.js').then(m => {
        m.EventBus.emit(m.GE.TOAST_SHOW, { text: 'momo 祈福功能 Phase 2 开放～', duration: 1500 });
      });
    });

    return this.root;
  }
}

export default SpiritArea;
