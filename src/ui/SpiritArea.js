// src/ui/SpiritArea.js
// 左侧精灵 + 角色区：🧑‍🎤 余默 + 👻 momo
// Phase 1 静态展示，交互留到 Phase 3

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
        left: '12px',
        bottom: '80px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        padding: '10px',
        backgroundColor: 'rgba(255, 251, 230, 0.95)',
        border: '3px solid #3a3a3a',
        borderRadius: '14px',
        boxShadow: '0 3px 8px rgba(0,0,0,0.15)',
        zIndex: 100,
        alignItems: 'center',
      },
      parent,
    });

    // 余默角色头像
    createEl('div', {
      class: ['spirit-avatar', 'avatar-yumo'],
      style: {
        width: '56px',
        height: '56px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '36px',
        border: '2px solid #3a3a3a',
        borderRadius: '50%',
        backgroundColor: '#ffeaa7',
        lineHeight: '1',
      },
      text: '🧑‍🎤',
      attrs: { title: '余默' },
      parent: this.root,
    });

    // momo 精灵头像
    createEl('div', {
      class: ['spirit-avatar', 'avatar-momo'],
      style: {
        width: '48px',
        height: '48px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '30px',
        border: '2px solid #3a3a3a',
        borderRadius: '50%',
        backgroundColor: '#dfe6e9',
        lineHeight: '1',
      },
      text: '👻',
      attrs: { title: 'momo' },
      parent: this.root,
    });

    return this.root;
  }
}

export default SpiritArea;
