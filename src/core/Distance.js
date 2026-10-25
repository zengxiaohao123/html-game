// src/core/Distance.js
// 地图距离 / 邻居 / 相邻判断工具
// 《转盘农场》地图模型：
//   - size×size 网格，外圈 4*(size-1) 格 + 中心 (size-2)×(size-2) 栅栏
//   - 外圈 idx 顺时针：0=左上, 1=上, 2=右上, 3=右, 4=右下, 5=下, 6=左下, 7=左 (size=3)
//   - 外圈每格映射到 (x, y) 网格坐标，邻居按 4 方向环形 wrap
//   - 栅栏内 (row, col) 标准 4 邻居（不越界）

/**
 * 将外圈 idx 映射到网格 (x, y)
 * @param {number} size 地图边长（初始 3）
 * @param {number} idx 外圈格索引 0 ~ 4*(size-1)-1
 * @returns {{x:number, y:number}}
 */
export function outerIdxToXY(size, idx) {
  const ring = size - 1; // 外圈尺寸
  if (idx < 0) idx += 4 * ring;
  idx %= 4 * ring;
  // 分四段：上/右/下/左
  if (idx < ring) {
    // 上边：(idx, 0)
    return { x: idx, y: 0 };
  } else if (idx < 2 * ring) {
    // 右边：(size-1, idx - ring)
    return { x: size - 1, y: idx - ring };
  } else if (idx < 3 * ring) {
    // 下边：(3*ring - idx, size-1)
    return { x: 3 * ring - idx, y: size - 1 };
  } else {
    // 左边：(0, 4*ring - idx)
    return { x: 0, y: 4 * ring - idx };
  }
}

/**
 * 将网格 (x, y) 映射回外圈 idx
 * @param {number} size 地图边长
 * @param {number} x
 * @param {number} y
 * @returns {number|null} 若 (x,y) 不在外圈（在栅栏内部）返回 null
 */
export function outerXYToIdx(size, x, y) {
  const ring = size - 1;
  if (x === 0) {
    // 左边
    if (y === 0) return 0; // 左上（属于上边，按上边算）
    if (y === size - 1) return 3 * ring; // 左下（属于下边）
    return 4 * ring - y; // 左侧中间：从 ring+1 到 2*ring-1
  }
  if (y === 0) {
    // 上边（不含 0 已算在 x===0）
    return x; // 1 ~ ring-1
  }
  if (x === size - 1) {
    // 右边（右上已算在上边）
    if (y === size - 1) return 2 * ring; // 右下
    return ring + y; // ring+1 ~ 2*ring-1
  }
  if (y === size - 1) {
    // 下边（右下/左下已算）
    return 3 * ring - x; // 3*ring-1 ~ 2*ring+1
  }
  return null; // 在栅栏内部
}

/**
 * 外圈 4 邻居索引（**不 wrap**：越界返回 null）
 * Phase 2B 修复：玩家不应该能 wrap 穿越四个角
 *   比如玩家在左下角（idx=6）向左/向下应该被阻挡，wrap 逻辑已去除
 * @param {number} size
 * @param {number} idx
 * @returns {(number|null)[]} 长度 4，按 [上,右,下,左] 顺序；不可通行方向返回 null
 */
export function outerNeighbors(size, idx) {
  const xy = outerIdxToXY(size, idx);
  const ring = size - 1;
  const raw = [
    { x: xy.x, y: xy.y - 1 }, // 上
    { x: xy.x + 1, y: xy.y }, // 右
    { x: xy.x, y: xy.y + 1 }, // 下
    { x: xy.x - 1, y: xy.y }, // 左
  ];
  return raw.map(({ x, y }) => {
    // 不 wrap：任何方向越界（x<0 / x>=size / y<0 / y>=size）都返回 null
    if (x < 0 || x >= size || y < 0 || y >= size) return null;
    // 只有落到外圈的坐标才有 idx；落到栅栏内部（比如 size=4 的 x=1,y=1）也返回 null
    return outerXYToIdx(size, x, y);
  });
}

/**
 * 栅栏内 4 邻居坐标（不越界，可能含 null）
 * @param {number} fenceRowCols 栅栏行列数（初始 1，扩图后 2）
 * @param {number} row
 * @param {number} col
 * @returns {Array<{row:number, col:number}|null>} [上,右,下,左]
 */
export function fenceNeighbors(fenceRowCols, row, col) {
  const dirs = [
    { r: row - 1, c: col },
    { r: row, c: col + 1 },
    { r: row + 1, c: col },
    { r: row, c: col - 1 },
  ];
  return dirs.map(({ r, c }) => {
    if (r < 0 || r >= fenceRowCols || c < 0 || c >= fenceRowCols) return null;
    return { row: r, col: c };
  });
}

/**
 * 判断两个外圈格是否相邻（4 邻居之一）
 */
export function isOuterAdjacent(size, a, b) {
  return outerNeighbors(size, a).includes(b);
}

/**
 * 外圈两格的曼哈顿距离（环形最短路径）
 */
export function outerManhattan(size, a, b) {
  const ring = size - 1;
  const total = 4 * ring;
  // 沿外圈走的最短距离
  const diff = Math.abs(a - b);
  return Math.min(diff, total - diff);
}

export const Distance = {
  outerIdxToXY,
  outerXYToIdx,
  outerNeighbors,
  fenceNeighbors,
  isOuterAdjacent,
  outerManhattan,
};
