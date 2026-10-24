// src/ui/TopBar.js
// 顶部状态栏：❤️ hp/maxHp, ⚔️ atk, 🔷 stamina/maxStamina, 🪙 gold, 🐣 友善 cap/current, 👹 危险 cap/current
// 位置：按 ui-main.png 偏左上角

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { Assets } from '../core/Assets.js';
import { createEl, qs } from './dom.js';

export class TopBar {
  constructor() {
    this.root = null;
    this.gs = null;
    // 各数值 DOM 引用
    this.hpEl = null;
    this.atkEl = null;
    this.staminaEl = null;
    this.goldEl = null;
    this.friendlyCapEl = null;
    this.friendlyCurrentEl = null;
    this.dangerCapEl = null;
    this.dangerCurrentEl = null;
  }

  /**
   * 挂载顶部栏
   */
  mount(gs, parent = qs('#app')) {
    this.gs = gs;

    this.root = createEl('div', {
      class: ['top-bar'],
      style: {
        position: 'absolute',
        top: '8px',
        left: '12px',
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        padding: '8px 16px',
        backgroundColor: 'rgba(255, 251, 230, 0.95)',
        border: '3px solid #3a3a3a',
        borderRadius: '14px',
        boxShadow: '0 3px 8px rgba(0,0,0,0.15)',
        zIndex: 100,
        flexWrap: 'wrap',
        fontFamily: '"LXGW WenKai TC", sans-serif',
        fontWeight: '700',
        fontSize: '16px',
      },
      parent,
    });

    // 渲染所有数值项
    this._renderAll();

    // 订阅事件
    this._subscribeEvents();

    return this.root;
  }

  /** 渲染所有数值 */
  _renderAll() {
    if (!this.root || !this.gs) return;

    // 先清空
    while (this.root.firstChild) this.root.removeChild(this.root.firstChild);

    const p = this.gs.player;
    const c = this.gs.capacity;

    // ❤️ HP
    this.hpEl = this._makeStat(Assets.ui.hp, `${p.hp}/${p.maxHp}`, '#e74c3c');
    this.atkEl = this._makeStat(Assets.ui.atk, `${p.atk}`, '#8e44ad');
    this.staminaEl = this._makeStat(Assets.ui.stamina, `${p.stamina}/${p.maxStamina}`, '#2980b9');
    this.goldEl = this._makeStat(Assets.ui.gold, `${p.gold}`, '#d4a017');
    this.friendlyCapEl = this._makeStat(Assets.ui.capacity_friendly, `${c.friendly}`, '#27ae60');
    // Phase 1 没有生物，current 暂时和 cap 一样显示
    this.friendlyCurrentEl = this._makeStat('/4', '', '#27ae60'); // 简化
    this.dangerCapEl = this._makeStat(Assets.ui.capacity_danger, `${c.danger}`, '#c0392b');
    this.dangerCurrentEl = this._makeStat('/4', '', '#c0392b'); // 简化

    // 再把 current 项移除（Phase 1 简化，不单独显示 current）
    if (this.friendlyCurrentEl) this.friendlyCurrentEl.remove();
    if (this.dangerCurrentEl) this.dangerCurrentEl.remove();

    // 显示天数
    this._makeStat('📅', `Day ${this.gs.day}`, '#2c3e50');
  }

  /**
   * 构建单个 stat DOM 项
   * @returns {HTMLElement}
   */
  _makeStat(emoji, text, color) {
    const stat = createEl('div', {
      class: ['stat-item'],
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        color: color || '#333',
      },
      parent: this.root,
    });
    createEl('span', { text: emoji, style: { fontSize: '20px', lineHeight: '1' } }, stat);
    createEl('span', { text: text || '', style: { fontSize: '14px', lineHeight: '1' } }, stat);
    return stat;
  }

  /** 更新 stamina 数值 */
  _updateStamina() {
    if (!this.gs || !this.staminaEl) return;
    const p = this.gs.player;
    // staminaEl 的第二个子节点是 text span
    const textSpan = this.staminaEl.children[1];
    if (textSpan) textSpan.textContent = `${p.stamina}/${p.maxStamina}`;
  }

  /** 更新金币数值 */
  _updateGold() {
    if (!this.gs || !this.goldEl) return;
    const p = this.gs.player;
    const textSpan = this.goldEl.children[1];
    if (textSpan) textSpan.textContent = `${p.gold}`;
  }

  /** 订阅事件 */
  _subscribeEvents() {
    // STATE_RESET：全量重绘
    EventBus.on(GE.STATE_RESET, ({ gs }) => {
      this.gs = gs;
      this._renderAll();
    });

    // 增量更新
    EventBus.on(GE.STAMINA_CHANGE, () => this._updateStamina());
    EventBus.on(GE.GOLD_CHANGE, () => this._updateGold());
    EventBus.on(GE.STAT_CHANGE, () => this._renderAll());
    EventBus.on(GE.DAY_START, () => this._renderAll());
  }
}

export default TopBar;
