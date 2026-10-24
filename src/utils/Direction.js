// src/utils/Direction.js
// 极简方向工具：4 方向枚举 + opposite + dirToIndex 映射
// 注意：邻居计算完全依赖 Phase 0 的 Distance.outerNeighbors，本模块只做方向枚举和索引映射
// dirToIndex 返回值对应 Distance.outerNeighbors 返回数组的下标：
//   'up'→0, 'right'→1, 'down'→2, 'left'→3

/** 四个标准方向 */
export const DIRECTIONS = {
  UP: 'up',
  RIGHT: 'right',
  DOWN: 'down',
  LEFT: 'left',
};

/** 合法方向字符串集合 */
export const VALID_DIRECTIONS = new Set(['up', 'right', 'down', 'left']);

/**
 * 将方向字符串映射到邻居数组下标
 * 对应 Distance.outerNeighbors 返回的 [上, 右, 下, 左] 顺序
 * @param {string} direction 'up' | 'right' | 'down' | 'left'
 * @returns {number} 0~3；非法方向返回 -1
 */
export function dirToIndex(direction) {
  switch (direction) {
    case 'up':    return 0;
    case 'right': return 1;
    case 'down':  return 2;
    case 'left':  return 3;
    default:      return -1;
  }
}

/**
 * 返回相反方向
 * @param {string} direction
 * @returns {string}
 */
export function opposite(direction) {
  switch (direction) {
    case 'up':    return 'down';
    case 'right': return 'left';
    case 'down':  return 'up';
    case 'left':  return 'right';
    default:      return direction;
  }
}

/**
 * 根据方向索引反推方向字符串
 * @param {number} idx 0~3
 * @returns {string} 非法返回 null
 */
export function indexToDir(idx) {
  switch (idx) {
    case 0: return 'up';
    case 1: return 'right';
    case 2: return 'down';
    case 3: return 'left';
    default: return null;
  }
}

export const Direction = {
  DIRECTIONS,
  VALID_DIRECTIONS,
  dirToIndex,
  opposite,
  indexToDir,
};
