// src/ui/LinkSkillUI.js
// Phase 4 —— 连携技实时窗口
// 屏幕右上偏中央（避开 FuncBar）显示小圆框队列；每个 entry 带金色发光 + 倒计时进度条；
// 按 1/2/3 触发对应索引的连携技；超时自动消失。
//
// 订阅：
//   - GE.LINK_SKILL_READY    → 显示 / 更新
//   - GE.LINK_SKILL_EXPIRE   → 刷新（触发/超时都需要）
//   - GE.BOOT / GE.STATE_RESET → 全量重绘
//   - 200ms setInterval      → 更新倒计时进度条
//   - keydown 1/2/3          → 触发 popLinkSkill

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { LinkSkillSystem, popLinkSkill } from '../systems/LinkSkillSystem.js';
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
    // 位置：右上偏中（避开 FuncBar），绝对定位
    this.root = createEl('div', {
      style: {
        position: 'fixed',
        top: '130px',
        right: '30px',
        display: 'none', // 默认隐藏
        flexDirection: 'row',
        gap: '12px',
        zIndex: 4000,
        alignItems: 'flex-start',
        pointerEvents: 'none',  // 让底下的点击穿透；键盘触发
      },
      parent,
    });

    this.listEl = createEl('div', {
      style: {
        display: 'flex', gap: '12px',
      },
      parent: this.root,
    });

    this._subscribeEvents();
    this._setupKeyHandler();
    this._setupTimer();
  }

  _subscribeEvents() {
    EventBus.on(GE.LINK_SKILL_READY, () => this._reRender());
    EventBus.on(GE.LINK_SKILL_EXPIRE, () => this._reRender());
    EventBus.on(GE.BOOT, () => this._reRender());
    EventBus.on(GE.STATE_RESET, () => this._reRender());
  }

  _setupTimer() {
    this._timer = setInterval(() => {
      // 先让系统层 pruneExpired
      const gs = this._getGS();
      if (!gs) return;
      LinkSkillSystem.pruneExpired(gs);
      this._updateProgress();
    }, 200);
  }

  _setupKeyHandler() {
    this._keyHandler = (e) => {
      if (!this.visible) return;
      const key = e.key;
      if (key === '1' || key === '2' || key === '3') {
        e.preventDefault();
        const idx = Number(key) - 1;
        this._triggerIdx(idx);
      }
    };
    window.addEventListener('keydown', this._keyHandler);
  }

  _triggerIdx(idx) {
    const gs = this._getGS();
    if (!gs || !Array.isArray(gs.linkSkillQueue)) return;
    if (idx < 0 || idx >= gs.linkSkillQueue.length) return;
    const entry = gs.linkSkillQueue[idx];
    if (!entry) return;

    // 触发（pop + 调 SkillSystem triggerLinkSkill 占位）
    popLinkSkill(gs, entry.skillId);
    // SkillSystem 具体结算 Phase 3 未实现，留 toast 占位
    EventBus.emit(GE.TOAST_SHOW, {
      text: `⚡ 连携技触发！${entry.skillId}`,
      duration: 1600,
    });
    devLog.info('[LinkSkillUI] triggered idx', idx, entry.skillId);
    this._reRender();
  }

  _reRender() {
    const gs = this._getGS();
    this.listEl.innerHTML = '';

    // 先 prune 一次避免 DOM 显示已过期
    if (gs) LinkSkillSystem.pruneExpired(gs);

    const queue = gs?.linkSkillQueue || [];
    if (queue.length === 0) {
      if (this.visible) {
        this.visible = false;
        if (this.root) this.root.style.display = 'none';
      }
      return;
    }

    if (!this.visible) {
      this.visible = true;
      if (this.root) this.root.style.display = 'flex';
    }

    queue.slice(0, 3).forEach((entry, i) => {
      const box = createEl('div', {
        style: {
          position: 'relative',
          width: '72px', height: '72px',
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #fff6c0 0%, #e8a900 100%)',
          border: '3px solid #3a3a3a',
          boxShadow: '0 0 14px rgba(232, 169, 0, 0.85)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column',
          animation: 'link-pulse 0.6s ease-in-out infinite alternate',
          pointerEvents: 'auto',
        },
        parent: this.listEl,
      });
      // 数字 key 提示
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
      // skill 占位 emoji（从 skillId 推断不到 emoji 时用 ⚡）
      const emoji = '⚡';
      createEl('div', {
        style: { fontSize: '28px', fontFamily: '"Segoe UI Emoji",sans-serif', lineHeight: '1' },
        text: emoji, parent: box,
      });
      // 倒计时进度条（底部半圆进度条）
      createEl('div', {
        class: 'link-progress',
        style: {
          position: 'absolute', bottom: '-6px', left: '50%', transform: 'translateX(-50%)',
          width: '60px', height: '6px',
          background: 'rgba(0,0,0,0.2)', borderRadius: '4px',
          overflow: 'hidden', border: '1px solid #3a3a3a',
        },
        parent: box,
      }).setAttribute('data-idx', i);
    });
  }

  _updateProgress() {
    const gs = this._getGS();
    if (!gs) return;
    const queue = gs.linkSkillQueue || [];
    if (!this.listEl) return;
    const now = Date.now();
    const progressBars = this.listEl.querySelectorAll('[data-idx]');
    progressBars.forEach((barEl) => {
      const idx = Number(barEl.getAttribute('data-idx'));
      const entry = queue[idx];
      if (!entry) return;
      const remainMs = Math.max(0, entry.expireAtMs - now);
      const pct = remainMs / 3000 * 100;
      // 直接用 width 表示剩余时间
      barEl.firstChild && barEl.removeChild(barEl.firstChild);
      const fill = document.createElement('div');
      fill.style.cssText = `height:100%;width:${pct}%;background:linear-gradient(90deg,#e8a900,#ff7a00);transition:width 0.15s linear;`;
      barEl.appendChild(fill);
    });

    // 全部空了则隐藏（_reRender 会调用，这里兜底）
    if (queue.length === 0 && this.visible) {
      this.visible = false;
      if (this.root) this.root.style.display = 'none';
    }
  }

  _getGS() {
    if (this.director?.getGS) return this.director.getGS();
    if (window.__gameDirector?.getGS) return window.__gameDirector.getGS();
    return null;
  }
}

export default LinkSkillUI;
