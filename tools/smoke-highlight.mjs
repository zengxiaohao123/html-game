// tools/smoke-highlight.mjs —— 技能卡所在地块高亮冒烟（Node + 最小 DOM 桩）
//
// 覆盖 v0.5 §16.3「技能卡所在地块高亮」三条规则：
//   1. 主动技能使用 → 对应地块红色高亮，1 秒后自动移除；
//   2. 连携技入队成为队首 → 对应地块金色持续高亮，非队首不高亮；
//   3. 连携技使用 → 金色瞬时高亮后恢复；拆卡 / 超时 → 金色消失。
//
// 用法：node tools/smoke-highlight.mjs

globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
};

const { createInitialState } = await import('../src/state/gameState.js');
const { registerFacilities } = await import('../src/data/facilities.js');
const { CreatureSystem } = await import('../src/systems/CreatureSystem.js');
const { SkillSystem } = await import('../src/systems/SkillSystem.js');
const { LinkSkillSystem } = await import('../src/systems/LinkSkillSystem.js');
const { EventBus } = await import('../src/core/EventBus.js');
const { GE } = await import('../src/core/GameEvents.js');
const { TileHighlight, TILE_FLASH_MS, linkSkillHeadTileIdx } = await import('../src/ui/TileHighlight.js');

let pass = 0, fail = 0;
function assert(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗', msg, extra !== undefined ? `→ ${JSON.stringify(extra)}` : ''); }
}
const head = (m) => console.log('\n— ' + m + ' —');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 最小地块节点桩（只实现 TileHighlight 用到的 classList）──
function makeTileEl(idx) {
  const cls = new Set();
  return {
    idx,
    classList: {
      add: (...cs) => cs.forEach((c) => cls.add(c)),
      remove: (...cs) => cs.forEach((c) => cls.delete(c)),
      toggle: (c, force) => {
        const on = force === undefined ? !cls.has(c) : !!force;
        if (on) cls.add(c); else cls.delete(c);
        return on;
      },
      contains: (c) => cls.has(c),
      has: (c) => cls.has(c),
    },
    has: (c) => cls.has(c),
    classes: cls,
  };
}

registerFacilities();
const gs = createInitialState();
gs.creatures = [];
gs.map.fence = [
  { row: 0, col: 0, creatures: [] },
  { row: 0, col: 1, creatures: [] },
];

const tileEls = new Map();
for (const t of gs.map.outerTiles) tileEls.set(t.idx, makeTileEl(t.idx));
const director = { getGS: () => gs };
const hl = new TileHighlight(director, { getTileEl: (i) => tileEls.get(i) || null });
hl.mount();

head('常量与初始态');
assert(TILE_FLASH_MS === 1000, '瞬时高亮时长常量 = 1 秒（可配置）', TILE_FLASH_MS);
assert(linkSkillHeadTileIdx(gs) === null, '空队列 → 无队首高亮');

// ════════════════════════════════════════════════════════════
head('① 主动技能使用 → 红色瞬时高亮（1 秒后移除）');
for (const t of gs.map.outerTiles) { t.contentId = null; t.contentState = {}; t.states = []; }
gs.map.outerTiles[6].contentId = 'facility_home';
gs.map.outerTiles[2].contentId = 'skill_yumo_slash';
gs.skillCooldowns = {};

const slime = CreatureSystem.spawnCreature(gs, 'slime_grass', {});
assert(!!slime, '围栏内生成了可攻击目标（史莱姆）');

let usedPayload = null;
EventBus.on(GE.SKILL_USED_ON_TILE, (p) => { usedPayload = p; });
gs.player.x = 2; // 走到技能卡所在地块触发【进入时】
SkillSystem.triggerSkillByHook('onEnter', { gs, tileIdx: 2 });

assert(!!usedPayload && usedPayload.tileIdx === 2, 'SkillSystem 发出「地块技能被使用」事件并带 tileIdx', usedPayload);
assert(tileEls.get(2).has('tile-hl-red'), '技能所在地块出现红色高亮');
assert(!tileEls.get(3).has('tile-hl-red'), '相邻地块不亮');

await sleep(TILE_FLASH_MS + 150);
assert(!tileEls.get(2).has('tile-hl-red'), `${TILE_FLASH_MS}ms 后红色高亮自动移除`);

// ════════════════════════════════════════════════════════════
head('② 连携技成为队首 → 金色持续高亮（只亮队首那一个实例）');
for (const t of gs.map.outerTiles) { t.contentId = null; t.contentState = {}; }
gs.map.outerTiles[6].contentId = 'facility_home';
gs.map.outerTiles[1].contentId = 'skill_link_shift';   // 同名实例 A
gs.map.outerTiles[4].contentId = 'skill_link_shift';   // 同名实例 B
LinkSkillSystem.onSkillCardPlaced(gs, 1, 'skill_link_shift');
LinkSkillSystem.onSkillCardPlaced(gs, 4, 'skill_link_shift');
gs.linkSkillQueue = [];
gs.linkSkillCooldowns = {};

const e1 = LinkSkillSystem.enqueue(gs, { tileIdx: 1, skillId: 'skill_link_shift' });
assert(!!e1, '实例 A 入队');
assert(LinkSkillSystem.enqueue(gs, { tileIdx: 4, skillId: 'skill_link_shift' }), '实例 B 入队（同名不同地块各自独立）');
assert(linkSkillHeadTileIdx(gs) === 1, '队首 = 实例 A 所在地块 1');
assert(tileEls.get(1).has('tile-hl-gold'), '队首地块金色持续高亮');
assert(!tileEls.get(4).has('tile-hl-gold'), '非队首的同名实例不高亮');

// ════════════════════════════════════════════════════════════
head('③ 连携技使用 → 金色瞬时高亮 + 队首前移');
const fire = LinkSkillSystem.fireCurrentQueueTop(gs);
assert(fire && fire.ok, '按 E 结算队首实例', fire);
assert(tileEls.get(1).has('tile-hl-gold-flash'), '被使用的地块出现金色瞬时高亮');
assert(!tileEls.get(1).has('tile-hl-gold'), '原队首的持续高亮立即撤下');
assert(linkSkillHeadTileIdx(gs) === 4 && tileEls.get(4).has('tile-hl-gold'), '新队首（地块 4）接着亮起');

await sleep(TILE_FLASH_MS + 150);
assert(!tileEls.get(1).has('tile-hl-gold-flash'), `${TILE_FLASH_MS}ms 后金色瞬时高亮恢复`);
assert(tileEls.get(4).has('tile-hl-gold'), '新队首持续高亮不受影响');

// ════════════════════════════════════════════════════════════
head('④ 拆卡 → 金色立即消失');
gs.map.outerTiles[4].contentId = 'facility_tent';   // 模拟拆卡/替换
LinkSkillSystem.onSkillCardRemoved(gs, 4, 'skill_link_shift');
EventBus.emit(GE.TILE_UPDATED, { tileIdx: 4 });
assert(linkSkillHeadTileIdx(gs) === null, '拆卡后队首无法定位（窗口作废）');
assert(!tileEls.get(4).has('tile-hl-gold'), '拆卡地块金色高亮立即消失');

// ════════════════════════════════════════════════════════════
head('⑤ 超时 → 金色消失');
gs.map.outerTiles[4].contentId = 'skill_link_shift';
LinkSkillSystem.onSkillCardPlaced(gs, 4, 'skill_link_shift');
assert(!!LinkSkillSystem.enqueue(gs, { tileIdx: 4, skillId: 'skill_link_shift' }), '重新放置后再次入队');
assert(tileEls.get(4).has('tile-hl-gold'), '队首金色高亮已亮起');
gs.linkSkillQueue[0].expireAtMs = Date.now() - 1;   // 模拟 8 秒窗口走完
LinkSkillSystem.pruneExpired(gs);
assert(linkSkillHeadTileIdx(gs) === null, '超时后队列清空');
assert(!tileEls.get(4).has('tile-hl-gold'), '超时地块金色高亮消失');

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
