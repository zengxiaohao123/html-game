// 阶段 2 冒烟：统一实时时钟 + 生物连续积分 + 逐帧渲染位置分离
// 用法：node tools/smoke-realtime.mjs
//
// 验收口径（用户裁定）：
//   - 连续积分：0.5s 位移约 0.5/speedPerTile 格；允许误差 = 1 个逻辑步的距离
//     （0.2/speedPerTile 格），因为 200ms 固定步长会把不足一步的余量留到下一帧。
//   - speedPerTile 单位为「秒/格」，区间 3~6。
//   - 方向为任意弧度；只被栅栏边界裁剪（圆心+半径不出栅栏）。
//   - 结算期间 pos 冻结、renderPos 继续推进；连携 8 秒窗口到期行为不变。

globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
};

import fs from 'node:fs';
import { createInitialState } from '../src/state/gameState.js';
import { CREATURES } from '../src/data/creatures.js';
import {
  CreatureSystem,
  MIN_SECONDS_PER_TILE,
  MAX_SECONDS_PER_TILE,
} from '../src/systems/CreatureSystem.js';
import { RealtimeClock, LOGIC_STEP_MS } from '../src/systems/RealtimeClock.js';
import { LinkSkillSystem, WINDOW_MS } from '../src/systems/LinkSkillSystem.js';
import { EventBus } from '../src/core/EventBus.js';
import { GE } from '../src/core/GameEvents.js';
import * as G from '../src/core/Geometry.js';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

let pass = 0, fail = 0;
function check(cond, msg, extra) {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else {
    fail++;
    console.log(`  ❌ ${msg}${extra !== undefined ? `  ← ${JSON.stringify(extra)}` : ''}`);
  }
}
function head(t) { console.log(`\n═══ ${t} ═══`); }
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/** 构造 size×size 外圈地图（栅栏内 = (size-2)²，原点恒 (1,1)） */
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

/** 放一只可控生物：直线闲逛参数（目标很远、不重选、不停顿） */
function addStraightCreature(gs, { id = 1, kind = 'chicken', pos, dir = 0, speed = null }) {
  const def = CREATURES[kind];
  const c = {
    id, kind, stage: 'adult', hp: 100, maxHp: 100, atk: 0,
    category: def.category,
    row: 0, col: 0,
    pos: { ...pos },
    renderPos: { ...pos },
    radius: def.radius,
    dir,
    speedPerTile: speed ?? def.speedPerTile,
    targetPos: { x: Math.cos(dir) * 100 + pos.x, y: Math.sin(dir) * 100 + pos.y },
    pauseLeft: 0,
    retargetLeft: 1e9, // 不触发重选，保证直线积分可测（单位：秒）
    growth: 0, growthMax: 0,
  };
  gs.creatures.push(c);
  return c;
}

// ════════════════════════════════════════════════════════════
head('1. 时钟结构：单一定时器 / 200ms 逻辑步 / 无第二逻辑 timer');
{
  check(LOGIC_STEP_MS === 200, '固定逻辑步长 = 200ms（设计文档 §18.3）', LOGIC_STEP_MS);
  check(WINDOW_MS === 8000, '连携窗口常量仍为 8000ms', WINDOW_MS);

  const gd = fs.readFileSync(`${ROOT}/src/systems/GameDirector.js`, 'utf8');
  const ui = fs.readFileSync(`${ROOT}/src/ui/LinkSkillUI.js`, 'utf8');
  const cs = fs.readFileSync(`${ROOT}/src/systems/CreatureSystem.js`, 'utf8');
  const rc = fs.readFileSync(`${ROOT}/src/systems/RealtimeClock.js`, 'utf8');
  check(!gd.includes('setInterval'), 'GameDirector 不再自建定时器（1000ms 轮询已合并）');
  check(!gd.includes('startRealtimeLoop'), 'GameDirector 不再调用旧生物 1000ms 循环');
  check(!ui.includes('setInterval'), 'LinkSkillUI 不再自建 200ms 定时器（改为时钟订阅）');
  check(!cs.includes('setInterval'), 'CreatureSystem 不再有移动定时器');
  check(rc.split('setInterval').length - 1 === 1, 'RealtimeClock 只有 1 个 setInterval（单一定时器）');
  check(rc.includes('LOGIC_STEP_MS = 200'), '时钟显式声明 200ms 逻辑步');
}

// ════════════════════════════════════════════════════════════
head('2. 连续积分：0.5s 位移 ≈ 0.5 / speedPerTile 格（容差 = 1 个逻辑步）');
{
  for (const kind of ['chick', 'chicken', 'slime_grass']) {
    const gs = mkMap(5);
    const c = addStraightCreature(gs, { id: 1, kind, pos: { x: 1.6, y: 2.5 }, dir: 0 });
    const clock = new RealtimeClock(() => gs);
    const speed = c.speedPerTile;
    const x0 = c.pos.x;

    clock.advance(500); // 500ms = 2 个整步(400ms) + 100ms 余量
    const moved = c.pos.x - x0;
    const expected = 0.5 / speed;
    const tol = 0.2 / speed; // 一个逻辑步的距离
    check(near(moved, expected, tol),
      `${kind}: 0.5s 位移 ${moved.toFixed(4)} 格 ≈ ${expected.toFixed(4)}（容差 ${tol.toFixed(4)} = 1 步）`,
      { moved, expected, tol });
    check(near(c.pos.y, 2.5, 1e-9), `${kind}: 直线闲逛不产生侧向漂移`, c.pos.y);
  }

  // 2.0s = 10 个整步，无余量，误差应更小
  const gs = mkMap(5);
  const c = addStraightCreature(gs, { pos: { x: 1.5, y: 2.5 }, dir: 0 });
  const clock = new RealtimeClock(() => gs);
  const x0 = c.pos.x;
  clock.advance(2000);
  const expected = 2.0 / c.speedPerTile;
  check(near(c.pos.x - x0, expected, 1e-9),
    `2.0s（10 个整步）位移精确 = 2/speed = ${expected.toFixed(4)} 格`, c.pos.x - x0);
}

// ════════════════════════════════════════════════════════════
head('3. 速度区间与方向：3~6 秒/格、任意弧度');
{
  for (const [kind, def] of Object.entries(CREATURES)) {
    check(def.speedPerTile >= MIN_SECONDS_PER_TILE && def.speedPerTile <= MAX_SECONDS_PER_TILE,
      `${kind}: speedPerTile=${def.speedPerTile} 秒/格 ∈ [3,6]`, def.speedPerTile);
  }

  const gs = mkMap(5);
  const dir = 1.2345; // 非四方向
  const c = addStraightCreature(gs, { pos: { x: 1.8, y: 2.0 }, dir });
  const clock = new RealtimeClock(() => gs);
  const dx = Math.cos(dir);
  const dy = Math.sin(dir);
  const p0 = { ...c.pos };
  clock.advance(400);
  const vx = c.pos.x - p0.x;
  const vy = c.pos.y - p0.y;
  check(Math.abs(vx) > 0.01 && Math.abs(vy) > 0.01, '方向 1.2345rad 同时产生 x/y 位移（任意方向）', { vx, vy });
  check(near(Math.atan2(vy, vx), dir, 1e-6), '实际位移角 = 设定弧度', Math.atan2(vy, vx));
  check(near(Math.hypot(vx, vy), 0.4 / c.speedPerTile, 1e-9), '位移模长 = 0.4s / speed', Math.hypot(vx, vy));
  check(dx !== 0 && dy !== 0, '方向分量均非 0（非四方向）');
}

// ════════════════════════════════════════════════════════════
head('4. 边界裁剪：圆心 + 半径不出栅栏（pos 与 renderPos 都夹）');
{
  const gs = mkMap(5); // 栅栏 [1,4]²，chicken r=0.25 → 合法圆心 [1.25,3.75]
  const c = addStraightCreature(gs, { pos: { x: 3.9, y: 2.5 }, dir: 0, speed: 3 });
  const clock = new RealtimeClock(() => gs);
  clock.advance(200); // 一步 0.0667 格 → 越界被夹到 3.75
  check(c.pos.x === 3.75, '右边界一步内被夹回 x=3.75（圆心+半径=4）', c.pos.x);

  const gs2 = mkMap(5);
  const c2 = addStraightCreature(gs2, { pos: { x: 1.3, y: 1.3 }, dir: Math.PI, speed: 3 });
  const clock2 = new RealtimeClock(() => gs2);
  let ok = true;
  for (let i = 0; i < 30; i++) {
    clock2.advance(200);
    const r = c2.radius;
    if (!(c2.pos.x >= 1 + r - 1e-9 && c2.pos.x <= 4 - r + 1e-9 &&
          c2.pos.y >= 1 + r - 1e-9 && c2.pos.y <= 4 - r + 1e-9 &&
          c2.renderPos.x >= 1 + r - 1e-9 && c2.renderPos.x <= 4 - r + 1e-9 &&
          c2.renderPos.y >= 1 + r - 1e-9 && c2.renderPos.y <= 4 - r + 1e-9)) { ok = false; break; }
  }
  check(ok, '连续 30 步（6s）随机游走后 pos/renderPos 始终在栅栏合法区', { pos: c2.pos, render: c2.renderPos });
}

// ════════════════════════════════════════════════════════════
head('5. 小鸡长大：半径 1/6 → 0.25 后圆心被夹回合法区');
{
  const gs = mkMap(3); // 1×1 栅栏 [1,2]² → 半径 0.25 后合法圆心 [1.25,1.75]
  const c = {
    id: 9, kind: 'chick', stage: 'chick', hp: 40, maxHp: 40, atk: 0, category: 'friendly',
    row: 0, col: 0,
    pos: { x: 1.17, y: 1.17 }, // 小鸡半径 1/6 时合法（1.1667）
    renderPos: { x: 1.17, y: 1.17 },
    radius: CREATURES.chick.radius,
    dir: 0, speedPerTile: CREATURES.chick.speedPerTile,
    targetPos: null, pauseLeft: 0, retargetLeft: 0,
    growth: 10, growthMax: 10, lastFed: true, mood: 0,
  };
  gs.creatures.push(c);
  CreatureSystem.dailyTick(gs);
  check(c.kind === 'chicken' && c.radius === 0.25, '成长后 kind=chicken / radius=0.25', { kind: c.kind, r: c.radius });
  check(c.pos.x === 1.25 && c.pos.y === 1.25, '长大越界后圆心被夹回 (1.25,1.25)', c.pos);
  check(c.renderPos.x === 1.25 && c.renderPos.y === 1.25, 'renderPos 同步夹回合法区', c.renderPos);
}

// ════════════════════════════════════════════════════════════
head('6. 重叠生物：完全重叠仍各自保留（不碰撞、不吞并）');
{
  const gs = mkMap(5);
  const a = addStraightCreature(gs, { id: 'a', pos: { x: 2.0, y: 2.0 }, dir: 0 });
  const b = addStraightCreature(gs, { id: 'b', pos: { x: 2.0, y: 2.0 }, dir: 0 });
  check(gs.creatures.length === 2, '同位置生成 2 只，列表保留 2 只', gs.creatures.length);
  check(a.renderPos !== b.renderPos, 'renderPos 是各自独立对象（不是共享引用）');
  const clock = new RealtimeClock(() => gs);
  clock.advance(400);
  check(gs.creatures.length === 2, '推进后仍是 2 只（不做分离/碰撞）', gs.creatures.length);
  const hits = G.creaturesInTileRect(gs, { row: 0, col: 0 });
  check(hits.length === 2, '同一格查询返回两只（按 id 各自计数）', hits.length);
}

// ════════════════════════════════════════════════════════════
head('7. 结算冻结：pos 不动、renderPos 继续、快照不可变');
{
  const gs = mkMap(5);
  const c = addStraightCreature(gs, { pos: { x: 1.8, y: 2.5 }, dir: 0, speed: 4.2 });
  const clock = new RealtimeClock(() => gs);

  clock.advance(400);
  const posBefore = { ...c.pos };
  const renderBefore = { ...c.renderPos };
  check(c.renderPos !== c.pos,
    'renderPos 与 pos 是两个独立对象（结算可只冻结 pos）', { pos: c.pos, render: c.renderPos });
  check(Number.isFinite(c.renderPos.x) && Number.isFinite(c.pos.x),
    '两者都按逻辑坐标推进（同一单位=格）', { pos: c.pos, render: c.renderPos });

  let snapshotPos = null;
  let froze = false;
  clock.runSettlement(gs, (snap) => {
    snapshotPos = { x: snap.creatures[0].x, y: snap.creatures[0].y };
    clock.advance(400); // 结算栈内：模拟真实时间经过
    froze = c.pos.x === posBefore.x && c.pos.y === posBefore.y;
    check(clock.settling === true, '结算栈内 settling=true（仅毫秒级同步栈）');
    check(froze, '结算期间逻辑 pos 不推进', c.pos);
    check(c.renderPos.x > renderBefore.x, '结算期间 renderPos 继续推进（画面不停）', c.renderPos);
    check(snap.creatures[0].x === posBefore.x && snap.creatures[0].y === posBefore.y,
      '判定读取的是结算开始时的不可变快照', { x: snap.creatures[0].x, y: snap.creatures[0].y });
  });
  check(clock.settling === false, '结算结束 settling 立即复位（不延长到动画/面板）');
  check(snapshotPos.x === posBefore.x, '快照不随结算内推进而变（快照坐标保持）', snapshotPos);

  clock.advance(400);
  check(c.pos.x > posBefore.x, '结算结束后逻辑积分恢复推进', c.pos.x);
}

// ════════════════════════════════════════════════════════════
head('8. 连携 8 秒窗口：时钟 200ms 步内到期判定与行为不变');
{
  const gs = mkMap(5);
  gs.team = gs.team || { groups: [{ roles: [] }], activeGroup: 0 };
  gs.team.groups[0].roles = ['xiayang'];
  gs.map.outerTiles[0].contentId = 'skill_link_xiayang_scorch';
  gs.linkSkillQueue = [];
  gs.linkSkillCooldowns = {};
  gs.linkSkillCounters = {};

  const realDateNow = Date.now;
  let fakeNow = 1_000_000;
  Date.now = () => fakeNow;
  try {
    const entry = LinkSkillSystem.enqueue(gs, { tileIdx: 0, skillId: 'skill_link_xiayang_scorch' });
    check(!!entry, '连携实例成功入队（用于窗口验证）', entry && entry.key);
    check(entry.expireAtMs - fakeNow === 8000, '成为队首后窗口 = 8000ms', entry.expireAtMs - fakeNow);

    const expiredEvents = [];
    const onExpire = (p) => expiredEvents.push(p);
    EventBus.on(GE.LINK_SKILL_EXPIRE, onExpire);
    const clock = new RealtimeClock(() => gs);

    // 7.8s：仍未到期
    for (let i = 0; i < 39; i++) { fakeNow += 200; clock.advance(200); }
    check(gs.linkSkillQueue.length === 1, '7.8s 时窗口仍在（200ms 步进 39 次）', gs.linkSkillQueue.length);
    check(expiredEvents.length === 0, '7.8s 未发过期事件');

    // 8.2s：到期并出队
    for (let i = 0; i < 2; i++) { fakeNow += 200; clock.advance(200); }
    check(gs.linkSkillQueue.length === 0, '8.2s 时窗口到期出队', gs.linkSkillQueue.length);
    check(expiredEvents.length === 1 && expiredEvents[0].triggered === false,
      '过期事件 1 次且 triggered=false（到期行为不变）', expiredEvents[0]);
    EventBus.off(GE.LINK_SKILL_EXPIRE, onExpire);
  } finally {
    Date.now = realDateNow;
  }
}

// ════════════════════════════════════════════════════════════
head('9. 旧档迁移：速度单位 格/秒 → 秒/格、dir 向量 → 弧度');
{
  const { migrateGS } = await import('../src/state/migrate.js');
  const gs = createInitialState();
  gs.creatures = [{
    id: 'legacy', kind: 'chicken', hp: 100, row: 0, col: 0, category: 'friendly',
    speedPerTile: 0.24, // 阶段 1 语义：格/秒
    dir: { x: 0, y: 1 },
  }];
  migrateGS(gs);
  const c = gs.creatures[0];
  check(near(c.speedPerTile, 1 / 0.24, 1e-9), '旧 0.24 格/秒 → 4.1667 秒/格', c.speedPerTile);
  check(c.speedPerTile >= 3 && c.speedPerTile <= 6, '迁移后速度仍在 3~6 秒/格', c.speedPerTile);
  check(near(c.dir, Math.PI / 2, 1e-9), '旧 dir 向量 (0,1) → 弧度 π/2', c.dir);
  check(typeof c.pauseLeft === 'number' && typeof c.retargetLeft === 'number', '补齐 pauseLeft/retargetLeft（秒，非墙钟字段）');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
