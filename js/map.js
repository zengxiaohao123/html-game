// =============================================================
// map.js —— 回字形矩形地图生成器（完全重写）
// 读取 04-探索与地图.md 规格
// =============================================================

// ---------------------------------------------------------------
// 常量：地块内容生成概率（每格独立 roll）
// ---------------------------------------------------------------
const MAP_CONTENT_PROBS = [
  { type: 'empty',     p: 0.40 },  // 空地（普通空地搜索）
  { type: 'event',     p: 0.20 },  // 事件（剧情）
  { type: 'battle',    p: 0.20 },  // 作战（正常战斗）
  { type: 'emergency', p: 0.10 },  // 紧急作战
  { type: 'reward',    p: 0.05 },  // 奖励（Boss 级战斗）
  { type: 'terrain',   p: 0.05 },  // 地形（也有空地搜索资源效果）
];

// ---------------------------------------------------------------
// 默认地图尺寸（矩形，可被道具/特殊地图改写）
// ---------------------------------------------------------------
const MAP_DEFAULT_WIDTH  = 3;
const MAP_DEFAULT_HEIGHT = 3;

// ---------------------------------------------------------------
// 判断某个坐标是不是"回字形外圈"
// ---------------------------------------------------------------
function isOuterRing(x, y, w, h) {
  return (x === 0 || y === 0 || x === w - 1 || y === h - 1);
}

// ---------------------------------------------------------------
// 地图生成
// ---------------------------------------------------------------
// opts = { width?, height?, forceSize? }
//   不传则用 MAP_DEFAULT_WIDTH/HEIGHT
//   forceSize: 道具/特殊地图时强制指定 size
function generateMap(opts = {}) {
  const width  = opts.width  || MAP_DEFAULT_WIDTH;
  const height = opts.height || MAP_DEFAULT_HEIGHT;

  const cells = [];

  // 地形概率（外圈可通行）：ground/grass/river/ice/obstacle
  const TERRAIN_PROBS = [
    { t: 'ground',   p: 0.55 },  // 空地（最多）
    { t: 'grass',    p: 0.15 },  // 草地
    { t: 'river',    p: 0.10 },  // 河流（通行减速）
    { t: 'ice',      p: 0.10 },  // 冰面（打滑）
    { t: 'obstacle', p: 0.10 },  // 障碍（不可通行）
  ];
  const rollTerrain = () => {
    const r = Math.random(); let acc = 0;
    for (const t of TERRAIN_PROBS) { acc += t.p; if (r <= acc) return t.t; }
    return 'ground';
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const outer = isOuterRing(x, y, width, height);
      let terrain, content;

      if (outer) {
        terrain = rollTerrain();  // 外圈：随机地形
        content = terrain === 'obstacle' ? null : rollContent();   // 障碍没 content
      } else {
        terrain = 'void';   // 内部默认 void
        content = null;     // 内部没有 content
      }

      cells.push({
        x, y,
        terrain,
        content: content ? { type: content, done: false } : null,
        attach: null,              // 元素附着，生成时清空（旧字段名 = aura，这里统一用 attach）
        entities: [],              // 实体列表（空数组）
        isEnemySpawnPoint: false,  // 战斗态专用标记
      });
    }
  }

  // 兼容旧代码：方形时加 .n；矩形时用 Math.max(width,height) 兜底（旧 renderMap 会取 .n）
  const mapObj = { width, height, cells };
  if (width === height) mapObj.n = width;  // 旧 ui.js 用 m.n
  else mapObj.n = Math.max(width, height);
  return mapObj;
}

// ---------------------------------------------------------------
// 按概率 roll 一个 content.type（每格独立）
// ---------------------------------------------------------------
function rollContent() {
  const r = Math.random();
  let acc = 0;
  for (const c of MAP_CONTENT_PROBS) {
    acc += c.p;
    if (r <= acc) return c.type;
  }
  return 'empty';  // 兜底
}

// ---------------------------------------------------------------
// 取某个 cell 的工具函数
// ---------------------------------------------------------------
function getCell(map, x, y) {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return null;
  return map.cells[y * map.width + x];
}

// ---------------------------------------------------------------
// 判断 cell 是否在回字形外圈（可通行基础条件）
// ---------------------------------------------------------------
function isCellOuter(map, x, y) {
  const c = getCell(map, x, y);
  if (!c) return false;
  return isOuterRing(x, y, map.width, map.height);
}

// ---------------------------------------------------------------
// 主角出生位置：优先沿用上一天位置，否则随机选外圈合法格
// ---------------------------------------------------------------
function pickHeroSpawn(map, prevPos) {
  // 优先：上一天的位置仍然在新地图的外圈
  if (prevPos) {
    const c = getCell(map, prevPos.x, prevPos.y);
    if (c && c.terrain !== 'void') {
      return { x: prevPos.x, y: prevPos.y };
    }
  }
  // 回退：随机选外圈合法格
  const valid = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (isOuterRing(x, y, map.width, map.height)) {
        const c = getCell(map, x, y);
        if (c && c.terrain !== 'void') valid.push({ x, y });
      }
    }
  }
  if (valid.length === 0) {
    // 理论上不应该发生（至少有一圈外圈），兜底返回 (0,0)
    return { x: 0, y: 0 };
  }
  return valid[Math.floor(Math.random() * valid.length)];
}

// ---------------------------------------------------------------
// 在当前地图上选一个可用于敌人进攻点的格子
//   条件：terrain !== 'void' 且当前不是进攻点
//   opts = { preferNoOverlap? } —— 紧急作战时优先避免重叠多个进攻点
// ---------------------------------------------------------------
function pickEnemySpawnPoints(map, count = 1, opts = {}) {
  const results = [];
  const used = new Set();

  for (let i = 0; i < count; i++) {
    const candidates = [];
    for (const cell of map.cells) {
      if (cell.terrain === 'void') continue;
      if (results.some(r => r.x === cell.x && r.y === cell.y)) continue;
      if (used.has(`${cell.x},${cell.y}`)) continue;
      candidates.push(cell);
    }
    if (candidates.length === 0) {
      // 没合法候选了 —— 放弃这个，继续下一个
      continue;
    }
    // 如果要优先避免重叠：选的时候排除与已选过的距离 < 某阈值的格子
    if (opts.preferNoOverlap && results.length > 0) {
      const filtered = candidates.filter(c =>
        results.every(r => Math.abs(r.x - c.x) + Math.abs(r.y - c.y) >= 2)
      );
      const pool = filtered.length > 0 ? filtered : candidates;
      const picked = pool[Math.floor(Math.random() * pool.length)];
      results.push({ x: picked.x, y: picked.y });
    } else {
      const picked = candidates[Math.floor(Math.random() * candidates.length)];
      results.push({ x: picked.x, y: picked.y });
    }
    used.add(`${results[results.length-1].x},${results[results.length-1].y}`);
  }
  return results;
}

// ---------------------------------------------------------------
// 战斗开始时，把 pickEnemySpawnPoints 的结果标记到地块上
// ---------------------------------------------------------------
function markEnemySpawnPointsOnMap(map, spawnPoints) {
  for (const { x, y } of spawnPoints) {
    const cell = getCell(map, x, y);
    if (cell) cell.isEnemySpawnPoint = true;
  }
}

// ---------------------------------------------------------------
// 清除所有敌人进攻点标记（战斗结束时）
// ---------------------------------------------------------------
function clearEnemySpawnPointMarks(map) {
  for (const cell of map.cells) {
    cell.isEnemySpawnPoint = false;
  }
}

// ---------------------------------------------------------------
// 清除所有元素附着（新地图生成时、或睡觉进下一天时调用）
// ---------------------------------------------------------------
function clearAllAttach(map) {
  for (const cell of map.cells) {
    cell.attach = null;
  }
}

// ---------------------------------------------------------------
// 导出
// ---------------------------------------------------------------
window.MAP = {
  MAP_DEFAULT_WIDTH,
  MAP_DEFAULT_HEIGHT,
  MAP_CONTENT_PROBS,
  isOuterRing,
  generateMap,
  getCell,
  isCellOuter,
  pickHeroSpawn,
  pickEnemySpawnPoints,
  markEnemySpawnPointsOnMap,
  clearEnemySpawnPointMarks,
  clearAllAttach,
};
