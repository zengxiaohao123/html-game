/**
 * systems/battle/ReactionEngine.js —— 元素附着状态机与反应（§4.4）
 *
 * 关键不变量：
 *   - 单单位至多 1 种附着；第二种附着瞬间查表反应；反应后清空。
 *   - 反应是最高优先级中断（仅次于战斗结束），用显式队列，禁止递归。
 *   - 反应触发者 = 施加第二种附着的单位。
 *   - 扩散：target→左→右顺序，连锁反应入队一圈后再处理。
 *   - 感电：可弹跳左/右 1 格至多 2 次；水附着目标倍率 40%。
 *
 * 本模块通过传入的 ctx（含 session、dealDamage、applyStatus、summon 等回调）
 * 与主引擎解耦，避免循环依赖。
 */

import { lookupReaction, STATUS } from '../../data/buffs.js';
import { ELEMENT_NAME } from '../../core/Const.js';
import { GameLog } from '../../core/Logger.js';
import { GE } from '../../core/GameEvents.js';
import { EventBus } from '../../core/EventBus.js';

/**
 * 施加元素附着的唯一入口。
 * @param {object} ctx
 * @param {BattleUnit} target
 * @param {string} element
 * @param {BattleUnit} applier 触发者/施加者
 */
export function applyAura(ctx, target, element, applier) {
  if (!target?.alive || !element) return;
  if (!target.aura) {
    target.aura = element;
    _emitAura(target);
    return { reacted: false };
  }
  if (target.aura === element) {
    // 同种：保持原附着，丢弃新的
    return { reacted: false, same: true };
  }

  const first = target.aura;
  const second = element;
  const reaction = lookupReaction(first, second);
  if (!reaction) {
    // 不可反应且不同：新附着取代
    target.aura = element;
    _emitAura(target);
    return { reacted: false, replaced: true };
  }

  // —— 触发反应：中断其他结算，立即执行；反应后清空该单位全部附着 ——
  EventBus.emit(GE.BATTLE_REACTION, { reaction: reaction.name, target: target.uid });
  GameLog.reaction('combat', `【${reaction.name}】触发于 ${target.name}（${ELEMENT_NAME[first]}+${ELEMENT_NAME[second]}）`);

  // 队列：先把"当前反应"做完，期间产生的新反应压入 pending
  ctx.reactionQueue = ctx.reactionQueue || [];
  resolveReaction(ctx, reaction, target, applier, first, second);

  target.aura = null;
  _emitAura(target);
  _drainReactionQueue(ctx);
  return { reacted: true, reaction: reaction.name };
}

function _emitAura(unit) {
  EventBus.emit(GE.BATTLE_AURA, { uid: unit.uid, aura: unit.aura });
}

/** 处理排队中的连锁反应（扩散一圈后再统一处理） */
function _drainReactionQueue(ctx) {
  const q = ctx.reactionQueue;
  while (q && q.length) {
    const job = q.shift();
    // 目标可能已死亡
    if (!job.target.alive) continue;
    resolveReaction(ctx, job.reaction, job.target, job.applier, job.first, job.second);
    job.target.aura = null;
    _emitAura(job.target);
  }
}

function enqueueReaction(ctx, reaction, target, applier, first, second) {
  ctx.reactionQueue.push({ reaction, target, applier, first, second });
}

/**
 * 执行单个反应效果。
 */
function resolveReaction(ctx, reaction, target, applier, first, second) {
  const { session: S, engine } = ctx;

  switch (reaction.id) {
    // ---------- 蒸发 / 融化：给触发者单次增伤 buff ----------
    case 'vaporizeFW':
      applier?.addOrRefreshStatus({ buffId: STATUS.vaporizeWater.id, duration: -1 });
      break;
    case 'vaporizeWF':
      applier?.addOrRefreshStatus({ buffId: STATUS.vaporizeFire.id, duration: -1 });
      break;
    case 'meltFI':
      applier?.addOrRefreshStatus({ buffId: STATUS.meltIce.id, duration: -1 });
      break;
    case 'meltIF':
      applier?.addOrRefreshStatus({ buffId: STATUS.meltFire.id, duration: -1 });
      break;

    // ---------- 燃烧 ----------
    case 'burn': {
      target.addOrRefreshStatus({ buffId: 'burn', duration: 3, keepLongest: true });
      break;
    }

    // ---------- 超载：自身+左右1格 受触发者50%基础攻 火属性伤害 ----------
    case 'overload': {
      const targets = engine.unitsSide1(target);
      for (const t of targets) {
        engine.dealPropertyDamage(applier, t, 'fire', 0.50, { ignoreAura: true });
      }
      break;
    }

    // ---------- 扩散：自身+左右1格 对应元素伤害（30%基础攻），连锁入队 ----------
    case 'spread_fire':
    case 'spread_water':
    case 'spread_thunder':
    case 'spread_ice': {
      const el = reaction.spread;
      S.counters.spread += 1;
      const ordered = engine.unitsSelfThenSide1Ordered(target); // self→left→right
      const pending = [];
      for (const t of ordered) {
        // 先造伤害
        engine.dealPropertyDamage(applier, t, el, 0.30, { ignoreAura: true });
        // 记录该目标是否会产生连锁（一圈后再结算）
        if (t.alive && t.aura && t.aura !== el) {
          const r2 = lookupReaction(t.aura, el);
          if (r2) pending.push({ reaction: r2, target: t, applier, first: t.aura, second: el });
        }
      }
      pending.forEach((p) => enqueueReaction(ctx, p.reaction, p.target, p.applier, p.first, p.second));
      break;
    }

    // ---------- 结晶：触发者获得自身HP上限8%护盾（至少10）；队友触发给主角 ----------
    case 'crystallize_fire':
    case 'crystallize_water':
    case 'crystallize_thunder':
    case 'crystallize_ice': {
      let who = applier;
      if (who?.role === 'companion') who = S.leader;
      if (who) {
        const shield = Math.max(10, Math.floor(who.stats.maxHp * 0.08));
        engine.gainShield(who, shield);
      }
      break;
    }

    // ---------- 绽放：施加者阵营随机空格召唤草史莱姆 ----------
    case 'bloom': {
      engine.summonGrassSlime(applier?.side || target.side);
      break;
    }

    // ---------- 感电：20%雷伤，弹跳至多2次；水附着目标40% ----------
    case 'electrocharged': {
      electroChain(ctx, target, applier);
      break;
    }

    // ---------- 冻结 2 回合 ----------
    case 'freeze': {
      if (!target.findStatus('freezeImmune')) {
        target.addOrRefreshStatus({ buffId: 'freeze', duration: 2 });
      }
      break;
    }

    // ---------- 激化：施加者阵营全体各 2 层（至多10） ----------
    case 'aggravate': {
      const side = applier?.side || 'ally';
      for (const u of S.livingBySide(side)) {
        u.addOrRefreshStatus({ buffId: 'aggravate', stackable: true, stacks: 2, maxStacks: 10, duration: -1 });
      }
      break;
    }

    // ---------- 超导：绑定地块（战斗态临时地块 debuff） ----------
    case 'superconduct': {
      engine.applySuperconductTile(target);
      break;
    }
  }
}

/** 感电弹跳（§4.4.5） */
function electroChain(ctx, firstTarget, applier) {
  const { engine, session: S } = ctx;
  let cur = firstTarget;
  const hit = new Set();
  const jumps = 2;
  for (let i = 0; i <= jumps; i++) {
    if (!cur?.alive) break;
    hit.add(cur.uid);
    const onWater = !!cur.aura; // 当前正附着水（含刚被施加的水）
    const mult = onWater ? 0.40 : 0.20;
    engine.dealPropertyDamage(applier, cur, 'thunder', mult, { ignoreAura: true });
    if (i === jumps) break;
    // 下一跳：当前目标左右 1 格的同阵营单位 + 自身，随机一名，允许重复
    const pool = engine.unitsSide1(cur).filter((u) => u.side === cur.side);
    cur = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
    if (!cur) break;
  }
}
