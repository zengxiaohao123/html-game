// src/ui/TopBar.js
// 顶部状态栏：严格对齐 ui-main.png 布局
//
// 两行结构：
//   第一行（top:15px left:15px）：4 个独立胶囊 pill
//     ❤️ hp/maxHp   ⚔️ atk   ⚡ stamina/maxStamina   🪙 gold
//   第二行（更紧凑的长条 pill，top: ~55px）：
//     友善 current/capacity  · 危险 current/capacity  · 极其危险 current/capacity
//
// 另外："第 X 天" 是独立米色小卡片，挂在金币下方（和顶栏不在一个 panel）
//
// Phase 1 简化：
//   - creatures 数组为空 → 友善 current = 0，危险 current = 0（Phase 3 补真实计数）
//   - 极其危险容量 Phase 3 才启用，暂时用 capacity.extremeOverdue 占位

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { Assets } from '../core/Assets.js';
import { createEl, qs } from './dom.js';

/** 给 span 加 emoji 字体 fallback，解决中文字体不渲染 emoji 的问题 */
const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Segoe UI Symbol", "Noto Color Emoji", sans-serif';

/** 单个 emoji pill 样式配置 */
function pillStyle() {
  return {
    background: 'rgba(255,255,255,0.85)',
    border: '2px solid #3a3a3a',
    borderRadius: '20px',
    padding: '4px 14px',
    fontSize: '15px',
    fontWeight: '700',
    color: '#5a4a3a',
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
    fontFamily: '"LXGW WenKai TC", sans-serif',
  };
}

export class TopBar {
  constructor() {
    this.root = null;           // 顶栏整体容器（两行）
    this.row1 = null;           // 第一行：4 个 pill
    this.row2 = null;           // 第二行：容量长条
    this.dayCard = null;        // 独立天数小卡片（金币下方）

    // 可变数值 DOM 引用（用于增量更新）
    this.hpText = null;
    this.atkText = null;
    this.staminaText = null;
    this.goldText = null;
    this.dayText = null;
    this.friendlyText = null;
    this.dangerText = null;
    this.extremeText = null;

    this.gs = null;
  }

  /** 挂载顶部栏 */
  mount(gs, parent = qs('#app')) {
    this.gs = gs;

    // 顶栏整体容器（两行纵向排列）
    this.root = createEl('div', {
      class: ['top-bar'],
      style: {
        position: 'absolute',
        top: '15px',
        left: '15px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        zIndex: 100,
      },
      parent,
    });

    // ── 第一行：4 个独立 pill ──
    this.row1 = createEl('div', {
      style: {
        display: 'flex',
        gap: '10px',
      },
      parent: this.root,
    });

    this._buildPill(this.row1, Assets.ui.hp, () => {
      const p = this.gs.player;
      return `❤ ${p.hp}/${p.maxHp}`;   // ❤ emoji 用原生心脏颜色更显眼
    });
    this._buildPill(this.row1, Assets.ui.atk, () => `${this.gs.player.atk}`);
    this._buildPill(this.row1, '⚡', () => {
      // stamina 图标用闪电⚡（ui-main.png 原设计），Phase 1 才统一用 Assets.ui.stamina
      const p = this.gs.player;
      return `⚡ ${p.stamina}/${p.maxStamina}`;
    });
    this._buildPill(this.row1, Assets.ui.gold, () => {
      this.goldText.textContent = `${this.gs.player.gold}`;
      return null; // 手动更新
    }, { updateMode: 'manual' });

    // ── 第二行：容量长条 pill ──
    this.row2 = createEl('div', {
      class: ['capacity-bar'],
      style: {
        ...pillStyle(),
        borderRadius: '15px',
        padding: '3px 12px',
        fontSize: '13px',
        background: 'rgba(255,255,255,0.7)',
        gap: '12px',
      },
      parent: this.root,
    });
    // 友善 危险 极其危险 三个小项
    this.friendlyText = createEl('span', { text: '', parent: this.row2 });
    this.dangerText   = createEl('span', { text: '', parent: this.row2 });
    this.extremeText  = createEl('span', { text: '', parent: this.row2 });

    // 初始渲染
    this._renderAll();

    // 订阅事件
    this._subscribeEvents();

    return this.root;
  }

  /**
   * 构建单个 pill
   * @param {HTMLElement} parent
   * @param {string} emoji
   * @param {Function} textGetter 返回 textContent；返回 null 表示用 updateMode='manual'
   * @param {object} [opts] { updateMode: 'manual' } 手动模式下 text 节点由外部保存引用
   */
  _buildPill(parent, emoji, textGetter, opts = {}) {
    const pill = createEl('div', {
      class: ['ui-pill'],
      style: pillStyle(),
      parent,
    });
    createEl('span', {
      text: emoji,
      style: { fontSize: '18px', lineHeight: '1', fontFamily: EMOJI_FONT, display: 'inline-block' },
      parent: pill,
    });
    const textSpan = createEl('span', {
      text: opts.updateMode === 'manual' ? '' : (textGetter() ?? ''),
      style: { fontSize: '14px', color: '#5a4a3a', lineHeight: '1' },
      parent: pill,
    });

    // 根据 emoji 种类保存对应引用
    if (emoji === Assets.ui.hp) this.hpText = textSpan;
    else if (emoji === Assets.ui.atk) this.atkText = textSpan;
    else if (emoji === '⚡') this.staminaText = textSpan;
    else if (emoji === Assets.ui.gold) this.goldText = textSpan;

    return pill;
  }

  /** 全量渲染（所有数值） */
  _renderAll() {
    if (!this.gs) return;
    const p = this.gs.player;
    const c = this.gs.capacity;
    const creatures = this.gs.creatures || [];
    // current 计算：Phase 3 生物系统接入后会替换为真实计数，此处暂时用 creatures 数组聚合
    const friendlyNow = creatures.filter(c => c.kind && c.kind.includes('chick')).length;
    const dangerNow   = creatures.filter(c => c.kind && c.kind.includes('slime')).length;
    // 极其危险 Phase 3 启用，先写 0/0 占位
    const extremeNow  = 0;

    if (this.hpText)      this.hpText.textContent      = `${p.hp}/${p.maxHp}`;
    if (this.atkText)     this.atkText.textContent     = `${p.atk}`;
    if (this.staminaText) this.staminaText.textContent = `${p.stamina}/${p.maxStamina}`;
    if (this.goldText)    this.goldText.textContent    = `${p.gold}`;

    if (this.friendlyText) this.friendlyText.textContent = `友善 ${friendlyNow}/${c.friendly}`;
    if (this.dangerText)   this.dangerText.textContent   = `危险 ${dangerNow}/${c.danger}`;
    if (this.extremeText)  this.extremeText.textContent  = `极其危险 ${extremeNow}/${c.extreme}`;

    // 超载样式：超载时变红闪烁
    const applyOverloadStyle = (el, now, cap) => {
      if (!el) return;
      if (now > cap) {
        el.style.color = '#c0392b';
        el.style.textDecoration = 'blink';
      } else {
        el.style.color = '#5a4a3a';
      }
    };
    applyOverloadStyle(this.friendlyText, friendlyNow, c.friendly);
    applyOverloadStyle(this.dangerText,   dangerNow,   c.danger);
    applyOverloadStyle(this.extremeText,  extremeNow,  c.extreme);
  }

  /** 订阅事件 */
  _subscribeEvents() {
    EventBus.on(GE.STATE_RESET, ({ gs }) => {
      this.gs = gs;
      this._renderAll();
    });
    EventBus.on(GE.STAMINA_CHANGE, () => this._renderAll());
    EventBus.on(GE.GOLD_CHANGE,    () => this._renderAll());
    EventBus.on(GE.HP_CHANGE,      () => this._renderAll());
    EventBus.on(GE.STAT_CHANGE,    () => this._renderAll());
    EventBus.on(GE.DAY_START,      () => this._renderAll());
    EventBus.on(GE.CAPACITY_CHANGE,() => this._renderAll());
    EventBus.on(GE.CREATURE_SPAWNED,  () => this._renderAll());
    EventBus.on(GE.CREATURE_DEFEATED, () => this._renderAll());
  }
}

export default TopBar;
