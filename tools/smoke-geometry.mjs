// tools/smoke-geometry.mjs
// 空间几何层 + 碰撞查询冒烟脚本（《空间碰撞与时序方案》§2 / §8 测试约定）
// 覆盖：可配置外圈边长（3×3 / 5×5）地块几何、跨格去重、完全重叠、
//       生成放开「整格为空」、半径排布自洽、逻辑位置与渲染位置分离。
// 用法：node tools/smoke-geometry.mjs

globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
};

import { createInitialState } from '../src/state/gameState.js';
import { outerIdxToXY, outerXYToIdx } from '../src/core/Distance.js';
import { CREATURES, getCreatureDef } from '../src/data/creatures.js';
import { CreatureSystem } from '../src/systems/CreatureSystem.js';
import { BlessSystem } from '../src/systems/BlessSystem.js';
import { migrateGS } from '../src/state/migrate.js';
import * as G from '../src/core/Geometry.js';

let pass = 0, fail = 0;
function check(cond, msg, extra) {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else {
    fail++;
    console.log(`  ❌ ${msg}${extra !== undefined ? `  ← ${JSON.stringify(extra)}` : ''}`);
  }
}
function head(t) { console.log(`\n═══ ${t} ═══`); }

/** 构造指定外圈边长的 GS（栅栏内 = size-2）×（size-2），栅栏原点恒 (1,1) */
function mkMap(size) {
  const gs = createInitialState();
  const ring = size - 1;
  const outerTiles = [];
  for (let idx = 0; idx < 4 * ring; idx++) {
    outerTiles.push({ idx, terrain: 'terrain_none', terrainAmount: 0, contentId: null, states: [], dailyFlags: {} });
  }
  const fenceRowCols = size - 2;
  const fence = [];
  for (let r = 0; r < fenceRowCols; r++) {
    for (let c = 0; c < fenceRowCols; c++) {
      fence.push({ row: r, col: c, terrain: 'terrain_none', terrainAmount: 0, creatures: [], items: [] });
    }
  }
  gs.map.size = size;
  gs.map.outerTiles = outerTiles;
  gs.map.fence = fence;
  gs.map.fenceRowCols = fenceRowCols;
  gs.player.x = 0;
  gs.creatures = [];
  return gs;
}

function addCreature(gs, { id, kind = 'chicken', pos, radius = null, hp = 10, category = null }) {
  const def = getCreatureDef(kind);
  const c = {
    id, kind, hp, maxHp: hp,
    category: category || def?.category || 'danger',
    pos: { ...pos },
    radius: radius ?? G.creatureRadius(kind),
    renderPos: { ...pos },
    dir: { x: 1, y: 0 },
    speedPerTile: def?.speedPerTile ?? 0.25,
  };
  gs.creatures.push(c);
  return c;
}

// ════════════════════════════════════════════════════════════
head('1. 3×3 初始地图：几何不写死，外圈 8 格 + 栅栏原点 (1,1)');
{
  const gs = mkMap(3);
  check(gs.map.size === 3 && gs.map.fenceRowCols === 1, '3×3：外圈边长 3 / 栅栏 1×1');

  const r0 = G.tileRect(gs, G.outerTileRef(0));
  check(r0.x0 === 0 && r0.y0 === 0 && r0.x1 === 1 && r0.y1 === 1, '外圈 idx=0 左上 AABB [0,0]-[1,1]', r0);

  const c2 = G.tileCenter(gs, G.outerTileRef(2));
  check(c2.x === 2.5 && c2.y === 0.5, '外圈 idx=2 右上中心 (2.5,0.5)', c2);

  const fRect = G.fenceRect(gs);
  check(fRect.x0 === 1 && fRect.y0 === 1 && fRect.x1 === 2 && fRect.y1 === 2, '栅栏区域恒为网格 (1,1)-(2,2)', fRect);
  check(G.fenceTileRect(0, 0).x0 === 1 && G.fenceTileRect(0, 0).y0 === 1, '栅栏格 (0,0) AABB 从 (1,1) 起');
  check(G.outerTileCount(gs) === 8, '3×3 外圈 8 格');

  // 全部地块（外圈 + 栅栏）两两内部不重叠
  const all = [...G.allOuterTileRefs(gs), ...G.allFenceTileRefs(gs)];
  let overlap = 0;
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      if (G.rectsOverlap(G.tileRect(gs, all[i]), G.tileRect(gs, all[j]))) overlap++;
    }
  }
  check(overlap === 0, `3×3 全部 ${all.length} 块地块两两不重叠（重叠对 ${overlap}）`);
}

// ════════════════════════════════════════════════════════════
head('2. 5×5 扩图：外圈 16 格 + 栅栏内 3×3，中心/AABB 正确且不重叠');
{
  const gs = mkMap(5);
  check(gs.map.size === 5 && gs.map.outerTiles.length === 16, '5×5：外圈 16 格');
  check(gs.map.fence.length === 9 && gs.map.fenceRowCols === 3, '5×5：栅栏内 3×3 = 9 格（随外圈同步扩大）');

  const fRect = G.fenceRect(gs);
  check(fRect.x0 === 1 && fRect.y0 === 1 && fRect.x1 === 4 && fRect.y1 === 4, '5×5 栅栏区域 [1,1]-[4,4]（原点不随扩图移动）', fRect);

  // 外圈每格 AABB 与 Distance 的 (x,y) 映射一致、中心 = 框中心
  let mismatch = 0;
  for (let idx = 0; idx < 4 * (5 - 1); idx++) {
    const xy = outerIdxToXY(5, idx);
    const rect = G.tileRect(gs, G.outerTileRef(idx));
    const center = G.tileCenter(gs, G.outerTileRef(idx));
    if (rect.x0 !== xy.x || rect.y0 !== xy.y || rect.x1 !== xy.x + 1 || rect.y1 !== xy.y + 1) mismatch++;
    if (center.x !== (rect.x0 + rect.x1) / 2 || center.y !== (rect.y0 + rect.y1) / 2) mismatch++;
  }
  check(mismatch === 0, '5×5 外圈 16 格：AABB 与中心全部正确（0 处偏差）', mismatch);

  const fc = G.tileCenter(gs, G.fenceTileRef(2, 2));
  check(fc.x === 3.5 && fc.y === 3.5, '栅栏格 (2,2) 中心 (3.5,3.5)', fc);
  check(G.fenceTileIndex(gs, 2, 1) === 7, '栅栏线性索引 row*fenceRowCols+col = 7', G.fenceTileIndex(gs, 2, 1));

  const all = [...G.allOuterTileRefs(gs), ...G.allFenceTileRefs(gs)];
  let overlap = 0;
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      if (G.rectsOverlap(G.tileRect(gs, all[i]), G.tileRect(gs, all[j]))) overlap++;
    }
  }
  check(overlap === 0, `5×5 全部 ${all.length} 块地块（外圈 16 + 栅栏 9）两两不重叠`, overlap);

  // 外圈与栅栏交界处：左侧外圈格 (0,1) 的右边界 = 栅栏 (0,0) 的左边界
  const leftMid = G.tileRect(gs, G.outerTileRef(outerXYToIdx(5, 0, 1)));
  const fence00 = G.fenceTileRect(0, 0);
  check(leftMid.x1 === fence00.x0 && leftMid.y0 === fence00.y0, '外圈与栅栏边界严丝合缝（无缝隙/无交叠）');
}

// ════════════════════════════════════════════════════════════
head('3. 跨格生物：只返回一次（按实例去重），且按域裁剪');
{
  const gs = mkMap(5);
  // 圆心正好压在栅栏 (0,0) 与 (0,1) 的分界 x=2 → 同时与两格重叠
  const c = addCreature(gs, { id: 'cross', kind: 'chicken', pos: { x: 2, y: 1.5 }, radius: 0.25 });

  const refs = G.creatureTileRefs(gs, c);
  check(refs.length === 2, '跨格生物同时属于 2 个栅栏格', refs);

  const single = G.creaturesInTiles(gs, [G.fenceTileRef(0, 0), G.fenceTileRef(0, 1)]);
  check(single.length === 1 && single[0].id === c.id, '两格并集查询：同一实例只返回 1 次（不按格重复）', single.map((x) => x.id));

  const dupRefs = G.creaturesInTiles(gs, [G.fenceTileRef(0, 0), G.fenceTileRef(0, 0), G.fenceTileRef(0, 1)]);
  check(dupRefs.length === 1, '重复传入同一格也不重复计数');

  check(G.creaturesInTileRect(gs, 0).length === 1, '数值入参 = 栅栏线性索引（0 = 栅栏首格）');

  // 域裁剪：圆同时几何压到外圈左中格，但生物查询不返回外圈命中
  const leftMidIdx = outerXYToIdx(5, 0, 1);
  const c2 = addCreature(gs, { id: 'edge', kind: 'chicken', pos: { x: 1.05, y: 1.5 }, radius: 0.25 });
  const outerRect = G.tileRect(gs, G.outerTileRef(leftMidIdx));
  check(G.circleIntersectsRect(1.05, 1.5, 0.25, outerRect) === true, '几何上圆确实压到外圈左中格');
  const outerHit = G.creaturesInTiles(gs, [G.outerTileRef(leftMidIdx)]);
  check(outerHit.length === 0, '域裁剪：外圈地块查询不返回生物（生物只属于栅栏域）', outerHit.length);
  check(G.creaturesInTiles(gs, [G.fenceTileRef(0, 0)]).length === 2, '同一批生物在栅栏域内正常返回');
  check(c2.pos.x === 1.05, '连续坐标保留小数，不吸附格中心');
}

// ════════════════════════════════════════════════════════════
head('4. 完全重叠：两只生物各算一次（按实例去重，不按位置去重）');
{
  const gs = mkMap(3);
  const a = addCreature(gs, { id: 'overlap_a', kind: 'chicken', pos: { x: 1.5, y: 1.5 }, radius: 0.25 });
  const b = addCreature(gs, { id: 'overlap_b', kind: 'chicken', pos: { x: 1.5, y: 1.5 }, radius: 0.25 });

  const list = G.creaturesInTiles(gs, [G.fenceTileRef(0, 0)]);
  check(list.length === 2, '完全重叠的两只各返回一次（2 条）', list.map((x) => x.id));
  check(list[0].id !== list[1].id, '返回的是两个不同实例');

  const rectHit = G.creaturesInTileRect(gs, 0);
  check(rectHit.length === 2, '单格矩形查询同样返回 2 只', rectHit.length);
  check(a.pos.x === b.pos.x && a.pos.y === b.pos.y, '两者位置确实完全相同');
}

// ════════════════════════════════════════════════════════════
head('5. CreatureSystem：生成不再要求整格为空，允许完全重叠');
{
  const gs = mkMap(3);
  const tile = gs.map.fence[0];
  tile.creatures.push('legacy_ghost'); // 整格已被缓存占满（且指向不存在的旧 id）
  gs.creatures.push({ id: 'legacy_ghost', kind: 'chicken', hp: 10, row: 0, col: 0, category: 'friendly' });

  const c1 = CreatureSystem.spawnCreature(gs, 'chick');
  check(!!c1, '整格已占用时仍能生成（不再要求整格为空）', c1?.id);
  check(c1?.pos && Number.isFinite(c1.pos.x) && Number.isFinite(c1.pos.y), '生成即带连续坐标 pos.x/pos.y', c1?.pos);
  check(c1?.radius === CREATURES.chick.radius, '实例半径取自生物定义 1/6', c1?.radius);
  check(typeof c1?.dir?.x === 'number' && typeof c1?.dir?.y === 'number', '预留任意方向 dir 向量', c1?.dir);
  check(typeof c1?.speedPerTile === 'number' && c1.speedPerTile >= 1 / 6 && c1.speedPerTile <= 1 / 3,
    '预留速度 speedPerTile ∈ [0.167,0.333] 格/秒（3~6 秒 1 格）', c1?.speedPerTile);
  check(c1?.targetPos === null, '预留闲逛目标点 targetPos');
  check(!!c1?.renderPos && c1.renderPos.x === c1.pos.x, '渲染插值位置 renderPos 已初始化');
  check(tile.creatures.length === 2, '同一栅栏格可注册多只生物', tile.creatures.length);

  const tileRect = G.fenceTileRect(0, 0);
  check(
    c1.pos.x >= tileRect.x0 + c1.radius - 1e-9 && c1.pos.x <= tileRect.x1 - c1.radius + 1e-9 &&
    c1.pos.y >= tileRect.y0 + c1.radius - 1e-9 && c1.pos.y <= tileRect.y1 - c1.radius + 1e-9,
    '初始位置是格内合法点（圆不越出落点格/栅栏）', c1.pos,
  );

  // 固定随机数：两次生成落在同一格同一坐标 → 验证完全重叠被允许
  const origRandom = Math.random;
  Math.random = () => 0;
  const c2 = CreatureSystem.spawnCreature(gs, 'chick');
  const c3 = CreatureSystem.spawnCreature(gs, 'chick');
  Math.random = origRandom;
  check(!!c2 && !!c3, '连续生成成功');
  check(c2.pos.x === c3.pos.x && c2.pos.y === c3.pos.y, '两次生成位置完全相同（完全重叠被允许）', [c2?.pos, c3?.pos]);
  check(gs.creatures.filter((c) => c.kind === 'chick').length === 3, '容量计数按实例统计（3 只小鸡），不受重叠影响');

  // 5×5 扩图后：栅栏内 3×3，每格都能落生
  const g5 = mkMap(5);
  const sp = CreatureSystem.spawnCreature(g5, 'chicken');
  const t = g5.map.fence[sp.row * g5.map.fenceRowCols + sp.col];
  check(!!sp && !!t && t.creatures.includes(sp.id), '5×5 生成后注册到正确的栅栏格（线性索引一致）', { row: sp?.row, col: sp?.col });
  check(g5.map.fence.length === 9, '5×5 栅栏 9 格可落生');
}

// ════════════════════════════════════════════════════════════
head('6. 半径表与「一格 6 只小鸡 / 4 只鸡」排布自洽');
{
  check(CREATURES.chick.radius === 1 / 6, '小鸡半径 0.167（1/6）', CREATURES.chick.radius);
  check(CREATURES.chicken.radius === 0.25, '鸡半径 0.25', CREATURES.chicken.radius);
  const slimes = Object.values(CREATURES).filter((d) => d.category === 'danger');
  check(slimes.length === 7, '史莱姆 7 变体');
  check(slimes.every((d) => d.radius === 0.25), '史莱姆半径统一 0.25（无依据，标注待定）');

  // 小鸡：3 列 × 2 行，格心间距 1/3 = 直径 2r → 相切不重叠，且全部圆在单位格内
  const rChick = CREATURES.chick.radius;
  const chickCenters = [];
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 3; col++) {
      chickCenters.push({ x: (col + 0.5) / 3, y: (row + 0.5) / 2 });
    }
  }
  let chickBad = 0;
  for (let i = 0; i < chickCenters.length; i++) {
    const p = chickCenters[i];
    if (p.x - rChick < -1e-9 || p.x + rChick > 1 + 1e-9 || p.y - rChick < -1e-9 || p.y + rChick > 1 + 1e-9) chickBad++;
    for (let j = i + 1; j < chickCenters.length; j++) {
      if (G.circleCenterDistance(p, chickCenters[j]) < 2 * rChick - 1e-9) chickBad++;
    }
  }
  check(chickCenters.length === 6 && chickBad === 0,
    '1 格可排 6 只小鸡（3×2，间距 1/3 = 直径，全部在内且不重叠）', chickBad);

  // 鸡：2×2，间距 0.5 = 直径
  const rHen = CREATURES.chicken.radius;
  const henCenters = [];
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 2; col++) {
      henCenters.push({ x: (col + 0.5) / 2, y: (row + 0.5) / 2 });
    }
  }
  let henBad = 0;
  for (let i = 0; i < henCenters.length; i++) {
    for (let j = i + 1; j < henCenters.length; j++) {
      if (G.circleCenterDistance(henCenters[i], henCenters[j]) < 2 * rHen - 1e-9) henBad++;
    }
  }
  check(henCenters.length === 4 && henBad === 0, '1 格可排 4 只鸡（2×2，间距 0.5 = 直径）', henBad);

  // 反证：若把鸡按 3 列排（9 只），间距 1/3 < 0.5 → 必然重叠，说明上限 4 自洽
  check(1 / 3 < 2 * rHen, '3 列排鸡必然重叠 → 鸡的上限必须是 2×2=4，与半径表一致');

  // 面积比交叉验证（圆面积 × 数量 ≈ 不超过格面积）
  check(6 * Math.PI * rChick * rChick < 1, '6 只小鸡总面积 < 1 格（面积比自洽）', 6 * Math.PI * rChick * rChick);
  check(4 * Math.PI * rHen * rHen < 1, '4 只鸡总面积 < 1 格（面积比自洽）', 4 * Math.PI * rHen * rHen);

  // 半径表按连续坐标可用：任意小数圆也能判定
  const gs = mkMap(3);
  const tiny = addCreature(gs, { id: 'tiny', kind: 'chick', pos: { x: 1.123, y: 1.456 } });
  check(G.creatureCircle(tiny).r === 1 / 6 && G.creatureCircle(tiny).x === 1.123,
    'creatureCircle 支持任意小数坐标并带正确半径', G.creatureCircle(tiny));
  check(G.creaturesInTileRect(gs, 0).length === 1, '小数坐标生物可被栅栏格查询命中');
}

// ════════════════════════════════════════════════════════════
head('7. nearestCreatureTo：默认 = 最近的存活敌人（中心点距离）');
{
  const gs = mkMap(5);
  const friendly = addCreature(gs, { id: 'friend', kind: 'chick', pos: { x: 1.2, y: 1.2 }, category: 'friendly' });
  const farEnemy = addCreature(gs, { id: 'enemy_far', kind: 'slime_fire', pos: { x: 4.2, y: 4.2 }, category: 'danger' });
  const nearEnemy = addCreature(gs, { id: 'enemy_near', kind: 'slime_water', pos: { x: 2.2, y: 2.2 }, category: 'danger' });

  const picked = G.nearestCreatureTo(gs, { x: 1.5, y: 1.5 });
  check(picked && picked.id === nearEnemy.id, '默认只在敌人中选最近（忽略更近的友方）', picked?.id);
  check(!friendly || picked.id !== friendly.id, '默认索敌不会选友方小鸡');

  const allPicked = G.nearestCreatureTo(gs, { x: 1.5, y: 1.5 }, { enemiesOnly: false });
  check(allPicked && allPicked.id === friendly.id, 'enemiesOnly:false 时才包含友方', allPicked?.id);

  const excluded = G.nearestCreatureTo(gs, { x: 1.5, y: 1.5 }, { excludeIds: [nearEnemy.id] });
  check(excluded && excluded.id === farEnemy.id, 'excludeIds 生效（排除近敌后选远敌）', excluded?.id);

  nearEnemy.hp = 0;
  const afterDeath = G.nearestCreatureTo(gs, { x: 1.5, y: 1.5 });
  check(afterDeath && afterDeath.id === farEnemy.id, '跳过已死亡生物', afterDeath?.id);
  nearEnemy.hp = 10;

  // 用中心点距离而不是格距：两个敌人分居两格但中心距离不同
  const a = addCreature(gs, { id: 'dist_a', kind: 'slime_ice', pos: { x: 3.05, y: 3.05 } });
  const b = addCreature(gs, { id: 'dist_b', kind: 'slime_grass', pos: { x: 3.9, y: 3.9 } });
  const p = { x: 3.0, y: 3.0 };
  const dA = G.circleCenterDistance(p, G.creatureCircle(a));
  const dB = G.circleCenterDistance(p, G.creatureCircle(b));
  check(dA < dB && G.nearestCreatureTo(gs, p).id === a.id,
    `最近判定按圆心直线距离（${dA.toFixed(3)} < ${dB.toFixed(3)}）`);
}

// ════════════════════════════════════════════════════════════
head('8. 逻辑快照位置 vs 渲染显示位置：冻结判定不冻结画面');
{
  const gs = mkMap(3);
  const c = addCreature(gs, { id: 'freeze', kind: 'chicken', pos: { x: 1.5, y: 1.5 }, radius: 0.25 });

  const snap = G.snapshotGeometry(gs);
  check(snap.__geometrySnapshot === true && snap.creatures.length === 1, '几何快照包含存活生物 1 只');
  const snapEntry = snap.creatures[0];
  check(snapEntry.x === 1.5 && snapEntry.y === 1.5 && snapEntry.radius === 0.25, '快照冻结逻辑圆心/半径');

  // 模拟结算期间：逻辑位置被冻结（快照不变），表现层仍在插值移动
  const snapHitBefore = G.creaturesInTiles(snap, [G.fenceTileRef(0, 0)]).length;
  c.pos = { x: 1.9, y: 1.5 };          // 逻辑继续推进（真实项目里由逻辑层写）
  c.renderPos = { x: 1.95, y: 1.6 };   // 渲染插值位置（表现层写）
  const snapHitAfter = G.creaturesInTiles(snap, [G.fenceTileRef(0, 0)]).length;
  check(snapHitBefore === 1 && snapHitAfter === 1, '快照查询不受之后的位置变化影响（结算冻结）');
  check(snap.creatures[0].x === 1.5, '快照内坐标保持冻结值，不随 live pos 改变');
  check(G.creatureCircle(c).x === 1.9 && G.creatureRenderCircle(c).x === 1.95,
    '逻辑圆用 pos、渲染圆用 renderPos，二者分离',
    { logic: G.creatureCircle(c), render: G.creatureRenderCircle(c) });

  const liveHit = G.creaturesInTiles(gs, [G.fenceTileRef(0, 0)]);
  check(liveHit.length === 1, 'live 查询读取最新逻辑位置（仍在栅栏域内）');
  const moved = G.creatureTileRefs(gs, c)[0];
  check(moved.row === 0 && moved.col === 0, '逻辑位置仍在 (0,0) 范围内');
}

// ════════════════════════════════════════════════════════════
head('9. 可用区域反算像素：3×3 不变形、5×5 不挤压');
{
  const avail = { availW: 1216, availH: 500 }; // 1280×720 减去 HUD 留白后的可用区
  const ts3 = G.computeTilePx({ ...avail, size: 3 });
  check(ts3 === 80, '3×3 反算 80px（与改造前一致）', ts3);
  check(3 * ts3 === 240, '3×3 地图边长 240px（与改造前一致）');

  const ts5 = G.computeTilePx({ ...avail, size: 5 });
  check(ts5 === 80, '5×5 反算仍取上限 80px（不压缩 3×3 视觉基准）', ts5);
  const map5 = 5 * ts5;
  check(map5 === 400 && map5 <= avail.availH && map5 <= avail.availW + 200,
    `5×5 地图 400px 不超出可用区（${avail.availW}×${avail.availH}）`, map5);

  // 栅栏偏移 = (外圈边长 - 栅栏边长) / 2 格 = 恒 1 格（原点 (1,1)）
  const fenceOffsetPx = G.FENCE_ORIGIN_X * ts5;
  check(fenceOffsetPx === 80, '5×5 栅栏左上偏移 = 1 格 = 80px', fenceOffsetPx);
  check((5 - 3) / 2 === 1, '栅栏居中关系恒成立：offset 格数 = 1（任意 size ≥ 3）');

  const ts8 = G.computeTilePx({ ...avail, size: 8 });
  check(ts8 === 62 && 8 * ts8 <= avail.availH, '8×8 大图自动缩小（62px，整图 496px ≤ 500px）', ts8);

  const small = G.computeTilePx({ availW: 400, availH: 260, size: 3 });
  check(small === 80 && small <= G.MAX_TILE_PX, '小窗口 3×3 仍取 80px（不放大）', small);
}

// ════════════════════════════════════════════════════════════
head('10. 旧存档迁移：补 pos / radius / renderPos / dir / targetPos');
{
  const gs = createInitialState();
  gs.creatures = [{
    id: 'old_creature', kind: 'chicken', hp: 100, row: 0, col: 0, category: 'friendly',
  }];
  const m = migrateGS(gs);
  const c = m.creatures[0];
  check(Number.isFinite(c.pos.x) && Number.isFinite(c.pos.y), '旧生物补连续坐标 pos', c.pos);
  check(c.pos.x === 1.5 && c.pos.y === 1.5, 'pos 回填为主格中心 (1.5,1.5)（栅栏原点 1,1）', c.pos);
  check(c.radius === 0.25, '旧生物按定义补 radius=0.25', c.radius);
  check(c.renderPos.x === c.pos.x && c.renderPos.y === c.pos.y, 'renderPos 与逻辑位置初始一致');
  check(Array.isArray([c.dir.x, c.dir.y]) && Number.isFinite(c.dir.x), 'dir 朝向已补默认值');
  check(c.targetPos === null, 'targetPos 已补 null（预留闲逛目标）');
  check(c.speedPerTile === CREATURES.chicken.speedPerTile, 'speedPerTile 按定义补齐', c.speedPerTile);
}

// ════════════════════════════════════════════════════════════
head('11. 祈福候选格输出逻辑坐标（像素换算只在 UI 层，无 80px 写死）');
{
  const gs = mkMap(5);
  gs.player.stamina = 8;
  gs.player.gold = 100;
  const bl = BlessSystem.blessStart(gs);
  check(bl.ok === true && bl.candidates.length === 16, '5×5 祈福候选 = 16 个外圈格', bl.candidates.length);

  const expected = G.tileCenter(gs, G.outerTileRef(4));
  const c4 = bl.candidates.find((c) => c.idx === 4);
  check(c4.x === expected.x && c4.y === expected.y,
    '候选格坐标 = 几何层格中心（逻辑坐标 4.5,0.5），不是像素值', c4);
  check(c4.x !== 4 * 80 + 40, '明确排除旧写死像素算法（4*80+40=360）');
  check(bl.candidates.every((c) => c.x < 5 && c.y < 5), '全部候选坐标都在 [0,size) 逻辑范围');
}

// ════════════════════════════════════════════════════════════
console.log(`\n──────── 几何层冒烟结果：${pass} 通过 / ${fail} 失败（共 ${pass + fail} 条断言） ────────`);
if (fail > 0) process.exitCode = 1;
