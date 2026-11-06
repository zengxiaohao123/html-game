// tools/smoke-effectbatch.mjs
// EffectBatch + PendingDeathQueue 冒烟脚本 ——《空间碰撞与时序方案》§2.5 / §3.5
// 覆盖：
//   1) 同一「技能实例 + 目标」重复登记只结算一次、倍率取最高（同一目标被两个地块命中）
//   2) 不同 key / 不同目标各自独立结算；hits 只在单次应用内循环（不按格放大）
//   3) buff 同「目标 + effectId」只应用一次，强度取最高、时长取最长；已存在同名 buff 不叠加
//   4) 死亡延迟到批次末：commit 不删实例，flush 才移除并只结算一次掉落
//   5) 同一实例多次入队只死一次；已死目标不再被结算（批次中途死亡 + 登记时已死）
//   6) 空批次 commit 安全；commit 后再登记 / 再 commit 抛错（批次不可复用）
// 用法：node tools/smoke-effectbatch.mjs

globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
};

import { createInitialState } from '../src/state/gameState.js';
import { EffectBatch, isTargetDead } from '../src/systems/EffectBatch.js';
import { PendingDeathQueue } from '../src/systems/PendingDeathQueue.js';
import { CombatSystem } from '../src/systems/CombatSystem.js';
import { EventBus } from '../src/core/EventBus.js';
import { GE } from '../src/core/GameEvents.js';

let pass = 0, fail = 0;
function check(cond, msg, extra) {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else {
    fail++;
    console.log(`  ❌ ${msg}${extra !== undefined ? `  ← ${JSON.stringify(extra)}` : ''}`);
  }
}
function head(t) { console.log(`\n═══ ${t} ═══`); }

function mkGS() {
  const gs = createInitialState();
  gs.creatures = [];
  gs.map.fence = [{ row: 0, col: 0, terrain: 'terrain_none', terrainAmount: 0, creatures: [], items: [] }];
  gs.player.atk = 10;
  return gs;
}

function addCreature(gs, id, hp = 100) {
  const c = { id, kind: 'chicken', hp, maxHp: hp, category: 'danger', activeBuffs: [], radius: 0.25 };
  gs.creatures.push(c);
  gs.map.fence[0].creatures.push(id);
  return c;
}

/** 确定性伤害结算（替代 CombatSystem.calculateDamage，避免随机暴击/闪避） */
function fakeResolver(calls) {
  return (opts) => {
    const dmg = Math.round(opts.atk * opts.skill.damageMultiplier);
    calls.push({ targetId: opts.defender.id, multiplier: opts.skill.damageMultiplier, dmg });
    opts.defender.hp -= dmg;
    if (opts.defender.hp < 0) opts.defender.hp = 0;
    return { finalDamage: dmg, dodged: false, immune: false, isCrit: false };
  };
}

// ────────────────────────────────────────────────────────────
head('1. 伤害去重：同「技能实例 + 目标 + key」只结算一次，倍率取最高');

{
  const gs = mkGS();
  const a = addCreature(gs, 'creature_1');
  const calls = [];
  const batch = new EffectBatch(gs, { sourceSkillId: 'SKL-A-012', phase: 'onEnter', resolveDamage: fakeResolver(calls) });

  batch.damage(a, 1.0, { element: 'physical' });
  batch.damage(a, 1.6, { element: 'physical' });  // 模拟"同一目标被两个地块命中"
  batch.damage(a, 1.4, { element: 'physical' });  // 更低的倍率不得覆盖更高的
  check(batch.size === 1, '三次登记合并为 1 个意图（同目标同 key）', batch.size);

  const s = batch.commit();
  check(s.damages.length === 1, 'commit 只应用 1 个伤害分组', s.damages);
  check(s.damages[0].multiplier === 1.6, '倍率取最高（1.6，不求和）', s.damages[0].multiplier);
  check(s.damages[0].appliedHits === 1, '只应用 1 次', s.damages[0].appliedHits);
  check(calls.length === 1, '结算函数只被调用 1 次（同一目标被两个地块命中只结算一次）', calls.length);
  check(a.hp === 84, '目标只掉一次最高倍率的血（100 - 16 = 84）', a.hp);
  check(s.damages[0].damage === 16, '摘要伤害 = 16', s.damages[0].damage);
}

head('2. 不同 key / 不同目标各自独立；hits 只在单次应用内循环');

{
  const gs = mkGS();
  const a = addCreature(gs, 'creature_1');
  const b = addCreature(gs, 'creature_2');
  const calls = [];
  const batch = new EffectBatch(gs, { sourceSkillId: 'SKL-A-009', resolveDamage: fakeResolver(calls) });

  batch.damage(a, 0.5, { hits: 2, element: 'physical' });   // 精巧射击：2 段 50%
  batch.damage(a, 0.5, { hits: 2, element: 'physical' });   // 重复登记不放大
  batch.damage(b, 0.5, { hits: 2, key: 'other', element: 'physical' });

  const s = batch.commit();
  check(s.damages.length === 2, 'a 的两条重复登记 + b 的不同 key → 2 个分组', s.damages.length);
  check(calls.length === 4, 'hits=2 只在单次应用内循环（2 组 × 2 段 = 4 次）', calls.length);
  check(a.hp === 90, 'a 掉 2 段 × 5 = 10', a.hp);
  check(b.hp === 90, 'b 掉 2 段 × 5 = 10', b.hp);

  // 不同技能实例（不同 instanceKey）命中同一目标 → 各自独立结算，不互相吞
  const gs2 = mkGS();
  const t = addCreature(gs2, 'creature_3');
  const calls2 = [];
  const b1 = new EffectBatch(gs2, { sourceSkillId: 'SKL-A-001', instanceKey: 'tile_0|SKL-A-001', resolveDamage: fakeResolver(calls2) });
  b1.damage(t, 1.0);
  b1.commit();
  const b2 = new EffectBatch(gs2, { sourceSkillId: 'SKL-A-001', instanceKey: 'tile_4|SKL-A-001', resolveDamage: fakeResolver(calls2) });
  b2.damage(t, 1.0);
  b2.commit();
  check(calls2.length === 2 && t.hp === 80, '不同技能实例（不同地块上的同名技能）各自结算', { calls: calls2.length, hp: t.hp });
}

// ────────────────────────────────────────────────────────────
head('3. buff 去重：同「目标 + effectId」只应用一次，强度取最高、时长取最长');

{
  const gs = mkGS();
  const a = addCreature(gs, 'creature_1');
  let calls = 0;
  const batch = new EffectBatch(gs, {
    sourceSkillId: 'SKL-A-011',
    applyBuff: (opts) => { calls++; return CombatSystem.applyBuff(opts); },  // 真实合并逻辑
  });

  batch.buff(a, 'weakened', { strength: 0.30, duration: 2 });
  batch.buff(a, 'weakened', { strength: 0.20, duration: 5 });  // 强度更低但时长更长
  batch.buff(a, 'weakened', { strength: 0.10, duration: 3 });

  const s = batch.commit();
  check(s.buffs.length === 1, '三次登记只产生 1 个 buff 分组', s.buffs);
  check(calls === 1, 'applyBuff 只被调用 1 次', calls);
  check(a.activeBuffs.length === 1, '目标身上只有 1 条同名 buff（不叠加）', a.activeBuffs.length);
  check(a.activeBuffs[0].params.strength === 0.30, '强度取最高 0.30', a.activeBuffs[0].params.strength);
  check(a.activeBuffs[0].remainingTurns === 5, '时长取最长 5', a.activeBuffs[0].remainingTurns);
  check(s.buffs[0].strength === 0.30 && s.buffs[0].duration === 5, '摘要记录最高强度 + 最长时长', s.buffs[0]);
}

{
  const gs = mkGS();
  const a = addCreature(gs, 'creature_1');
  a.activeBuffs = [{ id: 'vulnerable', creatureId: a.id, remainingTurns: 5, params: { strength: 0.40 } }];
  const batch = new EffectBatch(gs, { sourceSkillId: 'SKL-A-005' });
  batch.buff(a, 'vulnerable', { strength: 0.20, duration: 9 });
  const s = batch.commit();

  check(a.activeBuffs.length === 1, '已存在同名 buff → 不新增第二条', a.activeBuffs.length);
  check(a.activeBuffs[0].params.strength === 0.40, '已存在强度更高 → 不被低强度覆盖（取最高）', a.activeBuffs[0].params.strength);
  check(a.activeBuffs[0].remainingTurns === 9, '时长取最长（5 → 9）', a.activeBuffs[0].remainingTurns);
  check(s.buffs[0].refreshed === true, '摘要标记为刷新已存在 buff', s.buffs[0]);
}

// ────────────────────────────────────────────────────────────
head('4. 死亡延迟：commit 不删实例，flush 才移除且掉落只结算一次');

{
  const gs = mkGS();
  const a = addCreature(gs, 'creature_1', 10);
  const calls = [];
  let drops = 0;
  const dq = new PendingDeathQueue(gs, { grantKillDrops: () => { drops++; }, fireDefeatedHook: () => {}, onTalentDefeated: () => {} });
  const defeatedEvents = [];
  const onDefeat = (p) => defeatedEvents.push(p.creature.id);
  EventBus.on(GE.CREATURE_DEFEATED, onDefeat);

  const batch = new EffectBatch(gs, { sourceSkillId: 'SKL-A-001', resolveDamage: fakeResolver(calls), deathQueue: dq });
  batch.damage(a, 2.0);  // 10 hp 挨 20 → 归 0
  const s = batch.commit();

  check(a.hp === 0, '目标血量归 0', a.hp);
  check(dq.has(a), 'commit 时自动入队（deathQueue 注入）', dq.ids);
  check(gs.creatures.some(c => c.id === 'creature_1'), 'commit 阶段**没有**从 gs.creatures 删除', gs.creatures.length);
  check(gs.map.fence[0].creatures.includes('creature_1'), 'commit 阶段没有清栅栏格缓存', gs.map.fence[0].creatures);
  check(defeatedEvents.length === 0, 'commit 阶段未发 CREATURE_DEFEATED（延迟到批次末）', defeatedEvents);

  const f = dq.flush();
  check(f.empty === false && f.defeated.length === 1, 'flush 处理 1 只死亡', f);
  check(!gs.creatures.some(c => c.id === 'creature_1'), 'flush 后从 gs.creatures 移除', gs.creatures.length);
  check(!gs.map.fence[0].creatures.includes('creature_1'), 'flush 后清空栅栏格缓存', gs.map.fence[0].creatures);
  check(drops === 1, '击杀掉落只结算 1 次', drops);
  check(defeatedEvents.length === 1, 'CREATURE_DEFEATED 只在 flush 时发 1 次', defeatedEvents);

  // 二次 flush / 二次入队
  check(dq.markDead(a) === false, '同一实例重复 markDead 返回 false（只死一次）', dq.size);
  const f2 = dq.flush();
  check(f2.empty === true && f2.defeated.length === 0, '空队列二次 flush 安全', f2);
  check(drops === 1, '掉落不会被二次结算', drops);
  check(defeatedEvents.length === 1, 'CREATURE_DEFEATED 不会二次发送', defeatedEvents.length);
  EventBus.off(GE.CREATURE_DEFEATED, onDefeat);
}

// ────────────────────────────────────────────────────────────
head('5. 已死目标不再被结算：批次中途死亡 + 登记时已死');

{
  const gs = mkGS();
  const a = addCreature(gs, 'creature_1', 10);
  const calls = [];
  const dq = new PendingDeathQueue(gs, { grantKillDrops: () => {}, fireDefeatedHook: () => {}, onTalentDefeated: () => {} });
  // 先登记低倍率、再登记高倍率，两者是不同 key → commit 按登记顺序应用
  const batch = new EffectBatch(gs, { sourceSkillId: 'SKL-A-001', resolveDamage: fakeResolver(calls), deathQueue: dq });
  batch.damage(a, 2.0, { key: 'exact' });      // 先打死（20 > 10）
  batch.damage(a, 3.0, { key: 'overkill' });   // 后续同批次写入 → 必须跳过
  batch.buff(a, 'burn', { duration: 3 });      // 死者的 buff 也必须跳过

  const s = batch.commit();
  check(calls.length === 1, '目标中途死亡后，后续分组不再调用结算函数', calls.length);
  check(s.damages[1].skipped === 'target-dead', '后续伤害分组标记 skipped=target-dead', s.damages[1]);
  check(s.buffs[0].skipped === 'target-dead', '死亡目标的 buff 分组同样跳过', s.buffs[0]);
  check(s.skippedDead === 2, '摘要 skippedDead = 2', s.skippedDead);

  // 登记时已死（flush 之后）
  dq.flush();
  const calls2 = [];
  const b2 = new EffectBatch(gs, { sourceSkillId: 'SKL-A-002', resolveDamage: fakeResolver(calls2), deathQueue: dq });
  check(b2.damage(a, 1.0) === null, '登记已死目标 → 忽略（返回 null）', b2.size);
  check(b2.size === 0, '已死目标不进批次', b2.size);
  const s2 = b2.commit();
  check(s2.empty === true && s2.ignoredDead === 1, '空批次 commit 安全且记录 ignoredDead', s2);
  check(isTargetDead(a) === true, 'isTargetDead 判定已死实例', a.dead);
  check(dq.isAlive(a) === false, '死亡队列 isAlive = false（不再被结算）', a.dead);
}

// ────────────────────────────────────────────────────────────
head('6. 空批次 / 封存：commit 后不可复用');

{
  const gs = mkGS();
  let calls = 0;
  const batch = new EffectBatch(gs, { sourceSkillId: 'SKL-A-010', resolveDamage: () => { calls++; return { finalDamage: 0 }; } });
  const s = batch.commit();
  check(s.empty === true && s.damages.length === 0 && s.buffs.length === 0, '空批次 commit 返回 empty=true', s);
  check(calls === 0, '空批次不调用任何结算函数', calls);

  let threwDamage = false, threwBuff = false, threwCommit = false;
  try { batch.damage(addCreature(gs, 'creature_9'), 1.0); } catch { threwDamage = true; }
  try { batch.buff(addCreature(gs, 'creature_10'), 'burn', { duration: 1 }); } catch { threwBuff = true; }
  try { batch.commit(); } catch { threwCommit = true; }
  check(threwDamage === true, 'commit 后再登记伤害 → 抛错', threwDamage);
  check(threwBuff === true, 'commit 后再登记 buff → 抛错', threwBuff);
  check(threwCommit === true, '重复 commit → 抛错（批次不可复用）', threwCommit);
  check(batch.sealed === true, '批次已封存 sealed=true', batch.sealed);
}

console.log(`\n────────────────────────\n通过 ${pass} 条，失败 ${fail} 条`);
if (fail > 0) process.exit(1);
