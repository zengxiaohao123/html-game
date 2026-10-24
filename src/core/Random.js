// src/core/Random.js
// 随机数工具：基础 Math.random 封装，保持确定性扩展空间（未来可换 seed 版本）。

export const Random = {
  /**
   * 生成 [min, max] 范围内的整数（含两端）
   * @param {number} min 最小整数
   * @param {number} max 最大整数
   */
  rand(min, max) {
    if (max < min) [min, max] = [max, min];
    return Math.floor(Math.random() * (max - min + 1)) + min;
  },

  /**
   * 概率判定：返回 true 的概率为 p
   * @param {number} p 0 ~ 1 的概率值，如 0.3 表示 30%
   */
  chance(p) {
    if (p <= 0) return false;
    if (p >= 1) return true;
    return Math.random() < p;
  },

  /**
   * 从数组中随机挑一个元素
   * @template T
   * @param {T[]} arr
   * @returns {T | undefined}
   */
  pick(arr) {
    if (!arr || arr.length === 0) return undefined;
    return arr[Math.floor(Math.random() * arr.length)];
  },

  /**
   * 按权重随机挑一个
   * @param {Array<{weight:number, value:*}>} pairs  每项形如 { weight: 3, value: '小麦' }
   * @returns {*} 被抽中的 value
   */
  weightedPick(pairs) {
    if (!pairs || pairs.length === 0) return undefined;
    const total = pairs.reduce((s, p) => s + Math.max(0, p.weight), 0);
    if (total <= 0) return pairs[Math.floor(Math.random() * pairs.length)].value;
    let r = Math.random() * total;
    for (const p of pairs) {
      r -= Math.max(0, p.weight);
      if (r <= 0) return p.value;
    }
    return pairs[pairs.length - 1].value;
  },
};
