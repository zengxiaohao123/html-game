// src/ui/HotBar.js
// Phase 2B 补全：
//   - renderFromGS 真正显示 emoji + 数量
//   - 建造模式下已内容槽可点击选中（黄色高亮）
//   - 选中后 tile 点击时 MapView 会拿 selectedContentId 去 BuildSystem.placeContent
//   - 订阅 GE.UI_MODE_CHANGE 切换建造/探索模式视觉反馈
//
// 注意：HotBar 不自己放东西到地图，它只记录 this.selectedSlotIdx / this.selectedContentId；
// 真正的放置由 MapView 在建造模式下处理（读 HotBar.selectedContentId）。

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { Assets } from '../core/Assets.js';
import { createEl, qs } from './dom.js';
import { HOTBAR_SLOTS } from '../utils/constants.js';

export class HotBar {
  constructor() {
    this.root = null;
    this.slotEls = [];          // 10 个 slot DOM
    this.selectedSlotIdx = null; // 建造模式下选中的槽位 idx（null = 未选中）
    this.selectedContentId = null; // 该槽位上的 contentId（简化：假设 hotbar 里的都是 contentId）
    this.buildMode = false;
  }

  mount(parent = qs('#app')) {
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

    this.slotEls = [];
    for (let i = 0; i < HOTBAR_SLOTS; i++) {
      const slotEl = this._createSlot(i);
      this.slotEls.push(slotEl);
    }

    this._subscribeEvents();
    return this.root;
  }

  _createSlot(idx) {
    const slot = createEl('div', {
      class: ['hotbar-slot', `slot-${idx}`],
      attrs: { 'data-slot': idx },
      style: {
        width: '46px', height: '46px',
        border: '2px solid #5a5a5a',
        borderRadius: '8px',
        backgroundColor: 'rgba(220, 220, 220, 0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative',
        cursor: 'pointer',
        transition: 'border-color 0.1s',
      },
      parent: this.root,
    });

    createEl('span', {
      style: {
        position: 'absolute', bottom: '1px', left: '3px',
        fontSize: '10px', color: '#888', lineHeight: '1',
      },
      text: `${idx + 1}`,
      parent: slot,
    });

    // 点击选中（仅建造模式 + 槽有内容）
    slot.addEventListener('click', () => this._handleSlotClick(idx));

    // ── 拖拽进 HotBar slot（优先级7，§15.19 行 1221：不消耗背包） ──
    slot.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      slot.style.borderColor = '#e8a900'; // 高亮放置目标
    });

    slot.addEventListener('dragenter', (e) => {
      e.preventDefault();
    });

    slot.addEventListener('dragleave', () => {
      slot.style.borderColor = '#5a5a5a'; // 恢复
    });

    slot.addEventListener('drop', (e) => {
      e.preventDefault();
      slot.style.borderColor = '#5a5a5a';
      if (!e.dataTransfer) return;

      const itemId = e.dataTransfer.getData('text/plain');
      if (!itemId) return;

      const gs = this._getCurrentGS();
      if (!gs) return;

      // 天赋不放HotBar（§12 行 479）
      if (itemId.startsWith('talent_')) {
        EventBus.emit(GE.TOAST_SHOW, { text: '🚫 天赋不可放进HotBar', duration: 2000 });
        return;
      }

      // 写入HotBar slot（不消耗背包，§15.19 行 1221）
      if (!gs.hotbar) gs.hotbar = [];
      gs.hotbar[idx] = { itemId };

      // 刷新显示
      this.renderFromGS(gs);
      EventBus.emit(GE.TOAST_SHOW, {
        text: `📌 ${itemId} 放入 HotBar slot ${idx + 1}`,
        duration: 1500,
      });
    });

    return slot;
  }

  _handleSlotClick(idx) {
    const slot = this._getCurrentGS()?.hotbar?.[idx];
    if (!slot || !slot.itemId) {
      this._clearSelection();
      return;
    }
    // 切换选中
    if (this.selectedSlotIdx === idx) {
      this._clearSelection();
    } else {
      this.selectedSlotIdx = idx;
      this.selectedContentId = slot.itemId;
      this.slotEls.forEach((el, i) => {
        if (i === idx) el.classList.add('selected');
        else el.classList.remove('selected');
      });
      // 建造模式下才同步到 GS（让 MapView 能读到用来放置）
      // 探索模式下只做视觉高亮，不写 gs（§15.14 行 1152）
      if (this.buildMode) {
        this._syncSelectionToGS();
      }
    }
  }

  _clearSelection() {
    this.selectedSlotIdx = null;
    this.selectedContentId = null;
    this.slotEls.forEach(el => el.classList.remove('selected'));
    // 只有建造模式才同步到 GS（探索模式下选中只是视觉的）
    if (this.buildMode) {
      this._syncSelectionToGS();
    }
  }

  /** 把选中的 contentId 同步到 gs.uiState.selectedBuildContentId */
  _syncSelectionToGS() {
    const gs = this._getCurrentGS();
    if (!gs) return;
    if (!gs.uiState) gs.uiState = {};
    gs.uiState.selectedBuildContentId = this.selectedContentId;
  }

  /** 从 GS 渲染 */
  renderFromGS(gs) {
    if (!gs) return;
    for (let i = 0; i < HOTBAR_SLOTS; i++) {
      const slot = gs.hotbar[i];
      const slotEl = this.slotEls[i];
      if (!slotEl) continue;

      // 清空旧内容（保留 idx 数字——第一个子元素）
      while (slotEl.children.length > 1) {
        slotEl.removeChild(slotEl.lastChild);
      }

      if (slot && slot.itemId) {
        slotEl.classList.add('has-content');
        slotEl.classList.remove('empty');

        const emoji = this._resolveEmoji(slot.itemId);
        createEl('div', { class: ['slot-emoji'], text: emoji, parent: slotEl });

        // ★ 从背包实时读 qty（HotBar 与背包同步：物品本质属于背包）
        const invEntry = gs.inventory?.items?.find(e => e.itemId === slot.itemId);
        const qty = invEntry?.qty ?? 0;
        if (qty > 1) {
          createEl('div', { class: ['slot-qty'], text: `×${qty}`, parent: slotEl });
        }

        // 库存归 0 → 该 slot 仍显示 emoji（玩家知道"我选了什么"），但视觉上淡一点
        if (qty === 0) {
          slotEl.style.opacity = '0.55';
        } else {
          slotEl.style.opacity = '';
        }
      } else {
        slotEl.classList.remove('has-content');
        slotEl.classList.add('empty');
        slotEl.style.opacity = '';
      }
    }

    // 若选中 slot 的物品库存归 0 → 清除选中
    if (this.selectedSlotIdx !== null) {
      const curSlot = gs.hotbar[this.selectedSlotIdx];
      const inv = curSlot?.itemId ? gs.inventory?.items?.find(e => e.itemId === curSlot.itemId) : null;
      if (!inv || inv.qty < 1) {
        this._clearSelection();
      }
    }
  }

  _resolveEmoji(itemId) {
    return Assets.getEmoji('facilities', itemId)
      || Assets.getEmoji('resources', itemId)
      || Assets.getEmoji('items', itemId)
      || '❓';
  }

  _getCurrentGS() {
    if (window.__gameDirector) return window.__gameDirector.getGS();
    return null;
  }

  _subscribeEvents() {
    EventBus.on(GE.STATE_RESET, ({ gs }) => this.renderFromGS(gs));
    EventBus.on(GE.INVENTORY_CHANGE, () => {
      if (window.__gameDirector) this.renderFromGS(window.__gameDirector.getGS());
    });

    // ── 1-0 数字键选中 HotBar slot（优先级2） ──
    EventBus.on(GE.HOTBAR_SELECT_SLOT, ({ slotIdx }) => {
      if (typeof slotIdx === 'number' && slotIdx >= 0 && slotIdx < HOTBAR_SLOTS) {
        this._handleSlotClick(slotIdx);
      }
    });

    // 建造模式切换
    EventBus.on(GE.UI_MODE_CHANGE, ({ mode }) => {
      const build = mode === 'build';
      this.buildMode = build;
      if (build) {
        document.body.classList.add('build-mode');
        // 建造模式默认清空选中，让玩家自己选
        this._clearSelection();
      } else {
        document.body.classList.remove('build-mode');
        this._clearSelection();
      }
    });
  }
}

export default HotBar;
