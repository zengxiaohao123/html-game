/**
 * core/Rng.js —— 可种子化随机数（mulberry32）+ 概率工具
 *
 * 设计文档要求大量独立 roll（空地三档、狗友概率、意图权重等）。
 * 使用统一 RNG：默认从 Date 派生种子（不可复现的正常游玩）；
 * 调试 / 测试时可注入固定种子复现。
 */

/** @param {number} seed */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class Rng {
  /**
   * @param {number|string} [seed]
   */
  constructor(seed) {
    this.seed(seed ?? (Date.now() ^ (Math.random() * 1e9)));
  }

  seed(s) {
    const n = typeof s === 'string' ? hashStr(s) : s;
    this._next = mulberry32(n);
    this._seed = n >>> 0;
  }

  /** [0,1) */
  next() {
    return this._next();
  }

  /** true with probability p */
  roll(p) {
    return this._next() < p;
  }

  /** [min,max] 闭区间整数 */
  int(min, max) {
    if (max < min) [min, max] = [max, min];
    return min + Math.floor(this._next() * (max - min + 1));
  }

  /** 从数组等概率取一个 */
  pick(arr) {
    return arr[Math.floor(this._next() * arr.length)];
  }

  /**
   * 按权重表抽取。items: [{value, weight}]
   */
  weighted(items) {
    const total = items.reduce((s, it) => s + (it.weight ?? 1), 0);
    let r = this._next() * total;
    for (const it of items) {
      r -= it.weight ?? 1;
      if (r < 0) return it.value;
    }
    return items[items.length - 1].value;
  }

  /** 洗牌（Fisher–Yates），返回新数组 */
  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this._next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}

/** 全局默认随机源（正常游玩使用） */
export const rng = new Rng();
