// src/ui/SpiritArea.js
// Phase 2B 扩展：点击 momo 触发 InfoPanel 切到祈福 tab（滑入 + 切 tab 3）

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { SPIRITS } from '../data/characters.js';
import { createEl, qs, iconEl } from './dom.js';

export class SpiritArea {
  constructor() {
    this.root = null;
    this.spiritIconEl = null;
  }

  mount(parent = qs('#app')) {
    this.root = createEl('div', {
      class: ['spirit-area'],
      style: {
        position: 'absolute',
        left: '15px',
        // §16.7：左上角三段式 HUD 下方（任务块同步下移后，此处再留出不相交的间距）
        top: 'calc(326px * var(--hud-scale, 1))',
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

    // §16.6 只显示当前选用精灵的图片（图标在 _refresh 中按队伍精灵渲染，不带名字文字）

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
    EventBus.on(GE.TEAM_CHANGE, () => this._refresh());

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
    // §16.6 只留当前选用精灵的图标
    if (this.spiritIconEl) this.spiritIconEl.remove();
    this.spiritIconEl = iconEl('creatures', spiritId || 'momo', {
      def: spirit,
      fallback: spirit?.emoji || '👻',
      size: '28px',
    });
    this.root.appendChild(this.spiritIconEl);
    // 左侧精灵区不显示描述（过长）
    if (this.spiritDescEl) this.spiritDescEl.style.display = 'none';
  }
}

export default SpiritArea;
