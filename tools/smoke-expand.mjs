// tools/smoke-expand.mjs —— 农场扩建 I 型 / II 型冒烟测试
// 依据：物品库 ITM-BK-003 / ITM-BK-004 描述与备注；设计文档 v0.5 §2.1.1
//
// 覆盖：
//   X1 初始地图尺寸 / 外圈索引口径不变（3×3，8 外圈，1 栅栏）
//   X2 I 型：列数 +1；原最右列右移 1 格；新增列成为外圈/栅栏；角色随地块移动
//   X3 几何一致性：外圈 idx ↔ (x,y) 双射、栅栏线性索引、无幽灵格
//   X4 II 型：行数 +1；原顶行不动；新增行插在顶行之下；栅栏整体下移；生物 pos.y+1
//   X5 多次扩建 + 上限边界：3×I + 3×II → 6×6，背包耗尽后不再扩建
//   X6 存读档往返：当天存档回日初口径（尺寸/道具复原）；跨日采集后保留扩建尺寸
//   X7 旧存档兼容：缺少 rows/cols 的旧档按 size 还原（3×3）且不崩溃
//   X8 背包数量扣减 + 无目标直接使用；描述与物品库逐字一致
//   X9 回档/跨日：扩建受日初基线约束（尺寸与道具一起回滚 / 跨日保留）
//   X10 栅栏内地形：扩建新格随机地形、地形可放置进栅栏、设施/技能仍不可
//   X11 索引重映射：映射表 API（外圈/栅栏 idx、row·col）双向一致；设施所在格、
//       归属生物 sourceTileIdx、放置技能键、UI 选中格、今日已访问格、载具所在格随地块搬家
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
const { TERRAINS } = await import('../src/data/terrains.js');
const { SKILLS } = await import('../src/data/characters.js');
const { BuildSystem } = await import('../src/systems/BuildSystem.js');
const { getLastExpandRemap } = await import('../src/systems/MapExpandSystem.js');
const { CreatureSystem } = await import('../src/systems/CreatureSystem.js');
const { EventBus } = await import('../src/core/EventBus.js');
const { GE } = await import('../src/core/GameEvents.js');

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

/** 校验旧→新映射：键域完整、旧→新唯一、新索引合法、正反映射双向一致、新增格与旧格不重叠 */
function checkRemapBijection(rm, label) {
  const outerOld = 2 * rm.before.rows + 2 * rm.before.cols - 4;
  const outerNew = 2 * rm.after.rows + 2 * rm.after.cols - 4;
  const fenceOld = rm.before.fenceRows * rm.before.fenceCols;
  const fenceNew = rm.after.fenceRows * rm.after.fenceCols;

  check(rm.outerIdx.size === outerOld, `${label} 外圈映射覆盖全部旧格`, rm.outerIdx.size);
  let keysOk = true;
  for (let i = 0; i < outerOld; i++) if (!rm.outerIdx.has(i)) keysOk = false;
  check(keysOk, `${label} 外圈映射键域 = 0..${outerOld - 1} 无遗漏`);

  const vals = new Set(rm.outerIdx.values());
  check(vals.size === outerOld, `${label} 外圈映射旧→新唯一（无重复目标）`, vals.size);
  check([...vals].every((v) => Number.isInteger(v) && v >= 0 && v < outerNew),
    `${label} 外圈新索引全部落在合法范围`);
  let invOk = true;
  for (const [o, n] of rm.outerIdx) if (rm.outerIdxInv.get(n) !== o) invOk = false;
  check(invOk && rm.outerIdxInv.size === outerOld, `${label} 外圈映射正反双向一致`);

  check(rm.fenceIdx.size === fenceOld, `${label} 栅栏映射覆盖全部旧格`, rm.fenceIdx.size);
  let fKeysOk = true;
  for (let i = 0; i < fenceOld; i++) if (!rm.fenceIdx.has(i)) fKeysOk = false;
  check(fKeysOk, `${label} 栅栏映射键域 = 0..${fenceOld - 1} 无遗漏`);
  const fVals = new Set(rm.fenceIdx.values());
  check(fVals.size === fenceOld, `${label} 栅栏映射旧→新唯一（无重复目标）`, fVals.size);
  check([...fVals].every((v) => Number.isInteger(v) && v >= 0 && v < fenceNew),
    `${label} 栅栏新索引全部落在合法范围`);
  let fInvOk = true;
  for (const [o, n] of rm.fenceIdx) if (rm.fenceIdxInv.get(n) !== o) fInvOk = false;
  check(fInvOk && rm.fenceIdxInv.size === fenceOld, `${label} 栅栏映射正反双向一致`);

  let rowOk = true;
  for (let r = 0; r < rm.before.fenceRows; r++) if (!rm.fenceRow.has(r)) rowOk = false;
  check(rowOk, `${label} 栅栏 row 映射覆盖全部旧行`);
  let colOk = true;
  for (let c = 0; c < rm.before.fenceCols; c++) if (!rm.fenceCol.has(c)) colOk = false;
  check(colOk, `${label} 栅栏 col 映射覆盖全部旧列`);

  check(rm.addedOuterIdx.length + rm.outerIdx.size === outerNew,
    `${label} 旧格 + 新增外圈格 = 新总数`,
    { added: rm.addedOuterIdx.length, mapped: rm.outerIdx.size, outerNew });
  check(rm.addedFenceIdx.length + rm.fenceIdx.size === fenceNew,
    `${label} 旧格 + 新增栅栏格 = 新总数`,
    { added: rm.addedFenceIdx.length, mapped: rm.fenceIdx.size, fenceNew });
  check([...vals].every((v) => !rm.addedOuterIdx.includes(v))
    && [...fVals].every((v) => !rm.addedFenceIdx.includes(v)),
    `${label} 新增格与被搬运的旧格索引不重叠`);
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
  // 栅栏新格与外围新格同一套地形分布；已存在的初始栅栏格不回溯
  const newFenceCell = gs.map.fence[1];
  check(VALID_TERRAIN.has(newFenceCell.terrain), '扩建新增栅栏格按 §4 抽随机地形', newFenceCell.terrain);
  check(newFenceCell.terrainAmount === TERRAINS[newFenceCell.terrain].elementAmount,
    '新栅栏格地形量与该地形一致', { t: newFenceCell.terrain, amt: newFenceCell.terrainAmount });
  check(gs.map.fence[0].terrain === 'terrain_none', '已存在的初始栅栏格保持无地形（不回溯）', gs.map.fence[0].terrain);
  check(gs.capacity.friendly === 5, '扩建后容量上限立即 +1（无需其它操作）', gs.capacity.friendly);
  verifyGeometry(gs, 'I型扩建后');

  // 新列中部是栅栏（(2,1) 对应新栅栏 col1）；新增外圈格不能和栅栏重叠
  const fenceXY = [];
  for (const f of gs.map.fence) {
    fenceXY.push(`${f.col + 1},${f.row + 1}`);
  }
  const ring = new Set(ringXY(d).map((p) => `${p.x},${p.y}`));
  check(fenceXY.every((k) => !ring.has(k)), '栅栏格与外圈格无重叠（无幽灵格）');

  // 扩建不写日初基线：当天回档时尺寸与背包一起复原
  const base = DayBaseline.getCurrent();
  check(dimsOf(base).cols === 3 && dimsOf(base).rows === 3, '日初基线保持 3×3（扩建当天内不落基线）', dimsOf(base));
  check(base.player.x === 2, '基线内角色位置保持日初值', base.player.x);
  check(InventorySystem.countItem(base, ID_LEN) === 3, '基线内 I 型数量保持 3', InventorySystem.countItem(base, ID_LEN));
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

  // 扩建不写日初基线：基线仍是日初的 3×4（此例日初就是 3×4）
  const base = DayBaseline.getCurrent();
  check(base.map.rows === 3 && base.map.cols === 4, '日初基线保持 3×4（II 型当天内不落基线）', dimsOf(base));
  check(Math.abs(base.creatures[0].pos.y - 1.5) < 1e-9, '基线内生物位置保持日初值', base.creatures[0].pos);
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

  // A. 当天存档写的是日初基线 → 读档回到当天开始时（3×3、道具复原）
  const dayBase = DayBaseline.getCurrent();
  check(DayBaseline.assertIdempotent(dayBase) === true, '当天基线幂等');
  check(Storage.save(3, dayBase), '写入槽位 3（当天基线）');
  const rolled = migrateGS(Storage.load(3));
  const rd = dimsOf(rolled);
  check(rd.rows === 3 && rd.cols === 3, '当天存档读档回到 3×3', rd);
  check(InventorySystem.countItem(rolled, ID_LEN) === 3 && InventorySystem.countItem(rolled, ID_WID) === 3,
    '当天存档读档扩建道具复原');
  verifyGeometry(rolled, '当天回档后');
  Storage.clearSlot(3);

  // B. 跨日采集后存档 → 尺寸保留 4×5、道具按已用数量入档
  const nextBase = DayBaseline.capture(gs); // 模拟睡觉/跨日的日初采集点
  check(Storage.save(5, nextBase), '写入槽位 5（跨日基线）');
  const loaded = migrateGS(Storage.load(5));
  const d = dimsOf(loaded);
  check(d.rows === 4 && d.cols === 5, '跨日存档读档恢复 4×5', d);
  check(loaded.map.outerTiles.length === 2 * 4 + 2 * 5 - 4, '读档外圈数量正确');
  check(loaded.map.fence.length === 2 * 3, '读档栅栏数量正确');
  check(InventorySystem.countItem(loaded, ID_LEN) === 1 && InventorySystem.countItem(loaded, ID_WID) === 2,
    '跨日存档读档道具数量为已用后数量');
  verifyGeometry(loaded, '读档后');
  const tentIdx = loaded.map.outerTiles.findIndex((t) => t.contentId === 'facility_tent');
  check(tentIdx >= 0, '扩建搬运的设施在读档后仍存在');
  check(loaded.player.x === tentIdx, '角色位置与设施地块一致（随地块移动）', { player: loaded.player.x, tentIdx });
  Storage.clearSlot(5);
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

head('X9 回档/跨日：扩建受日初基线约束');
{
  const gs = createInitialState();
  DayBaseline.setCurrent(DayBaseline.capture(gs)); // 当天日初
  useItem(gs, ID_LEN);
  const after = dimsOf(gs);
  check(after.cols === 4 && after.rows === 3, '当天扩建生效 3×4', after);
  check(InventorySystem.countItem(gs, ID_LEN) === 2, '当天用掉 1 个 I 型，剩 2', InventorySystem.countItem(gs, ID_LEN));

  // 当天回档：地图尺寸与背包一起回到日初
  const rolled = DayBaseline.install(DayBaseline.getCurrent());
  const rd = dimsOf(rolled);
  check(rd.cols === 3 && rd.rows === 3, '回档后尺寸回到 3×3', rd);
  check(rolled.map.fence.length === 1, '回档后栅栏回到 1×1', rolled.map.fence.length);
  check(InventorySystem.countItem(rolled, ID_LEN) === 3, '回档后 I 型恢复 3 个', InventorySystem.countItem(rolled, ID_LEN));
  verifyGeometry(rolled, '回档后');

  // 正常睡到第二天：日初采集点（SleepSystem.sleep）按实时状态采集 → 尺寸保留
  DayBaseline.setCurrent(DayBaseline.capture(gs));
  const next = DayBaseline.install(DayBaseline.getCurrent());
  const nd = dimsOf(next);
  check(nd.cols === 4 && nd.rows === 3, '跨日后尺寸保留 3×4', nd);
  check(InventorySystem.countItem(next, ID_LEN) === 2, '跨日后 I 型为 2 个', InventorySystem.countItem(next, ID_LEN));
  verifyGeometry(next, '跨日后');
}

head('X10 栅栏内地形放置');
{
  const gs = createInitialState();
  useItem(gs, ID_LEN); // 3×4，栅栏 1×2
  const fDims = Distance.fenceDimsOf(gs);
  check(fDims.rows === 1 && fDims.cols === 2, '栅栏为 1×2（含扩建新增格）', fDims);

  InventorySystem.addItem(gs, 'terrain_ice', 2);
  const before = InventorySystem.countItem(gs, 'terrain_ice');

  const r1 = BuildSystem.placeFenceTerrain(gs, 0, 1, 'terrain_ice');
  check(r1.ok && gs.map.fence[1].terrain === 'terrain_ice', '地形可放到栅栏内任意格', r1);
  check(gs.map.fence[1].terrainAmount === TERRAINS.terrain_ice.elementAmount, '栅栏格地形量正确写入');
  check(InventorySystem.countItem(gs, 'terrain_ice') === before - 1, '放置扣 1 个地形道具');

  gs.map.fence[1].terrainAmount = 0; // 消耗后重复施加
  const r2 = BuildSystem.placeFenceTerrain(gs, 0, 1, 'terrain_ice');
  check(r2.ok && gs.map.fence[1].terrainAmount === TERRAINS.terrain_ice.elementAmount, '重复施加同种地形：地形量回满');

  check(!BuildSystem.placeFenceTerrain(gs, 1, 0, 'terrain_ice').ok, '越界栅栏格被拒绝');
  const skillId = Object.keys(SKILLS)[0];
  check(!BuildSystem.placeFenceTerrain(gs, 0, 0, 'facility_tent').ok, '设施不可放置到栅栏内');
  check(!BuildSystem.placeFenceTerrain(gs, 0, 0, skillId).ok, '技能不可放置到栅栏内', skillId);
  check(!BuildSystem.placeContent(gs, gs.map.outerTiles.length + 1, 'facility_tent').ok, '外圈放置接口不接受越界/栅栏坐标');

  InventorySystem.addItem(gs, 'terrain_grass', 1);
  const r3 = BuildSystem.placeFenceTerrain(gs, 0, 0, 'terrain_grass');
  check(r3.ok && gs.map.fence[0].terrain === 'terrain_grass', '初始栅栏格同样允许地形覆盖');
}

head('X11 索引重映射与引用随地块搬家');
{
  // A. I 型：设施、放置技能、归属生物、UI 状态、今日已访问格都按裸索引保存
  const gs = createInitialState();
  const skillId = Object.keys(SKILLS)[0];
  gs.map.outerTiles[2].contentId = 'facility_henhouse';
  gs.map.outerTiles[2].contentState = { doorOpen: true };
  gs.map.outerTiles[3].contentId = skillId;
  gs.creatures.push({
    id: 'owned', kind: 'chick', hp: 10,
    pos: { x: 1.5, y: 1.5 }, renderPos: { x: 1.5, y: 1.5 }, targetPos: null,
    sourceTileIdx: 2,
  });
  gs.creatures.push({
    id: 'wild', kind: 'chick', hp: 5,
    pos: { x: 1.5, y: 1.5 }, renderPos: { x: 1.5, y: 1.5 },
    sourceTileIdx: null,
  });
  gs.linkSkillCounters = { [`${3}|${skillId}`]: { count: 1 } };
  gs.linkSkillCooldowns = { [`${3}|${skillId}`]: 2 };
  gs.linkSkillQueue = [{ key: `${3}|${skillId}`, tileIdx: 3, skillId }];
  gs.uiState.selectedTileIdx = 3;
  gs.player.visitedTodayIdx = [2, 5];
  gs.player.x = 2;
  gs.vehicle.current = { instanceId: 1, vehicleId: 'vehicle_wheel', usageLeft: 3 };

  let evt = null;
  EventBus.once(GE.MAP_EXPANDED, (p) => { evt = p; });
  check(useItem(gs, ID_LEN).ok, 'I 型扩建（重映射用例）');
  check(!!evt && evt.idxMap instanceof Map && evt.remap && evt.remap.fenceIdx instanceof Map,
    'GE.MAP_EXPANDED 携带 idxMap（外圈 Map）与 remap（栅栏 idx / row·col）');
  check(getLastExpandRemap() === evt.remap, 'getLastExpandRemap() 返回同一次扩建映射');

  const rm = evt.remap;
  check(rm.outerIdx.get(2) === 3 && rm.outerIdxInv.get(3) === 2, '外圈映射 idx2 → idx3（旧→新 & 新→旧）');
  check(gs.map.outerTiles[3].contentId === 'facility_henhouse', '设施所在格扩建后仍指向原设施');
  check(gs.player.x === 3, '玩家/载具所在格随设施地块一起搬家');
  check(gs.vehicle.current?.instanceId === 1 && gs.vehicle.current.usageLeft === 3,
    '载具状态不因扩建丢失（当前位置跟随玩家格）');
  check(gs.creatures.find((c) => c.id === 'owned').sourceTileIdx === 3,
    '鸡舍归属生物 sourceTileIdx 重映射（不再被判为野生）');
  check(gs.creatures.find((c) => c.id === 'owned').sourceTileUid === gs.map.outerTiles[3].uid
    && !!gs.map.outerTiles[3].uid, '归属生物同时记录稳定地块 uid');
  check(gs.creatures.find((c) => c.id === 'wild').sourceTileIdx === null, '野生生物归属保持 null');
  check(CreatureSystem.facilityOwnedCreatures(gs, 3).length === 1, '扩建后按设施格仍能查到归属生物');
  check(CreatureSystem.setFacilityDoorOpen(gs, 3, false).ok, '扩建后鸡舍开关门仍生效');
  check(CreatureSystem.facilityOwnedCreatures(gs, 3).length === 1
    && CreatureSystem.isFacilityDoorOpen(gs, 3) === false, '关门后归属生物仍归属该设施');

  check(gs.map.outerTiles[4].contentId === skillId, '技能卡随所在格搬到新索引（idx3 → idx4）');
  check(gs.linkSkillCounters[`${4}|${skillId}`] && !gs.linkSkillCounters[`${3}|${skillId}`],
    '连携计数键 tileIdx 重映射');
  check(gs.linkSkillCooldowns[`${4}|${skillId}`] === 2, '连携冷却键 tileIdx 重映射');
  check(gs.linkSkillQueue[0].tileIdx === 4 && gs.linkSkillQueue[0].key === `${4}|${skillId}`,
    '连携队列 tileIdx/key 重映射');
  check(gs.uiState.selectedTileIdx === 4, 'UI 选中格重映射');
  check(gs.player.visitedTodayIdx.join(',') === '3,7', '今日已访问格（裸索引数组）整体重映射',
    gs.player.visitedTodayIdx);
  checkRemapBijection(rm, 'I 型');

  // B. II 型：顶行不动，y≥1 下移；栅栏行 +1，设施与归属生物同步下移
  const gs2 = createInitialState();
  gs2.map.outerTiles[7].contentId = 'facility_slimehouse';
  gs2.map.outerTiles[7].contentState = { doorOpen: true };
  gs2.creatures.push({
    id: 'owned2', kind: 'slime_fire', hp: 10,
    pos: { x: 1.5, y: 1.5 }, renderPos: { x: 1.5, y: 1.5 }, targetPos: null,
    sourceTileIdx: 7,
  });
  gs2.player.x = 7;
  check(useItem(gs2, ID_WID).ok, 'II 型扩建（重映射用例）');
  const rm2 = getLastExpandRemap();
  check(rm2.outerIdx.get(0) === 0, 'II 型：原顶行外圈格原地不动（idx0 → idx0）');
  check(rm2.outerIdx.get(7) === 8 && rm2.outerIdxInv.get(8) === 7, 'II 型：左列 y=1 → y=2（idx7 → idx8）');
  check(gs2.map.outerTiles[8].contentId === 'facility_slimehouse', 'II 型：设施所在格仍指向原设施');
  check(gs2.creatures[0].sourceTileIdx === 8, 'II 型：归属生物 sourceTileIdx 重映射');
  check(gs2.player.x === 8, 'II 型：玩家跟随被搬地块');
  check(rm2.fenceIdx.get(0) === 1, 'II 型：栅栏格 (0,0) → (1,0)，fenceIdx 0 → 1');
  check(rm2.fenceRow.get(0) === 1 && rm2.fenceCol.get(0) === 0, 'II 型：栅栏 row +1 / col 不变');
  check(rm2.addedFenceIdx.includes(0), 'II 型：新增栅栏顶行列入 addedFenceIdx');
  check(gs2.creatures[0].row === 1 && gs2.creatures[0].col === 0, 'II 型：生物主格缓存 row/col 同步 +1 行');
  const cache = gs2.map.fence[1].creatures;
  check(cache.length === 1 && cache[0] === 'owned2' && typeof cache[0] === 'string',
    'II 型：栅栏缓存存生物 id（与 CreatureSystem 口径一致）');
  check(CreatureSystem.facilityOwnedCreatures(gs2, 8).length === 1, 'II 型：扩建后仍按设施格查到归属生物');
  checkRemapBijection(rm2, 'II 型');
}

console.log(`\n════ 扩建冒烟：${pass} 通过 / ${fail} 失败 ════`);
process.exit(fail === 0 ? 0 : 1);
