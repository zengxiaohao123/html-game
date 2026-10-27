// src/ui/SpiritArea.js
// Phase 2B 扩展：点击 momo 触发 InfoPanel 切到祈福 tab（滑入 + 切 tab 3）

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { SPIRITS } from '../data/characters.js';
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
        top: '250px',
        padding: '6px 8px',
        borderRadius: '12px',
        border: '3px solid #e8c547',
        backgroundColor: '#ffffff',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '2px',
        zIndex: 100,
        cursor: 'pointer',
        transition: 'transform 0.15s',
        minWidth: '60px',
        fontFamily: '"LXGW WenKai TC", sans-serif',
      },
      parent,
    });

    // 精灵 emoji
    this.spiritEmojiEl = createEl('span', {
      text: '👻',
      style: {
        fontSize: '28px',
        lineHeight: '1',
        display: 'inline-block',
        fontFamily: '"Segoe UI Emoji", "Apple Color Emoji", "Segoe UI Symbol", "Noto Color Emoji", sans-serif',
      },
      parent: this.root,
    });

    // 精灵名字
    this.spiritNameEl = createEl('div', {
      text: 'momo',
      style: { fontSize: '11px', fontWeight: '700', color: '#5a4a3a', lineHeight: '1' },
      parent: this.root,
    });

    // 精灵效果描述
    this.spiritDescEl = createEl('div', {
      text: '祈福：每日首次减半消耗',
      style: { fontSize: '12px', color: '#8a6a3a', lineHeight: '1.3', textAlign: 'center', maxWidth: '100px', fontWeight: '600' },
      parent: this.root,
    });

    // 初始刷新
    this._refresh();

    // 监听队伍变化刷新精灵显示
    EventBus.on(GE.STATE_RESET, () => this._refresh());
    EventBus.on(GE.BOOT, () => this._refresh());

    // hover 效果
    this.root.addEventListener('mouseenter', () => {
      this.root.style.transform = 'scale(1.06)';
    });
    this.root.addEventListener('mouseleave', () => {
      this.root.style.transform = 'scale(1)';
    });

    // 点击：让 InfoPanel 切到 tab 3（祈福 tab）
    this.root.addEventListener('click', () => {
      const gs = window.__gameDirector?.getGS?.();
      const tileIdx = gs?.player?.x ?? 0;
      EventBus.emit(GE.TILE_CLICKED, { tileIdx });
      EventBus.emit('ui:infoShowBless', {});
    });

    return this.root;
  }

  _refresh() {
    const gs = window.__gameDirector?.getGS?.();
    const spiritId = gs?.team?.groups?.[gs?.team?.activeGroup ?? 0]?.spirit;
    const spirit = spiritId ? SPIRITS[spiritId] : SPIRITS.momo;
    if (this.spiritEmojiEl) this.spiritEmojiEl.textContent = spirit?.emoji || '👻';
    if (this.spiritNameEl) this.spiritNameEl.textContent = spirit?.name || '';
    if (this.spiritDescEl) this.spiritDescEl.textContent = spirit?.description || '';
  }
}

export default SpiritArea;
