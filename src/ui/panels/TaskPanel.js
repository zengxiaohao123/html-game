// TaskPanel.js —— Phase 4 新增（内容补全版）  ·  快捷键 J
// ⚠️ 严格 2 tab：日常任务 / 核心任务（没有成就 tab！用户明令禁止）
// 设计文档 §11 "核心任务列表" 标注"待补充"——核心任务 tab 保持占位。
// 日常任务：从设计文档抽取"每日必须做"的 4 条，实时追踪。

import { EventBus } from '../../core/EventBus.js';
import { GE } from '../../core/GameEvents.js';
import { createStandardPanel } from './_panelHelper.js';
import { createEl, qs } from '../dom.js';

/** 4 条日常任务（从设计文档 §6/§7/§8 抽取，每日重置） */
const DAILY_TASKS = [
  { id: 'place-3',   emoji: '🛠️', title: '今日建造 3 个地块', desc: '把背包里的设施放到地图外圈地块上',   target: 3,   counterField: 'dailyPlaces' },
  { id: 'bless-1',   emoji: '🙏', title: '今日祈福 1 次',     desc: '在信息区 Tab3 请 momo 帮忙',           target: 1,   counterField: 'dailyBlesses' },
  { id: 'move-10',   emoji: '🚶', title: '今日移动 10 步',    desc: '按 WASD 在外圈地块上移动',              target: 10,  counterField: 'dailyMoves' },
  { id: 'earn-100',  emoji: '💰', title: '今日赚取 100 金币', desc: '经过家/帐篷/出售设施等触发金币产出',    target: 100, counterField: 'dailyGoldEarned' },
];

export class TaskPanel {
  constructor(director) {
    this.director = director;
    this.helper = null;
    this.tabsRow = null;
    this.bodyEl = null;
    this.activeTab = 'daily';  // 'daily' | 'core'
  }

  mount() {
    this.helper = createStandardPanel({
      title: '📋 任务（J 切换）',
      panelKey: 'task',
      width: 'min(92vw, 720px)',
      height: 'min(86vh, 640px)',
      onMount: (_p, body) => this._build(body),
    });
    this._subscribe();
  }

  _build(body) {
    // ⚠️ 严格 2 tab：日常任务 / 核心任务
    this.tabsRow = createEl('div', { style: { display: 'flex', gap: '6px' }, parent: body });
    ['daily', 'core'].forEach((k) => {
      const label = k === 'daily' ? '🌞 日常任务' : '🏆 核心任务';
      createEl('button', {
        class: ['action-btn'],
        style: {
          background: this.activeTab === k ? '#ffe099' : 'rgba(255,255,255,0.7)',
          border: this.activeTab === k ? '3px solid #e8a900' : '2px solid #b8a888',
          fontWeight: this.activeTab === k ? '800' : '600',
        },
        text: label, parent: this.tabsRow,
        onclick: () => { this.activeTab = k; this._refresh(); },
      });
    });

    this.bodyEl = createEl('div', {
      style: {
        flex: '1', minHeight: '0',
        padding: '14px', background: 'rgba(255,255,255,0.55)', border: '2px solid #b8a888', borderRadius: '12px',
        overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px',
      },
      parent: body,
    });

    const foot = createEl('div', {
      style: { display: 'flex', gap: '8px', justifyContent: 'flex-end', borderTop: '2px dashed #b8a888', paddingTop: '8px' },
      parent: body,
    });
    createEl('button', { class: 'action-btn', text: '关闭', parent: foot, onclick: () => this.hide() });
    createEl('button', {
      class: 'action-btn', text: '🔄 刷新', parent: foot,
      onclick: () => { EventBus.emit(GE.TASK_OPEN, {}); EventBus.emit(GE.TOAST_SHOW, { text: '📋 任务列表刷新', duration: 1200 }); },
    });

    this._ensureDailyStats();
    this._refresh();
  }

  /** 确保 gs.uiState.taskDailyStats 存在（挂在现有 uiState 上，不改 state 文件） */
  _ensureDailyStats() {
    const gs = this.director?.getGS?.();
    if (!gs) return;
    if (!gs.uiState) gs.uiState = {};
    if (!gs.uiState.taskDailyStats) {
      gs.uiState.taskDailyStats = {
        day: gs.day || 1,
        dailyPlaces: 0,
        dailyBlesses: 0,
        dailyMoves: 0,
        dailyGoldEarned: 0,
      };
    } else if (gs.uiState.taskDailyStats.day !== gs.day) {
      // 过了一天，自动重置
      gs.uiState.taskDailyStats.day = gs.day;
      gs.uiState.taskDailyStats.dailyPlaces = 0;
      gs.uiState.taskDailyStats.dailyBlesses = 0;
      gs.uiState.taskDailyStats.dailyMoves = 0;
      gs.uiState.taskDailyStats.dailyGoldEarned = 0;
    }
  }

  _subscribe() {
    EventBus.on(GE.UI_PANEL_OPEN, ({ panel }) => { if (panel === 'task') { this.toggle(); this._refresh(); } });
    EventBus.on(GE.UI_PANEL_CLOSE, ({ panel }) => { if (panel === 'task' && this.helper?.visible) this.helper.hide(); });
    EventBus.on(GE.TASK_OPEN, () => { if (this.helper?.visible) this._refresh(); });
    EventBus.on(GE.TASK_COMPLETE, () => { if (this.helper?.visible) this._refresh(); });

    // 计数器监听（只用已有事件）
    EventBus.on(GE.MOVE, () => { this._inc('dailyMoves'); });
    EventBus.on(GE.BLESS_START, () => { this._inc('dailyBlesses'); });
    EventBus.on(GE.GOLD_CHANGE, ({ delta }) => {
      if (typeof delta === 'number' && delta > 0) this._inc('dailyGoldEarned', delta);
    });
    // 建造：TILE_UPDATED + tile.contentId 变化（null → 非 null）
    EventBus.on(GE.TILE_UPDATED, ({ tileIdx }) => {
      const gs = this.director?.getGS?.();
      if (!gs) return;
      const t = gs.map.outerTiles[tileIdx];
      if (!t) return;
      // 简化：只要 contentId 是 facility_/resource_/skill_ 就算一次（避免对比 oldContentId）
      if (/^(facility_|resource_|skill_)/.test(t.contentId || '')) this._inc('dailyPlaces');
    });

    // 每日重置
    EventBus.on(GE.DAY_START, () => {
      this._ensureDailyStats();
      this._refresh();
    });
  }

  _inc(field, delta = 1) {
    this._ensureDailyStats();
    const gs = this.director?.getGS?.();
    if (!gs?.uiState?.taskDailyStats) return;
    gs.uiState.taskDailyStats[field] = (gs.uiState.taskDailyStats[field] || 0) + delta;
    if (this.helper?.visible) this._refresh();
  }

  _refresh() {
    if (!this.bodyEl) return;
    this.bodyEl.innerHTML = '';

    if (this.activeTab === 'daily') this._renderDaily();
    else this._renderCore();
  }

  _renderDaily() {
    this._ensureDailyStats();
    const stats = this.director?.getGS?.()?.uiState?.taskDailyStats || {};

    for (const task of DAILY_TASKS) {
      const cur = stats[task.counterField] || 0;
      const target = task.target;
      const done = cur >= target;
      const pct = Math.min(100, Math.round(cur / target * 100));

      const card = createEl('div', {
        style: {
          padding: '10px 12px', background: done ? 'rgba(200,240,200,0.7)' : 'rgba(255,255,255,0.85)',
          border: `2px solid ${done ? '#5fa05f' : '#b8a888'}`, borderRadius: '10px',
          display: 'flex', alignItems: 'center', gap: '10px',
        },
        parent: this.bodyEl,
      });

      createEl('div', { style: { fontSize: '28px', lineHeight: '1', flexShrink: '0' }, text: done ? '✅' : task.emoji, parent: card });

      const mid = createEl('div', { style: { flex: '1', minWidth: '0' }, parent: card });
      createEl('div', { style: { fontSize: '15px', fontWeight: '700', color: '#3a2e20' }, text: task.title, parent: mid });
      createEl('div', { style: { fontSize: '12px', color: '#6a5a46', marginTop: '2px' }, text: task.desc, parent: mid });

      // 进度条
      const barBox = createEl('div', {
        style: { marginTop: '6px', height: '8px', background: 'rgba(100,80,60,0.15)', borderRadius: '4px', overflow: 'hidden' },
        parent: mid,
      });
      createEl('div', {
        style: { width: `${pct}%`, height: '100%', background: done ? '#5fa05f' : '#e8a900', transition: 'width 0.3s' },
        parent: barBox,
      });

      createEl('div', {
        style: { fontSize: '13px', fontWeight: '700', color: done ? '#4a8a4a' : '#8a5a10', flexShrink: '0' },
        text: `${cur}/${target}`,
        parent: card,
      });
    }
  }

  _renderCore() {
    // 核心任务文档标注"待补充"——占位
    createEl('div', {
      style: {
        flex: '1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        color: '#8a7a66', fontSize: '15px', textAlign: 'center', gap: '12px', fontStyle: 'italic',
      },
      parent: this.bodyEl,
    }).innerHTML = `
      <div style="font-size:48px">🏆</div>
      <div>核心任务列表 Phase 5 按设计文档 §11 补全</div>
      <div style="font-size:12px;color:#aaa">当前游戏流程：移动 → 踩格 → 产出 → 积累金币/设施</div>
    `;
  }

  show() { this.helper?.show(); }
  hide() { this.helper?.hide(); }
  toggle() { this.helper?.toggle(); }
}

export default TaskPanel;
