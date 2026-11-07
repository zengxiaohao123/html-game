// src/core/Distance.js
// 地图距离 / 邻居 / 相邻判断工具
// 《转盘农场》地图模型：
//   - rows×cols 矩形网格（rows = 宽度/行数，cols = 长度/列数；初始 3×3）
//   - 外圈 = 2*rows + 2*cols - 4 格；栅栏内 = (rows-2)×(cols-2)
//   - 外圈 idx 顺时针，每段长度与原正方形口径一致：
//       top: cols-1 格（不含右上角）→ 0=左上
//       right: rows-1 格（含右上/右下角）
//       bottom: cols-1 格（含右下角，不含左下角）
//       left: rows-1 格（含左下角）
//     size=3 时仍是 0=左上, 1=上, 2=右上, 3=右, 4=右下, 5=下, 6=左下, 7=左
//   - 外圈每格映射到 (x, y) 网格坐标，邻居按 4 方向（不 wrap）
//   - 栅栏内 (row, col) 标准 4 邻居（不越界）
//
// 兼容：所有接口都同时接受「数字 size」（旧调用方，按正方形解释）与
//       {rows, cols} / gs / gs.map（矩形地图）。新代码请传 gs.map，
//       禁止再用 map.size 同时当行数与列数。

/** 从 gs / gs.map / {rows, cols} / 数字 size 解析地图行列数 */
export function mapDimsOf(src) {
  if (typeof src === 'number') {
    const n = Math.max(0, src);
    return { rows: n, cols: n };
  }
  const map = src?.map ?? src;
  if (!map) return { rows: 0, cols: 0 };
  const size = map.size ?? 0;
  return {
    rows: map.rows ?? size,
    cols: map.cols ?? size,
  };
}

/** 从 gs / gs.map / geometry snapshot 解析栅栏行列数 */
export function fenceDimsOf(src) {
  const map = src?.map ?? src;
  if (!map) return { rows: 0, cols: 0 };
  const rowCols = map.fenceRowCols ?? 0;
  return {
    rows: map.fenceRows ?? rowCols,
    cols: map.fenceCols ?? rowCols,
  };
}

/** 外圈格总数（随 rows/cols 变化） */
export function outerRingCount(rows, cols) {
  if (rows <= 0 || cols <= 0) return 0;
  return 2 * rows + 2 * cols - 4;
}

/**
 * 将外圈 idx 映射到网格 (x, y)
 * @param {number|object} size 地图边长（旧口径）/ {rows, cols} / gs
 * @param {number} idx 外圈格索引
 * @returns {{x:number, y:number}}
 */
export function outerIdxToXY(size, idx) {
  const { rows, cols } = mapDimsOf(size);
  const total = outerRingCount(rows, cols);
  if (total <= 0) return { x: 0, y: 0 };
  if (idx < 0) idx += total;
  idx %= total;

  const topLen = Math.max(0, cols - 1);
  const rightLen = Math.max(0, rows - 1);
  const bottomLen = Math.max(0, cols - 1);

  if (idx < topLen) {
    // 上边：(idx, 0)
    return { x: idx, y: 0 };
  }
  if (idx < topLen + rightLen) {
    // 右边：(cols-1, idx - topLen)
    return { x: cols - 1, y: idx - topLen };
  }
  if (idx < topLen + rightLen + bottomLen) {
    // 下边：从右到左
    return { x: cols - 1 - (idx - topLen - rightLen), y: rows - 1 };
  }
  // 左边：从下到上（左列含左下角，不含左上角）
  return { x: 0, y: rows - 1 - (idx - topLen - rightLen - bottomLen) };
}

/**
 * 将网格 (x, y) 映射回外圈 idx
 * @param {number|object} size 地图边长（旧口径）/ {rows, cols} / gs
 * @param {number} x
 * @param {number} y
 * @returns {number|null} 若 (x,y) 不在外圈（在栅栏内部或越界）返回 null
 */
export function outerXYToIdx(size, x, y) {
  const { rows, cols } = mapDimsOf(size);
  // 越界坐标（含负坐标）必须返回 null：否则会算出 -1 / total 之外的“幽灵格”，
  // 载具沿方向扫描时会把出界位置当成合法落点，导致移动到不存在的格子、
  // 并以非法 tileIdx 触发【经过时】钩子。
  if (x < 0 || x >= cols || y < 0 || y >= rows) return null;

  const topLen = Math.max(0, cols - 1);
  const rightLen = Math.max(0, rows - 1);
  const bottomLen = Math.max(0, cols - 1);

  if (y === 0) {
    // 上边：x = 0..cols-2 → 0..cols-2；右上角属于右边
    return x <= cols - 2 ? x : topLen;
  }
  if (x === cols - 1) {
    // 右边（含右上角与右下角）
    return topLen + y;
  }
  if (y === rows - 1) {
    // 下边（从右到左；右下角已算在右边，左下角属于左边）
    if (x >= 1) return topLen + rightLen + (cols - 1 - x);
    // x === 0 → 左下角属于左边
    return topLen + rightLen + bottomLen + (rows - 1 - y);
  }
  if (x === 0) {
    // 左边（从下到上）
    return topLen + rightLen + bottomLen + (rows - 1 - y);
  }
  return null; // 在栅栏内部
}

/**
 * 外圈 4 邻居索引（**不 wrap**：越界返回 null）
 * Phase 2B 修复：玩家不应该能 wrap 穿越四个角
 *   比如玩家在左下角（idx=6）向左/向下应该被阻挡，wrap 逻辑已去除
 * @param {number|object} size
 * @param {number} idx
 * @returns {(number|null)[]} 长度 4，按 [上,右,下,左] 顺序；不可通行方向返回 null
 */
export function outerNeighbors(size, idx) {
  const dims = mapDimsOf(size);
  const xy = outerIdxToXY(dims, idx);
  const raw = [
    { x: xy.x, y: xy.y - 1 }, // 上
    { x: xy.x + 1, y: xy.y }, // 右
    { x: xy.x, y: xy.y + 1 }, // 下
    { x: xy.x - 1, y: xy.y }, // 左
  ];
  return raw.map(({ x, y }) => {
    // 不 wrap：任何方向越界（x<0 / x>=cols / y<0 / y>=rows）都返回 null
    if (x < 0 || x >= dims.cols || y < 0 || y >= dims.rows) return null;
    // 只有落到外圈的坐标才有 idx；落到栅栏内部（比如 4×4 的 x=1,y=1）也返回 null
    return outerXYToIdx(dims, x, y);
  });
}

/**
 * 栅栏内 4 邻居坐标（不越界，可能含 null）
 * @param {number|object} fenceRowCols 栅栏行列数（旧口径方阵）/ {rows, cols} / gs
 * @param {number} row
 * @param {number} col
 * @returns {Array<{row:number, col:number}|null>} [上,右,下,左]
 */
export function fenceNeighbors(fenceRowCols, row, col) {
  const dims = typeof fenceRowCols === 'number'
    ? { rows: fenceRowCols, cols: fenceRowCols }
    : fenceDimsOf(fenceRowCols);
  const dirs = [
    { r: row - 1, c: col },
    { r: row, c: col + 1 },
    { r: row + 1, c: col },
    { r: row, c: col - 1 },
  ];
  return dirs.map(({ r, c }) => {
    if (r < 0 || r >= dims.rows || c < 0 || c >= dims.cols) return null;
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
  const { rows, cols } = mapDimsOf(size);
  const total = outerRingCount(rows, cols);
  if (total <= 0) return 0;
  // 沿外圈走的最短距离
  const diff = Math.abs(a - b);
  return Math.min(diff, total - diff);
}

export const Distance = {
  mapDimsOf,
  fenceDimsOf,
  outerRingCount,
  outerIdxToXY,
  outerXYToIdx,
  outerNeighbors,
  fenceNeighbors,
  isOuterAdjacent,
  outerManhattan,
};
