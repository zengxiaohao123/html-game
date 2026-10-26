// src/ui/LinkSkillUI.js
// Phase 4 重写 —— 连携技实时窗口（非 Panel，不走 panel-mask 那套）
// 订阅 GE.LINK_SKILL_QUEUE 变化时自动显示；3 秒倒计时；按数字键 1/2/3 触发；超时自动消失

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { LinkSkillSystem } from '../systems/LinkSkillSystem.js';
import { SkillSystem } from '../systems/SkillSystem.js';
import { createEl, qs } from './dom.js';
import { devLog } from '../core/Logger.js';

export class LinkSkillUI {
  constructor(director) {
    this.director = director;
    this.root = null;
    this.listEl = null;
    this.visible = false;
    this._timer = null;
    this._keyHandler = null;
  }

  mount(parent = qs('body')) {
    // 位置：右上偏中（避开 FuncBar / TopBar），绝对定位，zIndex 4000
    this.root = createEl('div', {
      style: {
        position: 'fixed',
        top: '150px',
        right: '30px',
        display: 'none',
        flexDirection: 'row',
        gap: '12px',
        zIndex: 4000,
        alignItems: 'flex-start',
        pointerEvents: 'none',
      },
      parent,
    });
    this.listEl = createEl('div', {
      style: { display: 'flex', gap: '12px' },
      parent: this.root,
    });

    this._subscribe();
    this._setupKeyHandler();
    this._setupTimer();
  }

  _subscribe() {
    EventBus.on(GE.LINK_SKILL_READY, () => this._reRender());
    EventBus.on(GE.LINK_SKILL_EXPIRE, () => this._reRender());
    EventBus.on(GE.BOOT, () => this._reRender());
    EventBus.on(GE.STATE_RESET, () => this._reRender());
  }

  _setupKeyHandler() {
    this._keyHandler = (e) => {
      if (!this.visible) return;
      const key = e.key;
      if (key === '1' || key === '2' || key === '3') {
        e.preventDefault();
        this._triggerIdx(Number(key) - 1);
      }
    };
    window.addEventListener('keydown', this._keyHandler);
  }

  _setupTimer() {
    // 200ms tick：让系统层 pruneExpired，然后更新 DOM 进度条
    this._timer = setInterval(() => {
      const gs = this._getGS(); if (!gs) return;
      LinkSkillSystem.pruneExpired(gs);
      this._updateProgress();
    }, 200);
  }

  _triggerIdx(idx) {
    const gs = this._getGS(); if (!gs || !Array.isArray(gs.linkSkillQueue)) return;
    const entry = gs.linkSkillQueue[idx];
    if (!entry) return;

    LinkSkillSystem.popLinkSkill(gs, entry.skillId);
    // SkillSystem.triggerLinkSkill 由 Phase 3 预留，这里走 Toast 占位
    try { SkillSystem.triggerLinkSkill?.(gs, entry.skillId); } catch (_) {}
    EventBus.emit(GE.TOAST_SHOW, { text: `⚡ 连携技触发！${entry.skillId}`, duration: 1400 });
    devLog.info('[LinkSkillUI] triggered idx', idx, entry.skillId);
    this._reRender();
  }

  _reRender() {
    const gs = this._getGS();
    this.listEl.innerHTML = '';
    if (gs) LinkSkillSystem.pruneExpired(gs);
    const queue = gs?.linkSkillQueue || [];

    if (queue.length === 0) {
      if (this.visible) { this.visible = false; if (this.root) this.root.style.display = 'none'; }
      return;
    }
    if (!this.visible) { this.visible = true; if (this.root) this.root.style.display = 'flex'; }

    queue.slice(0, 3).forEach((entry, i) => {
      const box = createEl('div', {
        style: {
          position: 'relative', width: '72px', height: '72px', borderRadius: '50%',
          background: 'linear-gradient(135deg, #fff6c0 0%, #e8a900 100%)',
          border: '3px solid #3a3a3a',
          boxShadow: '0 0 14px rgba(232, 169, 0, 0.85)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column',
          pointerEvents: 'auto',
        },
        parent: this.listEl,
      });
      createEl('div', {
        style: {
          position: 'absolute', top: '-16px', right: '-6px',
          width: '22px', height: '22px', borderRadius: '50%',
          background: '#3a3a3a', color: '#fff6c0',
          fontSize: '12px', fontWeight: '800',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: '2px solid #e8a900',
        },
        text: String(i + 1), parent: box,
      });
      createEl('div', {
        style: { fontSize: '28px', fontFamily: '"Segoe UI Emoji",sans-serif', lineHeight: '1' },
        text: '⚡', parent: box,
      });
      createEl('div', {
        style: {
          position: 'absolute', bottom: '-6px', left: '50%', transform: 'translateX(-50%)',
          width: '60px', height: '6px',
          background: 'rgba(0,0,0,0.2)', borderRadius: '4px', overflow: 'hidden', border: '1px solid #3a3a3a',
        },
        parent: box,
        class: ['link-progress'],
      }).setAttribute('data-idx', i);
    });
  }

  _updateProgress() {
    const gs = this._getGS(); if (!gs || !this.listEl) return;
    const queue = gs.linkSkillQueue || [];
    const now = Date.now();
    const bars = this.listEl.querySelectorAll('.link-progress');
    bars.forEach((barEl) => {
      const idx = Number(barEl.getAttribute('data-idx'));
      const entry = queue[idx];
      if (!entry) return;
      const remainMs = Math.max(0, entry.expireAtMs - now);
      const pct = remainMs / 3000 * 100;
      barEl.innerHTML = '';
      const fill = createEl('div', {
        style: {
          width: `${pct}%`, height: '100%',
          background: 'linear-gradient(90deg, #e8a900, #ff7a00)',
        },
      });
      barEl.appendChild(fill);
    });
    if (queue.length === 0 && this.visible) { this.visible = false; this.root && (this.root.style.display = 'none'); }
  }

  _getGS() {
    if (this.director?.getGS) return this.director.getGS();
    if (window.__gameDirector?.getGS) return window.__gameDirector.getGS();
    return null;
  }
}

export default LinkSkillUI;
