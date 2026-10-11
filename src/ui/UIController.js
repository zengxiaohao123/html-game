/**
 * ui/UIController.js —— 屏幕切换、全局面板、模态、存档
 */

import { h, clear, mount, toast } from './dom.js';
import { MenuScreen } from './screens/MenuScreen.js';
import { ExploreScreen } from './screens/ExploreScreen.js';
import { BattleScreen } from './screens/BattleScreen.js';
import { renderPanel } from './panels/Panels.js';
import { writeSave, listSaves, deleteSave } from '../core/Storage.js';
import { BattleResult } from '../core/Const.js';

export class UIController {
  constructor(director) {
    this.d = director;
    this.app = document.getElementById('app');
    this.menu = new MenuScreen(director, {
      onStartNew: () => this.startNew(),
      onContinue: (slot) => this.loadSlot(slot),
      onLoad: (slot) => this.loadSlot(slot),
    });
    this.exploreScreen = null;
    this.battleScreen = null;
    this.modal = null;
  }

  boot() {
    this.menu.render(this.app);
  }

  startNew() {
    this.d.newGame();
    this.showExplore();
    toast('新周目开始', 'good');
  }

  loadSlot(slot) {
    if (this.d.loadFromSlot(slot)) { this.showExplore(); toast('读档成功', 'good'); }
    else toast('存档读取失败', 'bad');
  }

  showExplore() {
    this.battleScreen?.destroy(); this.battleScreen = null;
    this.exploreScreen?.destroy();
    this.exploreScreen = new ExploreScreen(this.d, this);
    this.exploreScreen.render(this.app);
  }

  showBattle() {
    this.exploreScreen?.destroy();
    this.battleScreen = new BattleScreen(this.d, this);
    this.battleScreen.render(this.app);
  }

  finishBattle() {
    const result = this.d.combat.S.result;
    // 结算弹窗
    this._showResult(result, () => {
      this.d.finishBattle();
      this.showExplore();
    });
  }

  _showResult(result, done) {
    const title = result === BattleResult.VICTORY ? '战斗胜利' : result === BattleResult.DEFEAT ? '战斗失败' : '成功逃离';
    const overlay = h('div.modal-overlay');
    overlay.append(h('div.modal.paper.result-modal', {}, [
      h('h2', { text: title }),
      h('p', { text: '按确定回到探索。' }),
      h('button.mbtn.primary', { text: '确定', onClick: () => { overlay.remove(); done(); } }),
    ]));
    document.body.append(overlay);
  }

  runFailed() {
    const overlay = h('div.modal-overlay');
    overlay.append(h('div.modal.paper', {}, [
      h('h2', { text: '周目失败' }),
      h('p', { text: '健康归零。一切将重新开始。' }),
      h('button.mbtn.primary', { text: '回到标题', onClick: () => { overlay.remove(); this.backToMenu(); } }),
    ]));
    document.body.append(overlay);
  }

  backToMenu() {
    this.exploreScreen?.destroy();
    this.battleScreen?.destroy();
    this.boot();
  }

  // ---------------- 全局面板 ----------------
  anyModalOpen() { return !!this.modal; }

  openPanel(name) {
    // 战斗中可用性矩阵（§6.4）
    inBattleGuard(name);
    this.closePanel();
    const overlay = h('div.modal-overlay', { onClick: (e) => { if (e.target === overlay) this.closePanel(); } });
    const box = renderPanel(name, this.d, this);
    box.append(h('button.modal-x', { text: '×', onClick: () => this.closePanel() }));
    overlay.append(box);
    this.modal = overlay;
    document.body.append(overlay);
  }
  closePanel() { this.modal?.remove(); this.modal = null; }

  openSettings() { this.openPanel('settings'); }
}

function inBattleGuard(name) {
  // 战斗中：任务只读、背包只读，其余禁止（由面板内部根据 director.topState 处理）
}
