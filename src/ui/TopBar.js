// src/ui/TopBar.js
// 顶部状态栏：严格对齐 ui-main.png
//
// 布局（两个独立 div，分别绝对定位）：
//
//   第一行：左上 (top:15px left:15px)
//     3 个独立胶囊 pill —— ❤️ hp/maxHp  ·  ⚔️ atk  ·  ⚡ stamina/maxStamina
//     🪙 金币 / 第 X 天 这两个 Phase 4 独立 panel 才做，Phase 1 顶栏不显示
//
//   第二行：顶部居中 (top:15px left:50% transform:translateX(-50%))
//     1 个长条 pill —— 友善 current/cap · 危险 current/cap · 极其危险 current/cap
//     Phase 1 creatures 数组为空 → current 暂时全 0（Phase 3 接 creature 计数）
//     超载时对应项变红
//
// 重要约定：所有 emoji / 图标 不采用呼吸或浮动的 idle 动画效果（用户要求）

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { Assets } from '../core/Assets.js';
import { createEl, qs } from './dom.js';

const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Segoe UI Symbol", "Noto Color Emoji", sans-serif';

/** 单个独立胶囊 pill 样式（第一行用） */
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
    this.root = null;      // 顶栏整体容器（用来挂两个独立 div，本身相对 #app）
    this.row1 = null;      // 左上：3 个独立 pill
    this.row2 = null;      // 顶部居中：容量长条

    // 数值 DOM 引用（增量更新用）
    this.hpText = null;
    this.atkText = null;
    this.staminaText = null;
    this.friendlyText = null;
    this.dangerText = null;
    this.extremeText = null;

    this.gs = null;
  }

  /** 挂载顶部栏 */
  mount(gs, parent = qs('#app')) {
    this.gs = gs;

    // 顶栏整体容器（两个 row 都用 absolute 各自定位，容器本身只是 group）
    this.root = createEl('div', {
      class: ['top-bar'],
      style: {
        position: 'absolute',
        top: '0', left: '0', right: '0',
        height: '0', // 容器自身不占位
        pointerEvents: 'none',
        zIndex: 100,
      },
      parent,
    });

    // ── 第一行：左上，3 个独立 pill ──
    this.row1 = createEl('div', {
      class: ['top-row-left'],
      style: {
        position: 'absolute',
        top: '15px',
        left: '15px',
        display: 'flex',
        gap: '10px',
        pointerEvents: 'auto',
      },
      parent: this.root,
    });
    this._buildPill(this.row1, Assets.ui.hp,     'hp');
    this._buildPill(this.row1, Assets.ui.atk,    'atk');
    this._buildPill(this.row1, '⚡',             'stamina');

    // ── 第二行：顶部居中，容量长条 ──
    this.row2 = createEl('div', {
      class: ['top-row-center'],
      style: {
        position: 'absolute',
        top: '15px',
        left: '50%',
        transform: 'translateX(-50%)',
        pointerEvents: 'auto',
        ...pillStyle(),
        borderRadius: '15px',
        padding: '3px 12px',
        fontSize: '13px',
        background: 'rgba(255,255,255,0.7)',
        gap: '14px',
      },
      parent: this.root,
    });
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
   * 构建第一行独立 pill
   * @param {HTMLElement} parent
   * @param {string} emoji
   * @param {'hp'|'atk'|'stamina'} kind 数值种类（用于保存 text 引用）
   */
  _buildPill(parent, emoji, kind) {
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
      text: '',
      style: { fontSize: '14px', color: '#5a4a3a', lineHeight: '1' },
      parent: pill,
    });

    if (kind === 'hp')      this.hpText      = textSpan;
    else if (kind === 'atk')     this.atkText     = textSpan;
    else if (kind === 'stamina') this.staminaText = textSpan;

    return pill;
  }

  /** 全量渲染（所有数值） */
  _renderAll() {
    if (!this.gs) return;
    const p = this.gs.player;
    const c = this.gs.capacity;
    const creatures = this.gs.creatures || [];

    // current 计算：Phase 3 生物系统接入后替换为真实统计，Phase 1 暂时用 creatures 数组聚合
    const friendlyNow = creatures.filter(c => c.kind && c.kind.includes('chick')).length;
    const dangerNow   = creatures.filter(c => c.kind && c.kind.includes('slime')).length;
    const extremeNow  = 0; // Phase 3 启用

    if (this.hpText)      this.hpText.textContent      = `${p.hp}/${p.maxHp}`;
    if (this.atkText)     this.atkText.textContent     = `${p.atk}`;
    if (this.staminaText) this.staminaText.textContent = `${p.stamina}/${p.maxStamina}`;

    if (this.friendlyText) this.friendlyText.textContent = `友善 ${friendlyNow}/${c.friendly}`;
    if (this.dangerText)   this.dangerText.textContent   = `危险 ${dangerNow}/${c.danger}`;
    if (this.extremeText)  this.extremeText.textContent  = `极其危险 ${extremeNow}/${c.extreme}`;

    // 超载变红
    const applyOverload = (el, now, cap) => {
      if (!el) return;
      el.style.color = (now > cap) ? '#c0392b' : '#5a4a3a';
    };
    applyOverload(this.friendlyText, friendlyNow, c.friendly);
    applyOverload(this.dangerText,   dangerNow,   c.danger);
    applyOverload(this.extremeText,  extremeNow,  c.extreme);
  }

  /** 订阅事件 */
  _subscribeEvents() {
    EventBus.on(GE.STATE_RESET, ({ gs }) => {
      this.gs = gs;
      this._renderAll();
    });
    EventBus.on(GE.STAMINA_CHANGE,    () => this._renderAll());
    EventBus.on(GE.HP_CHANGE,         () => this._renderAll());
    EventBus.on(GE.ATK_CHANGE,        () => this._renderAll());
    EventBus.on(GE.STAT_CHANGE,       () => this._renderAll());
    EventBus.on(GE.DAY_START,         () => this._renderAll());
    EventBus.on(GE.CAPACITY_CHANGE,   () => this._renderAll());
    EventBus.on(GE.CREATURE_SPAWNED,  () => this._renderAll());
    EventBus.on(GE.CREATURE_DEFEATED, () => this._renderAll());
  }
}

export default TopBar;
