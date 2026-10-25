// src/ui/FuncBar.js
// 底部功能栏（Phase 4 完整版：所有按钮接真 Panel）
// 每个图标都可以点击，也可以用快捷键（按设计文档 §15.x）：
//   C 角色   L 编队   F 合成   T 载具   Tab 建造   B 背包   J 任务   空格 祈福   P 睡觉   ESC 设置

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { Assets } from '../core/Assets.js';
import { BuildSystem } from '../systems/BuildSystem.js';
import { createEl, qs } from './dom.js';

export class FuncBar {
  constructor(director) {
    this.director = director;
    this.root = null;
  }

  mount(parent = qs('#app')) {
    // 图标定义（从右到左）
    const icons = [
      // 设计文档 §15.x
      { id: 'settings',  emoji: Assets.ui.settings,  label: '设置(ESC)',     action: 'openSettings' },
      { id: 'sleep',     emoji: Assets.ui.sleep,     label: '睡觉(P)',       action: 'sleep' },
      { id: 'role',      emoji: Assets.ui.role,      label: '角色(C)',       action: 'openRole' },
      { id: 'team',      emoji: Assets.ui.team,      label: '编队(L)',       action: 'openTeam' },
      { id: 'forge',     emoji: Assets.ui.forge,     label: '合成(F)',       action: 'openForge' },
      { id: 'build',     emoji: Assets.ui.build,     label: '建造(Tab)',     action: 'toggleBuild' },
      { id: 'inventory', emoji: Assets.ui.inventory, label: '背包(B)',       action: 'toggleInventory' },
      { id: 'vehicle',   emoji: Assets.ui.vehicle,   label: '载具(T)',       action: 'openVehicle' },
      { id: 'task',      emoji: '📋',                label: '任务(J)',       action: 'openTask' },
    ];

    this.root = createEl('div', {
      class: ['func-bar'],
      style: {
        position: 'absolute',
        top: '15px',
        right: '15px',
        display: 'flex',
        gap: '10px',
        background: 'rgba(255,255,255,0.85)',
        border: '3px solid #3a3a3a',
        borderRadius: '20px',
        padding: '8px 12px',
        boxShadow: '0 4px 10px rgba(0,0,0,0.3)',
        zIndex: 200,
      },
      parent,
    });

    icons.forEach((item) => {
      const btn = createEl('button', {
        class: ['func-bar-btn'],
        style: {
          width: '48px',
          height: '48px',
          border: '2px solid #3a3a3a',
          borderRadius: '12px',
          background: '#fffbe6',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          transition: 'transform 0.1s',
          fontFamily: '"Segoe UI Emoji", sans-serif',
          fontSize: '22px',
        },
        parent: this.root,
        title: item.label,
        onclick: () => this._onAction(item.action),
      });
      // 悬浮提示
      createEl('div', {
        style: {
          position: 'absolute',
          bottom: '56px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.85)',
          color: '#fff',
          padding: '4px 10px',
          borderRadius: '6px',
          fontSize: '12px',
          whiteSpace: 'nowrap',
          opacity: '0',
          pointerEvents: 'none',
          transition: 'opacity 0.15s',
        },
        text: item.label,
        parent: btn,
        class: ['func-bar-tooltip'],
      });
    });

    // tooltip 显示/隐藏
    this.root.addEventListener('mouseover', (e) => {
      const target = e.target.closest('.func-bar-btn');
      if (!target) return;
      const tip = target.querySelector('.func-bar-tooltip');
      if (tip) tip.style.opacity = '1';
    });
    this.root.addEventListener('mouseout', (e) => {
      const target = e.target.closest('.func-bar-btn');
      if (!target) return;
      const tip = target.querySelector('.func-bar-tooltip');
      if (tip) tip.style.opacity = '0';
    });
  }

  _onAction(action) {
    // 建造模式下拦截：不能睡觉、不能祈福（祈福按钮在 FuncBar 没有，只拦睡觉）
    const gs = this.director?.getGS?.();
    if (gs?.buildMode === true) {
      if (action === 'sleep') {
        EventBus.emit(GE.TOAST_SHOW, { text: '🛠️ 建造模式下不能睡觉', duration: 1500 });
        return;
      }
    }

    switch (action) {
      case 'openSettings':
        EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'settings' });
        break;
      case 'sleep':
        this.director?.sleep?.();
        break;
      case 'openRole':
        EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'role' });
        break;
      case 'openTeam':
        EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'team' });
        break;
      case 'openForge':
        EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'forge' });
        break;
      case 'openVehicle':
        EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'vehicle' });
        break;
      case 'openTask':
        EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'task' });
        EventBus.emit(GE.TASK_OPEN, {});
        break;
      case 'toggleInventory':
        EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'inventory' });
        break;
      case 'toggleBuild': {
        const gs = this.director?.getGS?.();
        if (!gs) return;
        if (gs.buildMode) BuildSystem.exitBuildMode(gs);
        else BuildSystem.enterBuildMode(gs);
        break;
      }
      default:
        break;
    }
  }
}

export default FuncBar;
