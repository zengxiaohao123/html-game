// =============================================================
// rules.js —— 全局规则（因回字形和地形变化，完全重写）
// 读取 04-探索与地图.md + 02-核心概念.md 规格
// =============================================================

// ---------------------------------------------------------------
// 坐标方向常量
// ---------------------------------------------------------------
const FACING = ['up', 'down', 'left', 'right'];

const DIR_DELTA = {
  up:    { dx: 0,  dy: -1 },
  down:  { dx: 0,  dy:  1 },
  left:  { dx: -1, dy:  0 },
  right: { dx: 1,  dy:  0 },
};

// ---------------------------------------------------------------
// passable：判断某地块是否可被实体进入（核心规则）
//   terrain !== 'void' 才算可进入
//   其他地形按设计者细分（目前除 void 外全部默认可进）
// ---------------------------------------------------------------
function passable(map, x, y) {
  const c = MAP.getCell(map, x, y);
  if (!c) return false;
  if (c.terrain === 'void') return false;
  // 特殊地形效果（如沼泽、深水域等）—— 设计者给出时在此扩展
  return true;
}

// ---------------------------------------------------------------
// adjacent：返回相邻 4 格坐标（不管是否合法）
// ---------------------------------------------------------------
function adjacent(x, y, facing) {
  const d = DIR_DELTA[facing];
  return { x: x + d.dx, y: y + d.dy };
}

// ---------------------------------------------------------------
// manhattan / chebyshev / distance
// ---------------------------------------------------------------
function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
function chebyshev(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}
function inBounds(map, x, y) {
  return x >= 0 && y >= 0 && x < map.width && y < map.height;
}

// ---------------------------------------------------------------
// 回字形顺/逆时针方向判定工具
// 前提：a 和 b 都在回字形外圈（否则 undefined）
// 返回：沿回字形外圈从 a 走到 b，顺时针走 / 逆时针走 分别需要多少步
// ---------------------------------------------------------------
function loopStepDistances(map, a, b) {
  // 把外圈上每个格子按顺时针顺序编号，形成一个环
  // 顺时针环：从左上角 (0,0) 出发 → 下 (0,1) → ... 到 (0,h-1) → 右 (1,h-1) → ... → (w-1,h-1) → 上 (w-1,h-2) → ... → (w-1,0) → 左 (w-2,0) → ... → (1,0) → (0,0)
  const w = map.width, h = map.height;
  const ring = [];

  // 左边 x=0，y 从 0 到 h-1 向下
  for (let y = 0; y < h; y++) ring.push({ x: 0, y });
  // 上边 y=h-1，x 从 1 到 w-1 向右
  for (let x = 1; x < w; x++) ring.push({ x, y: h - 1 });
  // 右边 x=w-1，y 从 h-2 到 0 向上
  for (let y = h - 2; y >= 0; y--) ring.push({ x: w - 1, y });
  // 下边 y=0，x 从 w-2 到 1 向左
  for (let x = w - 2; x >= 1; x--) ring.push({ x, y: 0 });

  if (ring.length === 0) return { cw: Infinity, ccw: Infinity };

  const idxOf = (p) => ring.findIndex(c => c.x === p.x && c.y === p.y);
  const ia = idxOf(a), ib = idxOf(b);
  if (ia < 0 || ib < 0) return { cw: Infinity, ccw: Infinity };

  const total = ring.length;
  // 从 a 顺时针走到 b：(ib - ia + total) % total 步
  const cw = (ib - ia + total) % total;
  // 逆时针 = total - 顺时针步
  const ccw = total - cw;

  return { cw, ccw };
}

// ---------------------------------------------------------------
// 把"顺时针前进 1 格 / 逆时针前进 1 格"翻译成目标坐标
// 前提：当前格 (x,y) 在回字形外圈
// ---------------------------------------------------------------
function stepLoopCell(map, fromX, fromY, direction) {
  const w = map.width, h = map.height;

  // 构造顺时针环（和 loopStepDistances 一致）
  const ring = [];
  for (let y = 0; y < h; y++) ring.push({ x: 0, y });
  for (let x = 1; x < w; x++) ring.push({ x, y: h - 1 });
  for (let y = h - 2; y >= 0; y--) ring.push({ x: w - 1, y });
  for (let x = w - 2; x >= 1; x--) ring.push({ x, y: 0 });

  const idx = ring.findIndex(c => c.x === fromX && c.y === fromY);
  if (idx < 0) return { x: fromX, y: fromY };  // 不在外圈，兜底原地

  if (direction === 'cw') {
    return ring[(idx + 1) % ring.length];
  } else {  // 'ccw'
    return ring[(idx - 1 + ring.length) % ring.length];
  }
}

// ---------------------------------------------------------------
// 岩史莱姆天赋·岩盾：每次被命中触发 def-1
// 调用点：任何伤害 dealDamage() 成功命中目标时
// ---------------------------------------------------------------
function onHitRockShield(target) {
  if (!target || !target.talents) return;
  const ts = target.talents;
  if (ts.some(t => t.kind === 'rockShield')) {
    target.def -= 1;
    // 结算时 clamp 由 dealDamage 统一做
  }
}

// ---------------------------------------------------------------
// 结算 clamp [min, max]
// ---------------------------------------------------------------
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

// ---------------------------------------------------------------
// 导出
// ---------------------------------------------------------------
window.RULES = {
  FACING,
  DIR_DELTA,
  passable,
  adjacent,
  manhattan,
  chebyshev,
  inBounds,
  loopStepDistances,
  stepLoopCell,
  onHitRockShield,
  clamp,
};
