// tools/smoke-expand.mjs —— 农场扩建 I 型 / II 型冒烟测试
// 依据：物品库 ITM-BK-003 / ITM-BK-004 描述与备注；设计文档 v0.5 §2.1.1
//
// 覆盖：
//   X1 初始地图尺寸 / 外圈索引口径不变（3×3，8 外圈，1 栅栏）
//   X2 I 型：列数 +1；原最右列右移 1 格；新增列成为外圈/栅栏；角色随地块移动
//   X3 几何一致性：外圈 idx ↔ (x,y) 双射、栅栏线性索引、无幽灵格
//   X4 II 型：行数 +1；原顶行不动；新增行插在顶行之下；栅栏整体下移；生物 pos.y+1
//   X5 多次扩建 + 上限边界：3×I + 3×II → 6×6，背包耗尽后不再扩建
//   X6 存读档往返：扩建立即写入日初基线，读档后尺寸/内容/角色位置恢复
//   X7 旧存档兼容：缺少 rows/cols 的旧档按 size 还原（3×3）且不崩溃
//   X8 背包数量扣减 + 无目标直接使用；描述与物品库逐字一致
//
// 用法：node tools/smoke-expand.mjs

import { readFileSync } from 'node:fs';

globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
};

const { createInitialState } = await import('../src/state/gameState.js');
const { registerFacilities } = await import('../src/data/facilities.js');
const { useItem, canUse } = await import('../src/systems/UseItemSystem.js');
const { InventorySystem } = await import('../src/systems/InventorySystem.js');
const { DayBaseline } = await import('../src/state/DayBaseline.js');
const { Storage } = await import('../src/state/storage.js');
const { migrateGS } = await import('../src/state/migrate.js');
const { Distance } = await import('../src/core/Distance.js');
const { ITEMS } = await import('../src/data/items.js');
const { POTIONS } = await import('../src/data/potions.js');
const { STARTER_ITEMS } = await import('../src/data/starterPack.js');

let pass = 0, fail = 0;
function check(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗', msg, extra !== undefined ? `→ ${JSON.stringify(extra)}` : ''); }
}
const head = (m) => console.log('\n— ' + m + ' —');

registerFacilities();

const ID_LEN = 'item_farm_expand_length';
const ID_WID = 'item_farm_expand_width';

/** 读取当前地图行列数（优先 rows/cols，旧档回落到 size） */
function dimsOf(gs) {
  return {
    rows: gs.map.rows ?? gs.map.size,
    cols: gs.map.cols ?? gs.map.size,
    fenceRows: gs.map.fenceRows ?? gs.map.fenceRowCols,
    fenceCols: gs.map.fenceCols ?? gs.map.fenceRowCols,
  };
}

/** 收集外圈所有 (x,y)，用于检查双射 / 越界 / 重复 */
function ringXY(dims) {
  const out = [];
  for (let idx = 0; idx < gsRingCount(dims); idx++) out.push(Distance.outerIdxToXY(dims, idx));
  return out;
}

function gsRingCount(dims) {
  return 2 * dims.rows + 2 * dims.cols - 4;
}

function verifyGeometry(gs, label) {
  const d = dimsOf(gs);
  const total = gsRingCount(d);
  check(gs.map.outerTiles.length === total, `${label} 外圈数量 = ${total}`, gs.map.outerTiles.length);
  check(gs.map.fence.length === d.fenceRows * d.fenceCols,
    `${label} 栅栏数量 = ${d.fenceRows}×${d.fenceCols}`, gs.map.fence.length);

  const seen = new Set();
  let ok = true;
  for (let idx = 0; idx < total; idx++) {
    const xy = Distance.outerIdxToXY(d, idx);
    const inBounds = xy.x >= 0 && xy.x < d.cols && xy.y >= 0 && xy.y < d.rows;
    const perimeter = xy.x === 0 || xy.x === d.cols - 1 || xy.y === 0 || xy.y === d.rows - 1;
    const key = `${xy.x},${xy.y}`;
    const back = Distance.outerXYToIdx(d, xy.x, xy.y);
    if (!inBounds || !perimeter || seen.has(key) || back !== idx) { ok = false; break; }
    seen.add(key);
  }
  check(ok, `${label} 外圈 idx ↔ (x,y) 双射、全部在外圈、无幽灵格/重复格`, [...seen].length);

  // 外圈地块的 tile.idx 与数组下标一致
  let idxOk = true;
  for (let i = 0; i < gs.map.outerTiles.length; i++) {
    if (gs.map.outerTiles[i].idx !== i) { idxOk = false; break; }
  }
  check(idxOk, `${label} outerTiles[i].idx === i`);

  // 栅栏 row/col 与线性索引一致
  let fenceOk = true;
  for (let i = 0; i < gs.map.fence.length; i++) {
    const f = gs.map.fence[i];
    if (f.row !== Math.floor(i / d.fenceCols) || f.col !== i % d.fenceCols) { fenceOk = false; break; }
  }
  check(fenceOk, `${label} fence[row*fenceCols+col] 自洽`);

  const px = gs.player.x;
  check(Number.isInteger(px) && px >= 0 && px < total, `${label} 玩家下标在外圈范围内`, px);
}

const VALID_TERRAIN = new Set(['terrain_none', 'terrain_grass', 'terrain_water', 'terrain_ice']);

head('X1 初始 3×3');
{
  const gs = createInitialState();
  const d = dimsOf(gs);
  check(d.rows === 3 && d.cols === 3, '初始 3×3', d);
  check(gs.map.outerTiles.length === 8, '初始外圈 8 格', gs.map.outerTiles.length);
  check(gs.map.fence.length === 1, '初始栅栏 1 格', gs.map.fence.length);
  check(Distance.outerIdxToXY(gs.map, 6).x === 0 && Distance.outerIdxToXY(gs.map, 6).y === 2,
    'idx 6 仍是左下（兼容旧口径）', Distance.outerIdxToXY(gs.map, 6));
  verifyGeometry(gs, '初始');
}

head('X2 I 型：长度（列数）+1');
{
  const gs = createInitialState();
  // 原最右列上端 (2,0) = idx2，放一个设施并把角色站上去
  gs.map.outerTiles[2].contentId = 'facility_tent';
  gs.player.x = 2;
  DayBaseline.setCurrent(DayBaseline.capture(gs));

  const before = InventorySystem.countItem(gs, ID_LEN);
  const r = canUse(gs, ID_LEN);
  check(r.ok, 'I 型可用', r);
  const useRes = useItem(gs, ID_LEN);
  check(useRes.ok, 'useItem 返回 ok', useRes);

  const d = dimsOf(gs);
  check(d.rows === 3 && d.cols === 4, '列 3→4，行不变 3', d);
  check(gs.map.fence.length === 2 && d.fenceRows === 1 && d.fenceCols === 2, '栅栏 1×1 → 1×2', d);
  check(InventorySystem.countItem(gs, ID_LEN) === before - 1, '背包 I 型 -1', InventorySystem.countItem(gs, ID_LEN));

  // 原最右列（含内容）右移 1 格：原 idx2 → 新 (3,0) = idx3
  check(gs.player.x === 3, '角色跟随被移动地块（idx2 → idx3）', gs.player.x);
  check(gs.map.outerTiles[3].contentId === 'facility_tent', '设施随地块右移，内容保留', gs.map.outerTiles[3].contentId);
  check(gs.map.outerTiles[2].contentId === null, '空出的新列是全新地块，无内容', gs.map.outerTiles[2].contentId);
  check(VALID_TERRAIN.has(gs.map.outerTiles[2].terrain), '新外圈地块按 §4 抽取地形', gs.map.outerTiles[2].terrain);
  verifyGeometry(gs, 'I型扩建后');

  // 新列中部是栅栏（(2,1) 对应新栅栏 col1）；新增外圈格不能和栅栏重叠
  const fenceXY = [];
  for (const f of gs.map.fence) {
    fenceXY.push(`${f.col + 1},${f.row + 1}`);
  }
  const ring = new Set(ringXY(d).map((p) => `${p.x},${p.y}`));
  check(fenceXY.every((k) => !ring.has(k)), '栅栏格与外圈格无重叠（无幽灵格）');

  // 基线也同步扩建（读档可恢复）
  const base = DayBaseline.getCurrent();
  check(base.map.cols === 4 && base.map.rows === 3, '日初基线同步为 3×4', dimsOf(base));
  check(base.player.x === 3, '基线内角色位置同步重映射', base.player.x);
  check(base.map.outerTiles[2].terrain === gs.map.outerTiles[2].terrain
    && base.map.outerTiles[2].terrainAmount === gs.map.outerTiles[2].terrainAmount,
    '基线新格地形与实时地图一致（不出现两次掷骰分叉）',
    `${base.map.outerTiles[2].terrain} vs ${gs.map.outerTiles[2].terrain}`);
}

head('X3 走廊/邻居在新尺寸下不 wrap、不越界');
{
  const gs = createInitialState();
  useItem(gs, ID_LEN); // 3×4
  const d = dimsOf(gs);
  const bl = Distance.outerXYToIdx(d, 0, d.rows - 1); // 左下角
  const nb = Distance.outerNeighbors(d, bl);
  check(nb[2] === null && nb[3] === null, '左下角向下/向左越界返回 null（不 wrap）', nb);
  const tr = Distance.outerXYToIdx(d, d.cols - 1, 0);
  const nb2 = Distance.outerNeighbors(d, tr);
  check(nb2[0] === null && nb2[1] === null, '右上角向上/向右越界返回 null', nb2);
}

head('X4 II 型：宽度（行数）+1');
{
  const gs = createInitialState();
  useItem(gs, ID_LEN); // 3×4
  // 顶行内容、栅栏标记、生物
  gs.map.outerTiles[1].contentId = 'facility_home';
  gs.map.fence[0].items.push({ itemId: 'marker_fence' });
  gs.creatures.push({
    id: 'c1', defId: 'creature_slime', radius: 0.3,
    pos: { x: 1.5, y: 1.5 }, renderPos: { x: 1.5, y: 1.5 }, dir: 0,
  });
  gs.player.x = Distance.outerXYToIdx(dimsOf(gs), 0, 1); // 左列 y=1
  DayBaseline.setCurrent(DayBaseline.capture(gs));

  const before = InventorySystem.countItem(gs, ID_WID);
  const useRes = useItem(gs, ID_WID);
  check(useRes.ok, 'useItem II 型 ok', useRes);

  const d = dimsOf(gs);
  check(d.rows === 4 && d.cols === 4, '行 3→4，列不变 4', d);
  check(gs.map.fence.length === 4 && d.fenceRows === 2 && d.fenceCols === 2, '栅栏 1×2 → 2×2', d);
  check(InventorySystem.countItem(gs, ID_WID) === before - 1, '背包 II 型 -1');
  check(gs.map.outerTiles[1].contentId === 'facility_home', '原顶行内容原地不动（idx1）');
  check(gs.map.fence[1 * d.fenceCols + 0].items.some((p) => p.itemId === 'marker_fence'),
    '原栅栏内容整体下移 1 行');
  check(Math.abs(gs.creatures[0].pos.y - 2.5) < 1e-9, '生物随世界原点下移 pos.y +1', gs.creatures[0].pos);
  check(gs.map.fence[1 * d.fenceCols + 0].creatures.length === 1, '生物缓存迁到新栅栏格');
  verifyGeometry(gs, 'II型扩建后');

  const base = DayBaseline.getCurrent();
  check(base.map.rows === 4 && base.map.cols === 4, '基线同步为 4×4', dimsOf(base));
  check(Math.abs(base.creatures[0].pos.y - 2.5) < 1e-9, '基线内生物位置同步');
}

head('X5 多次扩建与上限边界');
{
  const gs = createInitialState();
  for (let i = 0; i < 3; i++) check(useItem(gs, ID_LEN).ok, `第 ${i + 1} 次 I 型`);
  for (let i = 0; i < 3; i++) check(useItem(gs, ID_WID).ok, `第 ${i + 1} 次 II 型`);
  const d = dimsOf(gs);
  check(d.rows === 6 && d.cols === 6, '3×I + 3×II → 6×6', d);
  check(InventorySystem.countItem(gs, ID_LEN) === 0 && InventorySystem.countItem(gs, ID_WID) === 0,
    '两种扩建道具均耗尽');
  const extra = useItem(gs, ID_LEN);
  check(!extra.ok && extra.reason === 'noItem', '背包耗尽后不再扩建（上限 = 持有数量）', extra);
  check(dimsOf(gs).rows === 6 && dimsOf(gs).cols === 6, '失败使用不改变尺寸');
  verifyGeometry(gs, '6×6');
}

head('X6 存读档往返');
{
  const gs = createInitialState();
  gs.player.x = 2;                     // 原最右列（会被移动）
  gs.map.outerTiles[2].contentId = 'facility_tent';
  DayBaseline.setCurrent(DayBaseline.capture(gs)); // 日初基线
  useItem(gs, ID_LEN);                 // 3×4
  useItem(gs, ID_LEN);                 // 3×5
  useItem(gs, ID_WID);                 // 4×5

  const base = DayBaseline.getCurrent();
  check(DayBaseline.assertIdempotent(base) === true, '基线幂等');
  check(Storage.save(3, base), '写入槽位 3');
  const loaded = migrateGS(Storage.load(3));
  const d = dimsOf(loaded);
  check(d.rows === 4 && d.cols === 5, '读档恢复 4×5', d);
  check(loaded.map.outerTiles.length === 2 * 4 + 2 * 5 - 4, '读档外圈数量正确');
  check(loaded.map.fence.length === 2 * 3, '读档栅栏数量正确');
  verifyGeometry(loaded, '读档后');
  const tentIdx = loaded.map.outerTiles.findIndex((t) => t.contentId === 'facility_tent');
  check(tentIdx >= 0, '扩建搬运的设施在读档后仍存在');
  check(loaded.player.x === tentIdx, '角色位置与设施地块一致（随地块移动）', { player: loaded.player.x, tentIdx });
}

head('X7 旧存档兼容（缺 rows/cols）');
{
  const gs = createInitialState();
  const old = DayBaseline.capture(gs);
  delete old.map.rows;
  delete old.map.cols;
  delete old.map.fenceRows;
  delete old.map.fenceCols;
  check(Storage.save(4, old), '写入旧口径存档');
  let crashed = false;
  let loaded = null;
  try { loaded = migrateGS(Storage.load(4)); } catch (e) { crashed = true; }
  check(!crashed, '旧档读入不崩溃');
  const d = dimsOf(loaded);
  check(d.rows === 3 && d.cols === 3, '旧档按 size=3 还原为 3×3', d);
  check(loaded.map.fence.length === 1, '旧档栅栏 1 格');
  verifyGeometry(loaded, '旧档迁移后');
  check(useItem(loaded, ID_LEN).ok, '旧档读入后仍可正常扩建');
}

head('X8 背包/文本');
{
  const gs = createInitialState();
  const starterMap = new Map(STARTER_ITEMS);
  check(starterMap.get(ID_LEN) === 3 && starterMap.get(ID_WID) === 3, '开局各 3 个扩建道具');
  check(InventorySystem.countItem(gs, ID_LEN) === 3, '初始背包 I 型 = 3');
  check(InventorySystem.countItem(gs, ID_WID) === 3, '初始背包 II 型 = 3');
  check(POTIONS[ID_LEN] && POTIONS[ID_WID], 'POTIONS 已登记两个扩建道具');
  check(POTIONS[ID_LEN].description === ITEMS[ID_LEN].description, 'I 型描述与物品库逐字一致', POTIONS[ID_LEN].description);
  check(POTIONS[ID_WID].description === ITEMS[ID_WID].description, 'II 型描述与物品库逐字一致', POTIONS[ID_WID].description);
  check(ITEMS[ID_LEN].description === '农场的长度增加1格', 'I 型玩家可见文本', ITEMS[ID_LEN].description);
  check(ITEMS[ID_WID].description === '农场的宽度增加1格', 'II 型玩家可见文本', ITEMS[ID_WID].description);

  // 常量里声明了测试期数量，避免散落魔法值
  const starterSrc = readFileSync(new URL('../src/data/starterPack.js', import.meta.url), 'utf8');
  check(starterSrc.includes('item_farm_expand_length') && starterSrc.includes('item_farm_expand_width'),
    '测试初始物品写在 starterPack 数据表中');
}

console.log(`\n════ 扩建冒烟：${pass} 通过 / ${fail} 失败 ════`);
process.exit(fail === 0 ? 0 : 1);
