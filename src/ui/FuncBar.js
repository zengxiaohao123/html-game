// src/ui/FuncBar.js
// 功能区（§16.8：屏幕顶部右侧居右只占一行；只显示图标无文字；图标直接叠在地图上，不另设背景板）
// 视觉顺序从右往左：设置、睡觉、角色、编队、合成、建造、背包、载具
// （数组顺序为 设置→载具，容器用 flex row-reverse 使设置位于最右）
// 每个图标都可以点击，也可以用快捷键（按设计文档 §16.x）：
//   C 角色   L 编队   F 合成   T 载具   Tab 建造   B 背包   J 任务   空格 祈福   P 睡觉   ESC 设置

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { Assets } from '../core/Assets.js';
import { BuildSystem } from '../systems/BuildSystem.js';
import { createEl, qs, iconEl } from './dom.js';

export class FuncBar {
  constructor(director) {
    this.director = director;
    this.root = null;
  }

  mount(parent = qs('#app')) {
    // 图标定义（数组顺序 = 从右到左，容器 row-reverse 渲染）
    const icons = [
      // 设计文档 §16.8
      { id: 'settings',  emoji: Assets.ui.settings,  label: '设置(ESC)',     action: 'openSettings' },
      { id: 'sleep',     emoji: Assets.ui.sleep,     label: '睡觉(P)',       action: 'sleep' },
      { id: 'role',      emoji: Assets.ui.role,      label: '角色(C)',       action: 'openRole' },
      { id: 'team',      emoji: Assets.ui.team,      label: '编队(L)',       action: 'openTeam' },
      { id: 'forge',     emoji: Assets.ui.forge,     label: '合成(F)',       action: 'openForge' },
      { id: 'build',     emoji: Assets.ui.build,     label: '建造(Tab)',     action: 'toggleBuild' },
      { id: 'inventory', emoji: Assets.ui.inventory, label: '背包(B)',       action: 'toggleInventory' },
      { id: 'vehicle',   emoji: Assets.ui.vehicle,   label: '载具(T)',       action: 'openVehicle' },
      // 任务入口已移到左侧独立图标（TopBar.taskIconEl，按 §15.17），不再放 FuncBar
    ];

    this.root = createEl('div', {
      class: ['func-bar'],
      style: {
        position: 'absolute',
        top: '15px',
        right: '5px',
        display: 'flex',
        flexDirection: 'row-reverse',
        gap: '6px',
        width: 'fit-content',
        maxWidth: '100vw',
        flexWrap: 'nowrap',
        // 5760：仍高于商店 5500 / 快捷栏 5600，但低于面板 6000；
        // 高于事件层 5700/5750，保证事件期间「设置（存读档）/ 背包 / 角色」入口仍可点，
        // 其余会改数据的入口由 _onAction 统一拦截（§18.3）。
        zIndex: 5760,
      },
      parent,
    });

    icons.forEach((item) => {
      const btn = createEl('button', {
        class: ['func-bar-btn'],
        style: {
          width: '44px',
          height: '44px',
          border: 'none',
          borderRadius: '10px',
          background: 'transparent',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'transform 0.1s, background 0.15s',
          fontFamily: '"Segoe UI Emoji", sans-serif',
          flexShrink: 0,
        },
        parent: this.root,
        onclick: () => this._onAction(item.action),
      });
      // §16.8 无实体底板，hover 仅轻微半透明白底反馈
      btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(255,255,255,0.35)'; });
      btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; });
      // 按钮内部：只有图标（睡觉等需要确认的动作一律先进文字弹窗，不在图标旁出现行内提示）
      btn.appendChild(iconEl('ui', item.id, { size: '28px', fallback: item.emoji }));
    });
  }

  _onAction(action) {
    // §18.3 事件 / 剧情期间：只放行「纯查看」与「存读档」入口。
    // 查看：背包 / 角色 / 任务；例外：设置（存读档）；其余（睡觉 / 编队 / 合成 / 建造 / 载具）
    // 都会改动游戏数据，直接拦截。信息区入口不在这里（由 InfoPanel 自身门控）。
    if (this.director?.storyUI?.visible) {
      const allowed = new Set(['openSettings', 'toggleInventory', 'openRole', 'openTask']);
      if (!allowed.has(action)) {
        EventBus.emit(GE.TOAST_SHOW, { text: '🎲 事件进行中，暂时无法进行这个操作', duration: 1500 });
        return;
      }
    }

    // 建造模式下拦截：不能睡觉、不能祈福（祈福按钮在 FuncBar 没有，只拦睡觉）
    // TODO(第 9 批)：设计文档未明说建造模式下睡觉按钮是否拦截；保持现状（拦截并提示），待裁决后再定
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
        this.director?.requestSleep?.();
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
