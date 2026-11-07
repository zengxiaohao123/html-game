// src/ui/LinkSkillUI.js
// Phase 4 重写 —— 连携技实时窗口（非 Panel，不走 panel-mask 那套）
// 订阅 GE.LINK_SKILL_QUEUE 变化时自动显示；8 秒倒计时显示为窗口外圈白色圆环；
// 按 E 触发队列头部（§12.5）；超时自动消失
//
// 计时环（§12.5 / §16.18）：
//   - SVG 圆环作为窗口外边框，尺寸固定在窗口外，不改变窗口内部布局；
//   - 只有队列第一位计时，圆环随剩余时间逆时针消减（满圈 = 8 秒，消完 = 窗口耗尽）；
//   - 排队条目保持满圈；未解锁 / 冷却中的实例根本不会入队，因此不会出现计时环；
//   - 进度跟随 RealtimeClock 的渲染帧逐帧推进，到期判定仍由 200ms 逻辑步完成。

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { LinkSkillSystem, WINDOW_MS } from '../systems/LinkSkillSystem.js';
import { getRealtimeClock } from '../systems/RealtimeClock.js';
import { SKILLS } from '../data/characters.js';
import { createEl, qs, iconEl } from './dom.js';
import { devLog } from '../core/Logger.js';

// 计时环几何：窗口 72px，圆环外扩 9px（画布 90×90，圆心 45,45，半径 42）
const RING_BOX_PX = 72;
const RING_SIZE = 90;
const RING_RADIUS = 42;
const RING_STROKE = 3;
const RING_CIRC = 2 * Math.PI * RING_RADIUS;
const SVG_NS = 'http://www.w3.org/2000/svg';

export class LinkSkillUI {
  constructor(director) {
    this.director = director;
    this.root = null;
    this.listEl = null;
    this.visible = false;
    this._rings = [];
    this._unsubClock = null;
    this._keyHandler = null;
  }

  mount(parent = qs('body')) {
    // §16.18：屏幕中央偏右展示连携技窗口；优先级高于信息区、盖在其他 UI 之上
    // （普通面板 mask zIndex 6000、商店 5500 → 这里 6500）
    this.root = createEl('div', {
      style: {
        position: 'fixed',
        top: '50%',
        left: '62%',
        transform: 'translate(-50%, -50%)',
        display: 'none',
        flexDirection: 'row',
        gap: '12px',
        zIndex: 6500,
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
      // §12.5：每个连携技 8 秒窗口，期间按 E 使用（固定触发队列头部）
      if (key === 'e' || key === 'E') {
        e.preventDefault();
        this._triggerQueueTop();
      }
    };
    window.addEventListener('keydown', this._keyHandler);
  }

  _setupTimer() {
    // 合并进统一实时时钟：窗口过期由 RealtimeClock 的 200ms 逻辑步统一 pruneExpired，
    // 计时环放在渲染帧订阅上逐帧推进（40ms 驱动帧，不跳格、不另起定时器）。
    // WINDOW_MS（8 秒）与到期行为不变：过期判定仍在 LinkSkillSystem 内按 Date.now 计算。
    this._unsubClock = getRealtimeClock(() => this._getGS()).onFrame(() => {
      this._updateRings();
    });
  }

  _triggerQueueTop() {
    const gs = this._getGS(); if (!gs || !Array.isArray(gs.linkSkillQueue)) return;
    const entry = gs.linkSkillQueue[0];
    if (!entry) return;

    // §12.5：按 E 结算队列头部连携技（fireLinkSkill 内部完成 pop + 结算 + 冷却），
    // 使用或超时后队列依次前移
    const result = LinkSkillSystem.fireCurrentQueueTop(gs);
    const sk = SKILLS[entry.skillId];
    const skLabel = sk ? `${sk.emoji || '⚡'} ${sk.name}` : entry.skillId;
    if (result && result.ok) {
      EventBus.emit(GE.TOAST_SHOW, { text: `⚡ 连携技触发！${skLabel}`, duration: 1400 });
    }
    devLog.info('[LinkSkillUI] triggered queue top', entry.skillId, result);
    this._reRender();
  }

  _reRender() {
    const gs = this._getGS();
    this.listEl.innerHTML = '';
    this._rings = [];
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
          position: 'relative', width: `${RING_BOX_PX}px`, height: `${RING_BOX_PX}px`, borderRadius: '50%',
          background: 'linear-gradient(135deg, #fff6c0 0%, #e8a900 100%)',
          border: '3px solid #3a3a3a',
          boxShadow: '0 0 14px rgba(232, 169, 0, 0.85)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column',
          pointerEvents: 'auto',
        },
        parent: this.listEl,
      });
      // 计时环先画（外圈、绝对定位，不参与窗口内部布局），后续角标 / 图标 / 文字覆盖在它之上
      this._rings.push({ idx: i, circle: this._createRing(box) });
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
      // 真实连携技图标 + name
      const sk = SKILLS[entry.skillId];
      const realName = sk?.name || '';
      box.appendChild(iconEl('ui', entry.skillId, { size: '28px', def: sk, fallback: sk?.emoji || '⚡' }));
      if (realName) {
        createEl('div', {
          style: { fontSize: '9px', fontWeight: '700', color: '#3a2e20', marginTop: '2px', textAlign: 'center', maxWidth: '66px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' },
          text: realName, parent: box,
        });
      }
    });
  }

  /**
   * 创建窗口外圈计时环（白色 SVG 圆环）。
   * 圆环从 12 点钟方向开始顺时针铺满；剩余时间越少，弧长越短，
   * 弧的末端向逆时针方向回收（满圈 = 8 秒，0 圈 = 窗口耗尽）。
   * @returns {SVGCircleElement}
   */
  _createRing(box) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${RING_SIZE} ${RING_SIZE}`);
    svg.setAttribute('width', String(RING_SIZE));
    svg.setAttribute('height', String(RING_SIZE));
    svg.style.position = 'absolute';
    svg.style.left = `${-(RING_SIZE - RING_BOX_PX) / 2}px`;
    svg.style.top = `${-(RING_SIZE - RING_BOX_PX) / 2}px`;
    svg.style.width = `${RING_SIZE}px`;
    svg.style.height = `${RING_SIZE}px`;
    svg.style.pointerEvents = 'none';
    svg.style.overflow = 'visible';
    box.appendChild(svg);

    const c = RING_SIZE / 2;
    const mkCircle = (stroke, width) => {
      const el = document.createElementNS(SVG_NS, 'circle');
      el.setAttribute('cx', String(c));
      el.setAttribute('cy', String(c));
      el.setAttribute('r', String(RING_RADIUS));
      el.setAttribute('fill', 'none');
      el.setAttribute('stroke', stroke);
      el.setAttribute('stroke-width', String(width));
      svg.appendChild(el);
      return el;
    };
    // 暗色底衬 + 半透明轨道 + 纯白进度：明亮/深色地图上都清晰，又不喧宾夺主
    mkCircle('rgba(58,58,58,0.35)', RING_STROKE + 2);
    mkCircle('rgba(255,255,255,0.22)', RING_STROKE);
    const circle = mkCircle('#ffffff', RING_STROKE);
    circle.setAttribute('transform', `rotate(-90 ${c} ${c})`);
    circle.setAttribute('stroke-dasharray', `${RING_CIRC} ${RING_CIRC}`);
    circle.setAttribute('class', 'link-ring');
    circle.style.filter = 'drop-shadow(0 1px 2px rgba(0,0,0,0.55))';
    return circle;
  }

  _updateRings() {
    const gs = this._getGS();
    if (!gs || !this.visible) return;
    const queue = gs.linkSkillQueue || [];
    if (queue.length === 0) {
      this.visible = false;
      if (this.root) this.root.style.display = 'none';
      return;
    }
    const now = Date.now();
    for (const ring of this._rings) {
      const entry = queue[ring.idx];
      // 只有队首在计时；排队条目保持满圈，未计时条目（无 expireAtMs）也显示满圈
      const remain = entry && ring.idx === 0 && entry.expireAtMs
        ? (entry.expireAtMs - now) / WINDOW_MS
        : 1;
      const p = Math.max(0, Math.min(1, remain));
      const len = p >= 1 ? RING_CIRC : RING_CIRC * p;
      ring.circle.setAttribute('stroke-dasharray', `${len.toFixed(2)} ${RING_CIRC.toFixed(2)}`);
    }
  }

  _getGS() {
    if (this.director?.getGS) return this.director.getGS();
    if (window.__gameDirector?.getGS) return window.__gameDirector.getGS();
    return null;
  }
}

export default LinkSkillUI;
