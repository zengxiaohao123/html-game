// src/ui/BlessAnimation.js
// Phase 2B 抽奖动画组件：
//   - 订阅 GE.BLESS_START（BlessSystem.blessStart 扣消耗 + 选目标 + 带候选格坐标）
//   - 画一个全屏 overlay（pointer-events:none 不挡点击）
//   - 在 overlay 上给"候选 tile"各自画一个发光光点
//   - 一个"主光点"以 ease-out 减速在候选格间跳 —— 2.5s 内约 16 次跳转
//   - 最后停在 targetIdx 上，tile 本身脉冲 1s
//   - 动画结束 → 调 BlessSystem.blessCommit(gs, targetIdx)
//   - 移除 overlay
//
// 注意：overlay 用 position:fixed，坐标 = 候选 tile 在 MapView 容器内的像素 + MapView 容器自身 left/top
// BlessSystem.blessStart 给出的 candidates[].x/y 已经是 tile 中心相对 map-container 的像素

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { BlessSystem } from '../systems/BlessSystem.js';
import { devLog } from '../core/Logger.js';

/** 动画参数（可改） */
const TOTAL_MS = 2500;       // 总时长
const JUMP_COUNT = 16;       // 总跳转次数（含最后一次停在 target）
const FINAL_HOLD_MS = 1000;  // 停在 target 后脉冲时长

const easeOut = (t) => 1 - Math.pow(1 - t, 4); // easeOutQuart：前快后慢

export class BlessAnimation {
  constructor() {
    this.overlay = null;
    this.spotlight = null;
    this.candidateDots = [];
    this._rAF = null;
  }

  mount() {
    EventBus.on(GE.BLESS_START, ({ targetIdx, candidates }) => {
      this._play(targetIdx, candidates);
    });
  }

  /** 主入口 */
  _play(targetIdx, candidates) {
    if (!candidates || candidates.length === 0) return;

    const gs = this._getGS();
    if (!gs) return;

    this._buildOverlay();
    this._buildCandidateDots(candidates);

    // 把候选 tile 的"页面绝对像素"算出来（依赖 MapView 容器位置）
    const mapRect = this._getMapRect();
    if (!mapRect) {
      devLog.warn('[BlessAnim] map-container not found, abort animation');
      BlessSystem.blessCommit(gs, targetIdx);
      this._teardown();
      return;
    }

    // 把 candidate 的相对像素 → 绝对像素
    const absPositions = candidates.map(c => ({
      ...c,
      absX: mapRect.left + c.x,
      absY: mapRect.top + c.y,
    }));
    const targetPos = absPositions.find(p => p.idx === targetIdx) || absPositions[0];

    // 动画序列：预先生成 JUMP_COUNT 次跳转（最后一次强制命中 target）
    const sequence = [];
    for (let i = 0; i < JUMP_COUNT; i++) {
      const t = i / (JUMP_COUNT - 1);                 // 0..1
      const dur = easeOut(t);                        // 越往后每段时间越长
      const pickIdx = (i === JUMP_COUNT - 1)
        ? absPositions.indexOf(targetPos)
        : Math.floor(Math.random() * absPositions.length);
      sequence.push({ pos: absPositions[pickIdx], segmentDur: dur });
    }

    // 第一段时长基准（后面 easeOut 让每段越来越长）
    const totalDur = sequence.reduce((s, it) => s + it.segmentDur, 0);
    // 用 sequenceDur / totalDur * (TOTAL_MS - FINAL_HOLD_MS) 计算每段真实毫秒
    const realMsPerSeg = sequence.map(s => (s.segmentDur / totalDur) * (TOTAL_MS - FINAL_HOLD_MS));

    let step = 0;
    const runStep = () => {
      if (step >= sequence.length) {
        // 动画走完 → 停在 target 上脉冲
        this._pulseTarget(targetPos);
        setTimeout(() => {
          const gs2 = this._getGS();
          if (gs2) BlessSystem.blessCommit(gs2, targetIdx);
          this._teardown();
        }, FINAL_HOLD_MS);
        return;
      }
      const seg = sequence[step];
      this._moveSpotlightTo(seg.pos.absX, seg.pos.absY, realMsPerSeg[step]);
      step++;
      this._rAF = setTimeout(runStep, realMsPerSeg[step - 1] + 40 /* transition 预留 */);
    };

    runStep();
  }

  // ─────────────────────── DOM 构建 ───────────────────────
  _buildOverlay() {
    this.overlay = document.createElement('div');
    this.overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:9000',
      'pointer-events:none',
      'background:radial-gradient(circle at center, rgba(255,220,120,0.08) 0%, rgba(0,0,0,0.15) 100%)',
      'overflow:hidden',
    ].join(';');
    document.body.appendChild(this.overlay);

    // 大字提示
    const hint = document.createElement('div');
    hint.style.cssText = [
      'position:absolute',
      'top:18%',
      'left:50%',
      'transform:translateX(-50%)',
      'color:#fff4c8',
      'font-size:24px',
      'font-weight:700',
      'text-shadow:0 2px 8px rgba(0,0,0,0.6)',
      'font-family:"LXGW WenKai TC",sans-serif',
      'pointer-events:none',
    ].join(';');
    hint.textContent = '🧘 momo 正在为你挑选一块福地…';
    this.overlay.appendChild(hint);
  }

  _buildCandidateDots(candidates) {
    const mapRect = this._getMapRect();
    if (!mapRect) return;

    this.candidateDots = [];
    for (const c of candidates) {
      const x = mapRect.left + c.x;
      const y = mapRect.top + c.y;

      const dot = document.createElement('div');
      dot.style.cssText = [
        'position:fixed',
        `left:${x - 10}px`,
        `top:${y - 10}px`,
        'width:20px',
        'height:20px',
        'border-radius:50%',
        'background:rgba(255,220,120,0.35)',
        'border:2px solid rgba(255,200,60,0.7)',
        'box-shadow:0 0 12px rgba(255,210,90,0.5)',
        'transform:translate(-50%,-50%)',
        'pointer-events:none',
      ].join(';');
      this.overlay.appendChild(dot);
      this.candidateDots.push(dot);
    }
  }

  _moveSpotlightTo(absX, absY, ms) {
    if (!this.spotlight) {
      this.spotlight = document.createElement('div');
      this.spotlight.style.cssText = [
        'position:fixed',
        `left:${absX}px`,
        `top:${absY}px`,
        'width:60px',
        'height:60px',
        'border-radius:50%',
        'background:radial-gradient(circle, rgba(255,240,150,0.85) 0%, rgba(255,200,60,0.35) 55%, rgba(255,180,40,0) 80%)',
        'box-shadow:0 0 40px rgba(255,220,90,0.75)',
        'transform:translate(-50%,-50%)',
        'pointer-events:none',
        'will-change:left,top',
      ].join(';');
      this.overlay.appendChild(this.spotlight);
    } else {
      // 目标位置直接改 style（让 transition 生效）
      this.spotlight.style.transition = `left ${ms}ms cubic-bezier(.25,.1,.25,1), top ${ms}ms cubic-bezier(.25,.1,.25,1)`;
      this.spotlight.style.left = absX + 'px';
      this.spotlight.style.top = absY + 'px';
    }
  }

  _pulseTarget(pos) {
    // 最后脉冲：spotlight 短暂放大 + 白闪
    if (this.spotlight) {
      this.spotlight.style.transition = 'transform 300ms ease-in-out, box-shadow 300ms ease-in-out';
      this.spotlight.style.transform = 'translate(-50%,-50%) scale(2.2)';
      this.spotlight.style.boxShadow = '0 0 80px rgba(255,240,120,1)';
      this.spotlight.style.background = 'radial-gradient(circle, rgba(255,255,255,0.95) 0%, rgba(255,220,80,0.55) 55%, rgba(255,180,40,0) 80%)';
    }
  }

  _teardown() {
    if (this._rAF) { clearTimeout(this._rAF); this._rAF = null; }
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
    this.spotlight = null;
    this.candidateDots = [];
  }

  // ─────────────────────── 工具 ───────────────────────
  _getMapRect() {
    const el = document.querySelector('.map-container');
    if (!el) return null;
    return el.getBoundingClientRect();
  }

  _getGS() {
    if (window.__gameDirector && window.__gameDirector.getGS) {
      return window.__gameDirector.getGS();
    }
    return null;
  }
}

export default BlessAnimation;
