// src/ui/HotBar.js
// 快捷物品栏：底部居中 10 格，emoji + 右下数量字
// Phase 1 先静态空槽，Phase 2 再接入实际物品

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { createEl, qs } from './dom.js';
import { HOTBAR_SLOTS } from '../utils/constants.js';

export class HotBar {
  constructor() {
    this.root = null;
    this.slotEls = []; // 10 个 slot DOM 引用
  }

  /**
   * 挂载快捷栏
   */
  mount(parent = qs('#app')) {
    // 快捷栏容器
    const hotbarWrap = createEl('div', {
      class: ['hotbar-wrapper'],
      style: {
        position: 'absolute',
        bottom: '16px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 100,
      },
      parent,
    });

    this.root = createEl('div', {
      class: ['hotbar'],
      style: {
        display: 'flex',
        gap: '6px',
        padding: '8px 12px',
        backgroundColor: 'rgba(255, 251, 230, 0.95)',
        border: '3px solid #3a3a3a',
        borderRadius: '14px',
        boxShadow: '0 3px 8px rgba(0,0,0,0.15)',
      },
      parent: hotbarWrap,
    });

    // 创建 10 个槽位
    this.slotEls = [];
    for (let i = 0; i < HOTBAR_SLOTS; i++) {
      const slotEl = this._createSlot(i);
      this.slotEls.push(slotEl);
    }

    // 订阅事件
    this._subscribeEvents();

    return this.root;
  }

  /**
   * 创建单个槽位
   */
  _createSlot(idx) {
    const slot = createEl('div', {
      class: ['hotbar-slot', `slot-${idx}`],
      attrs: { 'data-slot': idx },
      style: {
        width: '46px',
        height: '46px',
        border: '2px solid #5a5a5a',
        borderRadius: '8px',
        backgroundColor: 'rgba(220, 220, 220, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        cursor: 'pointer',
        transition: 'border-color 0.1s',
      },
      parent: this.root,
    });

    // 空槽标记（小数字 idx）
    createEl('span', {
      style: {
        position: 'absolute',
        bottom: '1px',
        left: '3px',
        fontSize: '10px',
        color: '#888',
        lineHeight: '1',
      },
      text: `${idx + 1}`,
      parent: slot,
    });

    return slot;
  }

  /**
   * 从 GS 渲染 hotbar（Phase 1 物品为空，所以什么都不填）
   */
  renderFromGS(gs) {
    if (!gs) return;
    for (let i = 0; i < HOTBAR_SLOTS; i++) {
      const slot = gs.hotbar[i];
      const slotEl = this.slotEls[i];
      if (!slotEl) continue;

      // 清空旧内容（除了 idx 数字）
      const children = Array.from(slotEl.children);
      for (const c of children) {
        if (c !== slotEl.children[0]) c.remove(); // 保留第一个子节点（idx）
      }

      if (slot && slot.itemId) {
        // 有物品：显示 emoji 和数量
        // Phase 2 完整实现，Phase 1 先不填
      }
    }
  }

  _subscribeEvents() {
    EventBus.on(GE.STATE_RESET, ({ gs }) => this.renderFromGS(gs));
    EventBus.on(GE.INVENTORY_CHANGE, () => {
      // 从 GameDirector 获取当前 GS（简化方案）
      if (window.__gameDirector) {
        this.renderFromGS(window.__gameDirector.getGS());
      }
    });
  }
}

export default HotBar;
