// src/ui/TopBar.js
// 顶部状态栏（v5 —— 第 8 批提质感：单块奶油底板 + 统一胶囊层级，对照设计文档 §16.7）
//
// 布局（左上角一整块 HUD 底板，内部三行流式排版，不再用魔法数字绝对定位）：
//   ┌────────────────────────────────────────┐
//   │ ❤ 12/20   ⚔ 8   ⚡ 5/10                │  row1 角色三维（小胶囊）
//   │ ● 友善 1/4   ● 危险 0/2   ● 极度 0/1   │  row2 容量（彩点+标签+数值，超载红闪）
//   │ 📅 第 3 天 5月12日 周一   🪙 128        │  row3 日历 + 金币（金色重点胶囊）
//   └────────────────────────────────────────┘
//   [📋]  任务入口（底板下方独立方钮，§16.17）
//
// 质感手法（不引入美术素材）：统一高度/圆角/描边语言、tabular-nums 数字对齐、
//   层级靠字重与色彩（标签弱、数值强）、底板半透明奶油 + 细描边 + 轻投影。
// z-index 5600：高于商店遮罩（5500），保证 §16.21「商店内顶部 UI 仍可见、可点」。
//
// 重要约定：所有 emoji / 图标 不采用呼吸或浮动的 idle 动画效果（用户要求）

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { Assets } from '../core/Assets.js';
import { createEl, qs, iconEl } from './dom.js';

/** 统一小胶囊（row1 / row2 / 日历）：等高、圆角、细描边 */
function chipStyle() {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    height: '26px',
    padding: '0 10px',
    borderRadius: '999px',
    background: 'rgba(255,255,255,0.8)',
    border: '1.5px solid #b8a888',
    fontSize: '13px',
    fontWeight: '800',
    color: '#4a3a2a',
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  };
}

/** 容量彩点 */
function dot(color) {
  return {
    width: '8px', height: '8px', borderRadius: '50%',
    background: color, flexShrink: '0',
    boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.25)',
  };
}

export class TopBar {
  constructor() {
    this.root = null;
    this.taskIconEl = null;   // 任务区独立图标（不在 FuncBar，按 §16.17）

    this.hpText = null;
    this.atkText = null;
    this.staminaText = null;
    this.friendlyText = null;
    this.dangerText = null;
    this.extremeText = null;
    this.dayText = null;
    this.calText = null;
    this.goldText = null;

    this.gs = null;
  }

  mount(gs, parent = qs('#app')) {
    this.gs = gs;

    this.root = createEl('div', {
      class: ['top-bar'],
      style: {
        position: 'absolute', top: '12px', left: '12px',
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px',
        pointerEvents: 'none', zIndex: 5600,
        fontFamily: '"LXGW WenKai TC", "Microsoft YaHei", sans-serif',
      },
      parent,
    });

    // ── HUD 底板：一块奶油半透明圆角板收纳三行信息 ──
    const plate = createEl('div', {
      class: ['top-bar-plate'],
      style: {
        pointerEvents: 'auto',
        display: 'flex', flexDirection: 'column', gap: '6px',
        padding: '8px 10px',
        background: 'rgba(255,251,240,0.9)',
        border: '2px solid #3a3a3a',
        borderRadius: '14px',
        boxShadow: '0 3px 10px rgba(0,0,0,0.22)',
      },
      parent: this.root,
    });

    // row1 —— 角色三维：图标 + 数值
    const row1 = createEl('div', { style: { display: 'flex', gap: '6px' }, parent: plate });
    this._buildChip(row1, Assets.ui.hp, 'hp');
    this._buildChip(row1, Assets.ui.atk, 'atk');
    this._buildChip(row1, '⚡', 'stamina');

    // row2 —— 容量条目（彩点 + 标签 + 数值；超载数值红字缓慢闪烁 §16.7）
    const row2 = createEl('div', { style: { display: 'flex', gap: '6px' }, parent: plate });
    this.friendlyText = this._buildCapChip(row2, '#4fae3f', '友善');
    this.dangerText   = this._buildCapChip(row2, '#e67e22', '危险');
    this.extremeText  = this._buildCapChip(row2, '#c0392b', '极度');

    // row3 —— 日历胶囊 + 金币重点胶囊
    const row3 = createEl('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' }, parent: plate });
    const dayChip = createEl('div', { style: chipStyle(), parent: row3 });
    dayChip.appendChild(iconEl('ui', 'day', { size: '15px', fallback: '📅' }));
    this.dayText = createEl('span', { style: { fontSize: '13px', fontWeight: '800' }, text: '', parent: dayChip });
    // v0.5 §16.7：日历精确到「某年某月某日 星期X」，由 CalendarSystem 提供
    this.calText = createEl('span', {
      style: { fontSize: '11px', fontWeight: '700', color: '#8a7a63' },
      text: '', parent: dayChip,
    });

    // 金币胶囊：§16.7 重点美化 —— 金色渐变 + 内高光 + 大号数字
    const goldChip = createEl('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: '6px',
        height: '30px', padding: '0 12px',
        borderRadius: '999px',
        background: 'linear-gradient(135deg, #fff8d0 0%, #ffe070 40%, #e8a520 100%)',
        border: '2px solid #a06010',
        boxShadow: '0 2px 6px rgba(120,70,10,0.35), inset 0 1px 0 rgba(255,255,255,0.55)',
        fontVariantNumeric: 'tabular-nums',
      },
      parent: row3,
    });
    goldChip.appendChild(iconEl('ui', 'gold', { size: '17px', fallback: Assets.ui.gold }));
    this.goldText = createEl('span', {
      style: { fontWeight: '900', fontSize: '16px', color: '#704010' },
      text: '', parent: goldChip,
    });

    // 任务区独立图标（§16.17：顶部左侧 UI 下方、屏幕左侧）
    this.taskIconEl = createEl('div', {
      class: ['task-entry'],
      style: {
        pointerEvents: 'auto',
        width: '42px', height: '42px',
        background: 'rgba(255,251,240,0.9)',
        border: '2px solid #3a3a3a',
        borderRadius: '12px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '24px', lineHeight: '1',
        boxShadow: '0 3px 10px rgba(0,0,0,0.22)',
        cursor: 'pointer',
      },
      parent: this.root,
    });
    this.taskIconEl.appendChild(iconEl('ui', 'task', { size: '24px', fallback: '📋' }));
    this.taskIconEl.title = '任务（J 切换）';
    this.taskIconEl.addEventListener('click', () => {
      EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'task' });
      EventBus.emit(GE.TASK_OPEN, {});
    });

    this._renderAll();
    this._subscribeEvents();
    return this.root;
  }

  /** row1 小胶囊：图标 + 数值 */
  _buildChip(parent, emoji, kind) {
    const chip = createEl('div', { class: ['ui-pill'], style: chipStyle(), parent });
    chip.appendChild(iconEl('ui', kind, { size: '15px', fallback: emoji }));
    const textSpan = createEl('span', { text: '', style: { lineHeight: '1' }, parent: chip });
    if (kind === 'hp')      this.hpText = textSpan;
    else if (kind === 'atk')     this.atkText = textSpan;
    else if (kind === 'stamina') this.staminaText = textSpan;
    return chip;
  }

  /** row2 容量胶囊：彩点 + 弱标签 + 强数值（数值 span 承担超载红闪） */
  _buildCapChip(parent, color, label) {
    const chip = createEl('div', { style: chipStyle(), parent });
    createEl('span', { style: dot(color), parent: chip });
    createEl('span', {
      text: label,
      style: { fontSize: '11px', fontWeight: '700', color: '#8a7a63' },
      parent: chip,
    });
    return createEl('span', { text: '', style: { lineHeight: '1' }, parent: chip });
  }

  _renderAll() {
    if (!this.gs) return;
    const p = this.gs.player;
    const c = this.gs.capacity;
    const creatures = this.gs.creatures || [];

    const friendlyNow = creatures.filter(c => c.kind && c.kind.includes('chick')).length;
    const dangerNow   = creatures.filter(c => c.kind && c.kind.includes('slime')).length;
    const extremeNow  = 0;

    if (this.hpText)      this.hpText.textContent      = `${p.hp}/${p.maxHp}`;
    if (this.atkText)     this.atkText.textContent     = `${Math.floor(p.atk)}`;
    if (this.staminaText) this.staminaText.textContent = `${p.stamina}/${p.maxStamina}`;
    if (this.friendlyText) this.friendlyText.textContent = `${friendlyNow}/${c.friendly}`;
    if (this.dangerText)   this.dangerText.textContent   = `${dangerNow}/${c.danger}`;
    if (this.extremeText)  this.extremeText.textContent  = `${extremeNow}/${c.extreme}`;

    applyOverload(this.friendlyText, friendlyNow, c.friendly);
    applyOverload(this.dangerText,   dangerNow,   c.danger);
    applyOverload(this.extremeText,  extremeNow,  c.extreme);

    if (this.dayText)  this.dayText.textContent  = `第 ${this.gs.day} 天`;
    if (this.calText) {
      this.calText.textContent = this.gs.calendar
        ? `${this.gs.calendar.month}月${this.gs.calendar.dayOfMonth}日 周${'一二三四五六日'[this.gs.calendar.weekday - 1] || ''}`
        : '';
      this.calText.title = this.gs.calendar
        ? `${this.gs.calendar.year} 年 ${this.gs.calendar.month} 月 ${this.gs.calendar.dayOfMonth} 日`
        : '';
    }
    if (this.goldText) this.goldText.textContent = `${p.gold}`;
  }

  _subscribeEvents() {
    // BOOT（新游戏启动 / startNewGame）和 STATE_RESET（读档/手动重置）都要更新 this.gs 引用
    // GameDirector.start() 会同时 emit BOOT + STATE_RESET，这里双保险
    EventBus.on(GE.BOOT,        ({ gs }) => { this.gs = gs; this._renderAll(); });
    EventBus.on(GE.STATE_RESET, ({ gs }) => { this.gs = gs; this._renderAll(); });
    EventBus.on(GE.STAMINA_CHANGE,    () => this._renderAll());
    EventBus.on(GE.HP_CHANGE,         () => this._renderAll());
    EventBus.on(GE.ATK_CHANGE,        () => this._renderAll());
    EventBus.on(GE.STAT_CHANGE,       () => this._renderAll());
    EventBus.on(GE.DAY_START,         () => this._renderAll());
    EventBus.on(GE.CAPACITY_CHANGE,   () => this._renderAll());
    EventBus.on(GE.CREATURE_SPAWNED,  () => this._renderAll());
    EventBus.on(GE.CREATURE_DEFEATED, () => this._renderAll());
    EventBus.on(GE.GOLD_CHANGE,       () => this._renderAll());
    EventBus.on(GE.TURN_ADVANCE,      () => this._renderAll());
  }
}

function applyOverload(el, now, cap) {
  if (!el) return;
  const over = now > cap;
  el.style.color = over ? '#c0392b' : '#4a3a2a';
  // §16.7 超载时变红缓慢闪烁（class 定义在 ui.css）
  el.classList.toggle('overload-blink', over);
}

export default TopBar;
