/**
 * ui/screens/MenuScreen.js —— 主菜单 / 标题界面
 */

import { h, clear } from '../dom.js';
import { listSaves, hasAnySave } from '../../core/Storage.js';

export class MenuScreen {
  /**
   * @param {object} director GameDirector
   * @param {object} actions { onStartNew, onContinue(slot), onLoad(slot) }
   */
  constructor(director, actions) {
    this.director = director;
    this.actions = actions;
  }

  render(root) {
    clear(root);
    const wrap = h('div.menu-wrap');
    wrap.append(
      h('div.menu-bg'),
      h('div.menu-inner', {}, [
        h('h1.game-title', { text: '在成为勇者之前' }),
        h('p.game-subtitle', { text: '走格子 · 回合制 · 经营 · 轻度 Roguelike' }),
        h('div.menu-btns', {}, this._buttons()),
        h('p.menu-foot', { text: '纯前端网页游戏 · 进度保存在本机浏览器' }),
      ]),
    );
    root.append(wrap);
  }

  _buttons() {
    const btns = [];
    if (hasAnySave()) {
      const latest = listSaves().filter((s) => !s.empty)
        .sort((a, b) => b.savedAt - a.savedAt)[0];
      btns.push(h('button.mbtn.primary', {
        text: `继续游戏（第 ${latest.day ?? '?'} 天）`,
        onClick: () => this.actions.onContinue(latest.slot),
      }));
    }
    btns.push(h('button.mbtn', {
      text: hasAnySave() ? '开始新的周目' : '开始游戏',
      onClick: () => {
        if (hasAnySave() && !window.confirm('开始新的周目将清空当前进度（存档仍保留在存档槽）。确定继续？')) return;
        this.actions.onStartNew();
      },
    }));
    btns.push(h('button.mbtn', { text: '读取存档', onClick: () => this._showLoadDialog() }));
    return btns;
  }

  _showLoadDialog() {
    const saves = listSaves();
    const overlay = h('div.modal-overlay', { onClick: (e) => { if (e.target === overlay) overlay.remove(); } });
    const box = h('div.modal.paper', {}, [
      h('h2', { text: '读取存档' }),
      h('div.save-grid', {}, saves.map((s) => h('button.save-card' + (s.empty ? '.empty' : ''), {
        onClick: () => { if (!s.empty) { this.actions.onLoad(s.slot); overlay.remove(); } },
      }, [
        h('div.save-no', { text: s.slot === 0 ? '自动存档' : `存档 ${s.slot}` }),
        h('div.save-day', { text: s.empty ? '—— 空 ——' : `第 ${s.day ?? '?'} 天 · ${s.label || ''}` }),
        h('div.save-time', { text: s.empty ? '' : new Date(s.savedAt).toLocaleString('zh-CN') }),
      ]))),
      h('button.mbtn.ghost', { text: '返回', onClick: () => overlay.remove() }),
    ]);
    overlay.append(box);
    document.body.append(overlay);
  }
}
