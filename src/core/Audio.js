/**
 * core/Audio.js —— 零依赖音频管理（WebAudio + HTMLAudioElement 兜底）
 *
 * - BGM：循环背景音乐（home/boss），可淡入淡出。
 * - SFX：短音效，支持并发（攻击/点击/受击）。
 * - 音量设置持久化（Storage）。
 * - 首次用户交互后才允许 AudioContext（浏览器自动播放策略）。
 */

import { loadSettings, saveSettings } from './Storage.js';

class AudioManager {
  constructor() {
    this.ctx = null;
    this.bgmEl = null;
    this.sfxPool = new Map();
    this.settings = loadSettings();
    this._unlocked = false;
    this._currentBgm = null;
  }

  /** 必须在首次点击/按键里调用一次 */
  unlock() {
    if (this._unlocked) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
      this._unlocked = true;
    } catch { /* 无音频环境 */ }
  }

  setBgmVolume(v) {
    this.settings.bgmVolume = v;
    if (this.bgmEl) this.bgmEl.volume = v;
    saveSettings(this.settings);
  }
  setSfxVolume(v) {
    this.settings.sfxVolume = v;
    saveSettings(this.settings);
  }

  /** 播放 BGM；同一首不重复切换 */
  playBgm(src, { loop = true, fade = 600 } = {}) {
    if (!src) return;
    if (this._currentBgm === src && this.bgmEl && !this.bgmEl.paused) return;
    this.stopBgm(fade);
    const el = new Audio(src);
    el.loop = loop;
    el.volume = 0;
    this.bgmEl = el;
    this._currentBgm = src;
    el.play().then(() => {
      const step = 30;
      const target = this.settings.bgmVolume;
      let cur = 0;
      const timer = setInterval(() => {
        cur += (target / fade) * step;
        if (cur >= target) { cur = target; clearInterval(timer); }
        if (this.bgmEl === el) el.volume = Math.min(cur, target);
      }, step);
    }).catch(() => {/* 尚未解锁 */});
  }

  stopBgm(fade = 300) {
    const el = this.bgmEl;
    if (!el) return;
    this.bgmEl = null;
    this._currentBgm = null;
    const start = el.volume;
    const step = 30;
    let cur = start;
    const timer = setInterval(() => {
      cur -= (start / fade) * step;
      if (cur <= 0) { clearInterval(timer); el.pause(); el.src = ''; }
      else el.volume = cur;
    }, step);
  }

  /** 播放一次性音效；同一 src 复用缓冲，支持并发 */
  playSfx(src, { rate = 1, volume = 1 } = {}) {
    if (!src || !this._unlocked) return;
    try {
      const el = new Audio(src);
      el.volume = Math.max(0, Math.min(1, this.settings.sfxVolume * volume));
      el.playbackRate = rate;
      el.play().catch(() => {});
      el.addEventListener('ended', () => { el.src = ''; });
    } catch { /* 忽略 */ }
  }
}

export const audio = new AudioManager();
