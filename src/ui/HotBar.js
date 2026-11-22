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
import { createEl, qs, iconEl } from './dom.js';
import { HOTBAR_SLOTS } from '../utils/constants.js';
import { ForgeSystem } from '../systems/ForgeSystem.js';
import { SKILLS } from '../data/characters.js';
import { ITEMS } from '../data/items.js';
import { POTIONS } from '../data/potions.js';
import { ItemTargeting } from '../systems/ItemTargeting.js';
import { useItem } from '../systems/UseItemSystem.js';
import { rarityFill } from '../data/fieldTraits.js';

/** 可放到地块上的物品：地块内容（设施 / 资源 / 技能 / 地形） */
const PLACEABLE_PREFIX = /^(facility_|resource_|skill_|terrain_)/;

export class HotBar {
  constructor() {
    this.root = null;
    this.slotEls = [];          // 10 个 slot DOM
    this.selectedSlotIdx = null; // 建造模式下选中的槽位 idx（null = 未选中）
    this.selectedContentId = null; // 该槽位上的 contentId（简化：假设 hotbar 里的都是 contentId）
    this.buildMode = false;
    this._targetingFromHotbar = false; // 指向模式是否由快捷栏点击建立（用于切槽/取消时精确回收）
  }

  mount(parent = qs('#app')) {
    const hotbarWrap = this.wrapEl = createEl('div', {
      class: ['hotbar-wrapper'],
      style: {
        position: 'absolute',
        bottom: '16px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 5600,   // 第 8 批：§16.21 商店内快捷栏仍可见、可点（高于商店 5500）
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

    // 背包拖物品进 slot（不消耗背包，§15.19）
    slot.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    });
    slot.addEventListener('drop', (e) => {
      e.preventDefault();
      // drop 必然结束拖拽：兜底复位全局拖拽标记（防止源节点 dragend 未触发时标记残留）
      window.__invDrag = false;
      const itemId = e.dataTransfer?.getData('text/plain');
      if (!itemId) return;
      // 天赋不放 HotBar
      if (itemId.startsWith('talent_')) {
        EventBus.emit(GE.TOAST_SHOW, { text: '🚫 天赋不可放入HotBar', duration: 2000 });
        return;
      }
      const gs = this._getCurrentGS();
      if (!gs) return;
      if (!gs.hotbar) gs.hotbar = [];
      gs.hotbar[idx] = { itemId };
      this.renderFromGS(gs);
      EventBus.emit(GE.TOAST_SHOW, { text: `📌 放入 slot ${idx + 1}`, duration: 1200 });
    });

    return slot;
  }

  _handleSlotClick(idx) {
    const gs = this._getCurrentGS();
    const slot = gs?.hotbar?.[idx];
    if (!slot || !slot.itemId) {
      this._clearSelection();
      return;
    }
    // 再次点击同一格 = 取消选中（原有规则）
    if (this.selectedSlotIdx === idx) {
      this._clearSelection();
      return;
    }

    // 建造模式：只接受「地块内容 / 放置型道具」；其余物品仅在快捷栏展示，不能放置
    if (this.buildMode && !this._canSelectForBuild(slot.itemId)) {
      EventBus.emit(GE.TOAST_SHOW, {
        text: `🚫 ${ITEMS[slot.itemId]?.name || slot.itemId} 不可放置到地块（仅显示）`,
        duration: 2000,
      });
      return;
    }

    this._selectSlot(idx);
    // 切换槽位时先撤掉上一件「需要指向」道具留下的高亮
    if (ItemTargeting.isActive()) {
      ItemTargeting.cancel('hotbarSwitch');
      this._targetingFromHotbar = false;
    }

    if (this.buildMode) {
      // 放置型道具：进入既有指向模式（可放置高亮 / 点地块结算 / ESC 取消），
      // 地块内容则由 MapView 读 selectedBuildContentId 后走 BuildSystem.placeContent
      if (ItemTargeting.needsTarget(slot.itemId)) {
        this._targetingFromHotbar = true;
        const res = ItemTargeting.start(gs, slot.itemId);
        if (!res?.ok) this._targetingFromHotbar = false;
      }
      this._syncSelectionToGS();
      return;
    }

    // 探索模式：选中视觉保留，同时按物品自身规则立即响应（不再有“点了没反应”的死格子）
    this._useFromHotbar(gs, slot.itemId);
  }

  /** 建造模式下可作为“待放置内容”的槽：地块内容 + 放置型消耗道具 */
  _canSelectForBuild(itemId) {
    return PLACEABLE_PREFIX.test(itemId) || ItemTargeting.needsTarget(itemId);
  }

  /**
   * 探索模式点击快捷栏：按物品自身规则处理。
   * 消耗道具 → 能直接用就直接用，需要目标地块就进入既有指向模式；
   * 地块内容 → 提示到建造模式使用；产物 / 装备 / 收藏品（被动）→ 展示物品库原文。
   */
  _useFromHotbar(gs, itemId) {
    if (!gs) return;
    const def = ITEMS[itemId];
    const name = def?.name || itemId;
    const qty = gs.inventory?.items?.find((e) => e.itemId === itemId)?.qty ?? 0;
    if (qty < 1) {
      EventBus.emit(GE.TOAST_SHOW, { text: `🚫 背包里没有 ${name}`, duration: 1600 });
      return;
    }

    const potion = POTIONS[itemId];
    if (potion?.useEffect) {
      if (ItemTargeting.needsTarget(itemId)) {
        this._targetingFromHotbar = true;
        const res = ItemTargeting.start(gs, itemId);
        if (!res?.ok) this._targetingFromHotbar = false;
      } else {
        useItem(gs, itemId, { tileIdx: gs.player.x });
      }
      return;
    }

    if (PLACEABLE_PREFIX.test(itemId)) {
      EventBus.emit(GE.TOAST_SHOW, { text: '🛠️ 地块内容：切到建造模式（Tab）选中后点地块放置', duration: 2200 });
      return;
    }

    // 产物 / 装备 / 收藏品等没有主动使用动作 → 展示物品库原文，不做死格子
    EventBus.emit(GE.TOAST_SHOW, {
      text: def?.description ? `${def.emoji || '📦'} ${name}：${def.description}` : `📦 ${name}`,
      duration: 2600,
    });
  }

  _selectSlot(idx) {
    this.selectedSlotIdx = idx;
    this.selectedContentId = this._getCurrentGS()?.hotbar?.[idx]?.itemId || null;
    this.slotEls.forEach((el, i) => {
      if (i === idx) el.classList.add('selected');
      else el.classList.remove('selected');
    });
  }

  _clearSelection() {
    if (this._targetingFromHotbar) {
      ItemTargeting.cancel('hotbarDeselect');
      this._targetingFromHotbar = false;
    }
    this.selectedSlotIdx = null;
    this.selectedContentId = null;
    this.slotEls.forEach(el => el.classList.remove('selected'));
    if (this.buildMode) {
      this._syncSelectionToGS();
    }
  }

  /** 把选中的 contentId 同步到 gs.uiState.selectedBuildContentId（仅可放置内容才写入） */
  _syncSelectionToGS() {
    const gs = this._getCurrentGS();
    if (!gs) return;
    if (!gs.uiState) gs.uiState = {};
    gs.uiState.selectedBuildContentId =
      this.selectedContentId && this._canSelectForBuild(this.selectedContentId)
        ? this.selectedContentId
        : null;
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
        slotEl.style.opacity = '';

        slotEl.appendChild(this._createItemIcon(slot.itemId));

        // ★ 从背包实时读 qty（HotBar 与背包同步：物品本质属于背包）
        const invEntry = gs.inventory?.items?.find(e => e.itemId === slot.itemId);
        const qty = invEntry?.qty ?? 0;

        // 数量 0 且材料也不足 → 灰底（仍可点击选中，放置会被 BuildSystem 拒绝）；
        // 数量 0 但材料够合成 → 不置灰，放置时由 BuildSystem/ItemTargeting 自动合成
        const noStock = qty === 0 && !ForgeSystem.findCraftableRecipe(gs, slot.itemId);
        slotEl.classList.toggle('no-stock', noStock);
        // 槽位整体按稀有度染色；灰底（数量不足且不可合成）优先级最高
        slotEl.style.backgroundColor = noStock ? 'rgba(150, 150, 150, 0.55)' : rarityFill(ITEMS[slot.itemId]?.rarity);

        // 数量恒显（0 也照常显示 0）
        createEl('div', {
          class: ['slot-qty'],
          text: `${qty}`,
          parent: slotEl,
        });
      } else {
        slotEl.classList.remove('has-content', 'no-stock');
        slotEl.classList.add('empty');
        slotEl.style.opacity = '';
        slotEl.style.backgroundColor = 'rgba(220, 220, 220, 0.6)';
      }
    }

    // 选中槽的物品被移出快捷栏（拖走 / 清空）→ 取消选中；
    // 数量为 0 时不再清除选中（可合成则放置时自动合成）
    if (this.selectedSlotIdx !== null && !gs.hotbar[this.selectedSlotIdx]?.itemId) {
      this._clearSelection();
    }
  }

  /** slot 内物品图标（按前缀/数据表选 group，回退原 emoji） */
  _createItemIcon(itemId) {
    if (itemId.startsWith('skill_')) {
      const def = SKILLS?.[itemId] || null;
      return iconEl('items', itemId, { def, size: '24px', fallback: def?.emoji || '❓', cls: 'slot-emoji' });
    }
    let group = 'facilities';
    let fallback = Assets.getEmoji('facilities', itemId);
    if (!fallback || fallback === '❓') {
      const res = Assets.getEmoji('resources', itemId);
      if (res && res !== '❓') {
        group = 'resources';
        fallback = res;
      } else {
        const item = Assets.getEmoji('items', itemId);
        if (item && item !== '❓') {
          group = 'items';
          fallback = item;
        } else {
          // 地形（含小径）：与背包同口径走 terrains 组，再回退物品库 emoji
          const terrain = Assets.getEmoji('terrains', itemId);
          const libEmoji = ITEMS?.[itemId]?.emoji;
          if (terrain && terrain !== '❓') {
            group = 'terrains';
            fallback = terrain;
          } else if (libEmoji) {
            fallback = libEmoji;
          }
        }
      }
    }
    return iconEl(group, itemId, { size: '24px', fallback, cls: 'slot-emoji' });
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

    // 1-0 数字键选中
    EventBus.on(GE.HOTBAR_SELECT_SLOT, ({ slotIdx }) => {
      if (typeof slotIdx === 'number' && slotIdx >= 0 && slotIdx < HOTBAR_SLOTS) {
        this._handleSlotClick(slotIdx);
      }
    });

    // 建造模式切换
    EventBus.on(GE.UI_MODE_CHANGE, ({ mode }) => {
      const build = mode === 'build';
      const wasBuild = this.buildMode;
      this.buildMode = build;
      if (build) document.body.classList.add('build-mode');
      else document.body.classList.remove('build-mode');

      // 已点选过的槽位在两种模式间保留（探索点 9 号位 → 切建造仍是 9 号位）
      if (this.selectedSlotIdx !== null) {
        const gs = this._getCurrentGS();
        const itemId = gs?.hotbar?.[this.selectedSlotIdx]?.itemId || null;
        if (!itemId) {
          this._clearSelection();
        } else if (build) {
          // 进入建造模式：恢复选中 + 恢复放置型道具的指向高亮
          this._selectSlot(this.selectedSlotIdx);
          if (ItemTargeting.needsTarget(itemId) && !ItemTargeting.isActive()) {
            this._targetingFromHotbar = true;
            const res = ItemTargeting.start(gs, itemId);
            if (!res?.ok) this._targetingFromHotbar = false;
          }
          this._syncSelectionToGS();
          return;
        } else {
          // 回到探索模式：保留选中视觉，只撤掉建造模式留下的指向高亮
          if (this._targetingFromHotbar) {
            ItemTargeting.cancel('modeSwitch');
            this._targetingFromHotbar = false;
          }
          return;
        }
      }

      // 没有历史选中：进入建造模式时默认选中 1 号位（可参与建造时），避免「无法放置」状态
      if (build && !wasBuild) {
        const first = this._getCurrentGS()?.hotbar?.[0];
        // 1 号位可参与建造才自动选中；否则静默清空（避免进入建造模式就弹出“不可选”提示）
        if (first?.itemId && this._canSelectForBuild(first.itemId)) this._handleSlotClick(0);
        else this._clearSelection();
      }
    });
  }
}

export default HotBar;
