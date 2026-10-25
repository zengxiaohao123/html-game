// TaskPanel.js —— Phase 4 新增  ·  快捷键 J
// ⚠️ 严格 2 tab：日常任务 / 核心任务（没有成就 tab！用户明令禁止）
// Phase 4 只给 UI 框架占位，任务列表内容 Phase 5 按设计文档接
// 外观严格套 InventoryPanel 模板（_panelHelper）

import { EventBus } from '../../core/EventBus.js';
import { GE } from '../../core/GameEvents.js';
import { createStandardPanel } from './_panelHelper.js';
import { createEl, qs } from '../dom.js';

export class TaskPanel {
  constructor(director) {
    this.director = director;
    this.helper = null;
    this.tabsRow = null;
    this.bodyEl = null;
    this.activeTab = 'daily';  // 'daily' | 'core' （没有 achievement！）
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
    // ⚠️ 严格 2 tab：日常任务 / 核心任务（没有成就 tab）
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

    this._refresh();
  }

  _subscribe() {
    EventBus.on(GE.UI_PANEL_OPEN, ({ panel }) => { if (panel === 'task') this.toggle(); });
    EventBus.on(GE.UI_PANEL_CLOSE, ({ panel }) => { if (panel === 'task' && this.helper?.visible) this.helper.hide(); });
    EventBus.on(GE.TASK_OPEN, () => { if (this.helper?.visible) this._refresh(); });
    EventBus.on(GE.TASK_COMPLETE, () => { if (this.helper?.visible) this._refresh(); });
  }

  _refresh() {
    this.bodyEl.innerHTML = '';

    // 空状态占位（Phase 4 任务列表 Phase 5 补设计文档再接）
    createEl('div', {
      style: {
        flex: '1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        color: '#8a7a66', fontSize: '15px', textAlign: 'center', gap: '12px', fontStyle: 'italic',
      },
      parent: this.bodyEl,
    }).innerHTML = `
      <div style="font-size:48px">📋</div>
      <div>暂无任务，敬请期待 Phase 5</div>
      <div style="font-size:12px;color:#aaa">(任务列表内容将按设计文档 §15 补全)</div>
    `;

    // 占位：让玩家能看到 tab 工作
    createEl('div', {
      style: { marginTop: 'auto', padding: '8px 10px', background: 'rgba(255,255,255,0.8)', borderLeft: '3px solid #b8a888', borderRadius: '4px', fontSize: '12px', color: '#7a6a56' },
      text: `当前 tab：${this.activeTab === 'daily' ? '日常任务 🌞' : '核心任务 🏆'}（Phase 5 补全）`,
      parent: this.bodyEl,
    });
  }

  show() { this.helper?.show(); }
  hide() { this.helper?.hide(); }
  toggle() { this.helper?.toggle(); }
}

export default TaskPanel;
