// src/ui/TopBar.js
// 顶部状态栏（v3 —— 按 ui-main.png 完整布局，对照设计文档 §15.2）
//
// 布局（全部 absolute 定位，容器本身不占位）：
//
//   row1 左上 (top:15px left:15px)  ❤️ hp/maxHp  ·  ⚔️ atk  ·  ⚡ stamina/maxStamina
//   row2 顶部居中 (top:15px left:50% translateX(-50%))  友善 current/cap · 危险 · 极度危险 【放大版】
//   row3 左上 (top:58px left:15px)  📅 第 N 天  ·  🪙 金币（金色 pill，单独突出）
//   任务区：TopBar 下方、屏幕左侧（FuncBar 已经有📋图标，见 §15.17）
//
// 重要约定：所有 emoji / 图标 不采用呼吸或浮动的 idle 动画效果（用户要求）

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { Assets } from '../core/Assets.js';
import { createEl, qs } from './dom.js';

const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Segoe UI Symbol", "Noto Color Emoji", sans-serif';

/** 普通独立胶囊 pill 样式 */
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

/** 金币 pill —— 按 ui-main.png 左侧单独一行特殊样式（金色突出） */
function goldPillStyle() {
  return {
    position: 'relative',
    background: 'linear-gradient(135deg, #fff8d0 0%, #ffe070 40%, #e8a520 100%)',
    border: '3px solid #a06010',
    borderRadius: '14px',
    padding: '8px 16px 8px 14px',
    boxShadow: '0 3px 8px rgba(120, 70, 10, 0.35), inset 0 1px 0 rgba(255,255,255,0.5)',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontFamily: '"LXGW WenKai TC", sans-serif',
  };
}

export class TopBar {
  constructor() {
    this.root = null;
    this.row1 = null;
    this.row2 = null;
    this.row3 = null;
    this.taskIconEl = null;   // 新增：任务区独立图标（不在 FuncBar，按 §15.17）

    this.hpText = null;
    this.atkText = null;
    this.staminaText = null;
    this.friendlyText = null;
    this.dangerText = null;
    this.extremeText = null;
    this.dayText = null;
    this.goldText = null;

    this.gs = null;
  }

  mount(gs, parent = qs('#app')) {
    this.gs = gs;

    this.root = createEl('div', {
      class: ['top-bar'],
      style: {
        position: 'absolute', top: '0', left: '0', right: '0', height: '0',
        pointerEvents: 'none', zIndex: 100,
      },
      parent,
    });

    // row1 —— 左上 3 pill
    this.row1 = createEl('div', {
      style: {
        position: 'absolute', top: '15px', left: '15px',
        display: 'flex', gap: '10px', pointerEvents: 'auto',
      },
      parent: this.root,
    });
    this._buildPill(this.row1, Assets.ui.hp, 'hp');
    this._buildPill(this.row1, Assets.ui.atk, 'atk');
    this._buildPill(this.row1, '⚡',        'stamina');

    // row2 —— 顶部居中容量长条（放大版，对照 ui-main.png）
    this.row2 = createEl('div', {
      style: {
        position: 'absolute', top: '15px', left: '50%',
        transform: 'translateX(-50%)',
        pointerEvents: 'auto',
        ...pillStyle(), borderRadius: '20px', padding: '6px 18px',
        fontSize: '18px', background: 'rgba(255,255,255,0.75)', gap: '18px',
      },
      parent: this.root,
    });
    this.friendlyText = createEl('span', { style: { fontSize: '16px' }, text: '', parent: this.row2 });
    this.dangerText   = createEl('span', { style: { fontSize: '16px' }, text: '', parent: this.row2 });
    this.extremeText  = createEl('span', { style: { fontSize: '16px' }, text: '', parent: this.row2 });

    // row3 —— 左上 天数（一行） + 金币（一行）—— 竖排，对照 ui-main.png 左侧
    this.row3 = createEl('div', {
      style: {
        position: 'absolute', top: '72px', left: '15px',
        display: 'flex', flexDirection: 'column', gap: '10px', pointerEvents: 'auto',
      },
      parent: this.root,
    });

    // 天数 pill（单独一行）
    const dayPill = createEl('div', { style: pillStyle(), parent: this.row3 });
    createEl('span', {
      text: '📅',
      style: { fontSize: '18px', lineHeight: '1', fontFamily: EMOJI_FONT },
      parent: dayPill,
    });
    this.dayText = createEl('span', { style: { fontSize: '15px', fontWeight: '800', color: '#5a4a3a' }, text: '', parent: dayPill });

    // 金币 pill（单独一行，按 ui-main.png 金色特殊样式）
    const goldPill = createEl('div', { style: goldPillStyle(), parent: this.row3 });
    createEl('span', {
      text: '🪙',
      style: { fontSize: '22px', lineHeight: '1', fontFamily: EMOJI_FONT },
      parent: goldPill,
    });
    createEl('span', {
      text: '$',
      style: { fontSize: '16px', fontWeight: '700', color: '#8a5a10' },
      parent: goldPill,
    });
    this.goldText = createEl('span', {
      style: { fontWeight: '900', fontSize: '20px', color: '#704010' },
      text: '', parent: goldPill,
    });

    // 新增：任务区独立图标（按 §15.17，在金币下方、精灵上方，独立于 FuncBar）
    this.taskIconEl = createEl('div', {
      class: ['task-entry'],
      style: {
        position: 'absolute', top: '168px', left: '15px',
        width: '42px', height: '42px',
        pointerEvents: 'auto',
        background: 'rgba(255,255,255,0.85)',
        border: '3px solid #3a3a3a',
        borderRadius: '12px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '24px', lineHeight: '1',
        boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
        cursor: 'pointer',
        zIndex: 101,
        fontFamily: EMOJI_FONT,
      },
      parent: this.root,
    });
    this.taskIconEl.textContent = '📋';
    this.taskIconEl.title = '任务（J 切换）';
    this.taskIconEl.addEventListener('click', () => {
      EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'task' });
      EventBus.emit(GE.TASK_OPEN, {});
    });

    this._renderAll();
    this._subscribeEvents();
    return this.root;
  }

  _buildPill(parent, emoji, kind) {
    const pill = createEl('div', { class: ['ui-pill'], style: pillStyle(), parent });
    createEl('span', {
      text: emoji,
      style: { fontSize: '18px', lineHeight: '1', fontFamily: EMOJI_FONT, display: 'inline-block' },
      parent: pill,
    });
    const textSpan = createEl('span', { text: '', style: { fontSize: '14px', color: '#5a4a3a', lineHeight: '1' }, parent: pill });
    if (kind === 'hp')      this.hpText = textSpan;
    else if (kind === 'atk')     this.atkText = textSpan;
    else if (kind === 'stamina') this.staminaText = textSpan;
    return pill;
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
    if (this.friendlyText) this.friendlyText.textContent = `友善 ${friendlyNow}/${c.friendly}`;
    if (this.dangerText)   this.dangerText.textContent   = `危险 ${dangerNow}/${c.danger}`;
    if (this.extremeText)  this.extremeText.textContent  = `极度危险 ${extremeNow}/${c.extreme}`;

    applyOverload(this.friendlyText, friendlyNow, c.friendly);
    applyOverload(this.dangerText,   dangerNow,   c.danger);
    applyOverload(this.extremeText,  extremeNow,  c.extreme);

    // Phase 4 —— 左下 row3
    if (this.dayText)  this.dayText.textContent  = `第 ${this.gs.day} 天`;
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
    EventBus.on(GE.GOLD_CHANGE,       () => { this._renderAll(); });   // Phase 4
    EventBus.on(GE.TURN_ADVANCE,      () => this._renderAll());   // Phase 4
  }
}

function applyOverload(el, now, cap) {
  if (!el) return;
  el.style.color = (now > cap) ? '#c0392b' : '#5a4a3a';
}

export default TopBar;
