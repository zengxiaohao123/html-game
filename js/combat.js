// =============================================================
// combat.js —— 战斗状态机（完全重写）
// 读取 03-战斗系统.md 规格
// 依赖：DATA（敌人静态表）、MAP、RULES、REACTIONS、UI
// =============================================================

// ---------------------------------------------------------------
// START_COMBAT —— 战斗入口
//   参数：当前 map、主角进入的地块坐标、战斗场景配置
// ---------------------------------------------------------------
let COMBAT = null;  // 全局战斗态实例

function START_COMBAT(map, heroX, heroY, scene) {
  if (!scene) {
    UI.toast('没有匹配的战斗场景。');
    return;
  }

  // 1. 快照主角状态
  const heroSnap = { ...G.hero };

  // 2. 快照地图 —— 深拷贝（保留地形 + 附着 + entities 为空数组）
  const mapCopy = {
    width: map.width,
    height: map.height,
    cells: map.cells.map(c => ({
      x: c.x, y: c.y,
      terrain: c.terrain,
      content: c.content ? { ...c.content } : null,
      attach: c.attach,
      entities: [],  // 进入战斗时地块上的实体以全新数组初始化
      isEnemySpawnPoint: false,
    })),
  };

  // 3. 隐藏所有 content 图标（保留数据）
  // 实现方式：给 cell.content._hidden = true 作为 UI 过滤标记
  for (const c of mapCopy.cells) {
    if (c.content) c.content._hidden = true;
  }

  // 4. 选敌人进攻点并标记
  const spawnPoints = MAP.pickEnemySpawnPoints(mapCopy, scene.spawnPointsAtStart, {
    preferNoOverlap: scene.spawnPointsAtStart >= 2,
  });
  MAP.markEnemySpawnPointsOnMap(mapCopy, spawnPoints);

  // 5. 构建 combatState
  COMBAT = {
    // 快照
    map: mapCopy,
    heroStart: { x: heroX, y: heroY, facing: G.hero.facing },
    heroSnap,
    scene,

    // 进攻点
    enemySpawnPoints: spawnPoints.map(p => ({ ...p })),

    // 实体池（统一管理所有实体：主角、队友、敌人、召唤物、中立）
    entities: [],
    heroEntity: null,

    // 状态机
    turn: 0,
    phase: 'roundStart',  // roundStart | playerManual | autoSkills | summons | neutral | enemy
    nodeTriggered: {},
    usedSkillThisTurn: {},
    usedMoveThisTurn: {},
    actionCount: 0,
    pendingLinks: [],
    linkActive: false,
    lingering: 0,
    activeEnemyIdx: 0,

    // 碰撞伤害
    collidedThisTurn: {},

    // 敌人临时行为数据（比如水泡延迟、自爆节点等）
    // 存到每个 enemy 的实例字段里，不需要单独结构

    ended: false,
  };

  // 6. 把主角实体放进去
  COMBAT.heroEntity = makeHeroEntity(heroX, heroY, G.hero.facing);
  COMBAT.entities.push(COMBAT.heroEntity);
  const heroCell = MAP.getCell(mapCopy, heroX, heroY);
  if (heroCell) heroCell.entities.push(COMBAT.heroEntity);

  // 7. UI 切换
  G.mode = 'combat';
  UI.switchMode('combat');
  UI.refreshCombat();

  UI.log(`进入战斗：${scene.label}`);

  // 8. 进入 roundStart
  combatGotoPhase('roundStart');
}

// ---------------------------------------------------------------
// makeHeroEntity —— 主角实体
// ---------------------------------------------------------------
function makeHeroEntity(x, y, facing) {
  return {
    key: 'pro',
    name: '主角',
    kind: 'hero',
    faction: 'player',
    x, y, facing,
    hp: G.hero.hp,
    maxHp: G.hero.maxHp,
    atk: G.hero.atk,
    def: G.hero.def,
    displayAtk: G.hero.atk,
    displayDef: G.hero.def,
    speed: G.hero.speed,
    shield: 0,
    buffs: [],
    debuffs: [],
    dead: false,
    skills: [], // 主角的技能组（后续接）
    talent: null,
  };
}

// ---------------------------------------------------------------
// makeSlimeEntity —— 根据史莱姆静态数据构造战斗实例
// ---------------------------------------------------------------
function makeSlimeEntity(element) {
  const base = DATA.SLIMES[element];
  if (!base) return null;

  // 天赋效果预处理
  let maxHp = base.maxHp;
  let def = base.def;
  if (base.talents) {
    for (const t of base.talents) {
      if (t.kind === 'newbieFriend' && G.day <= t.days) {
        maxHp -= t.maxHpPenalty;
      }
      if (t.kind === 'rockShield') {
        def += t.param.defBonus || 10;  // 岩盾加 def
      }
    }
  }

  const el = {
    key: `${base.key}_${Math.random().toString(36).slice(2, 8)}`,
    name: base.name,
    kind: 'enemy',
    faction: 'enemy',
    element,
    x: 0, y: 0, facing: 'up',
    hp: maxHp, maxHp,
    atk: base.atk,
    def,
    displayAtk: base.atk,
    displayDef: def,
    speed: base.speed,
    shield: 0,
    buffs: [],
    debuffs: [],
    dead: false,
    talents: base.talents || [],
    uniqueSkills: base.uniqueSkills || [],
    moveLogic: base.moveLogic || { kind: 'hop', defaultDir: 'cw' },
    onDeath: base.onDeath || null,
    elementImmune: [], // 从 affinity 天赋提取
    uniqueCd: {},      // 每只史莱姆独有的技能冷却状态 { skillKey: 剩余回合 }
    // 冰雾持续中的剩余回合数
    iceFogRemaining: 0,
    // 水泡延迟（下一次自己行动时先结算）
    waterBubblePending: null,
    // 自爆倒计时（行动节点挂在节点里，不是这里）
  };

  // 元素亲和提取
  if (el.talents && el.talents.some(t => t.kind === 'affinity')) {
    const aff = DATA.SLIME_AFFINITIES[element];
    if (aff) el.elementImmune.push(aff.element);
    if (aff && aff.extraImmune) el.elementImmune.push(...aff.extraImmune);
  }

  return el;
}


// ---------------------------------------------------------------
// 状态机主控
// ---------------------------------------------------------------
function combatGotoPhase(phase) {
  if (!COMBAT) return;
  COMBAT.phase = phase;
  UI.refreshCombat();

  switch (phase) {
    case 'roundStart':      return phaseRoundStart();
    case 'playerManual':    return;  // 等待玩家输入
    case 'autoSkills':      return phaseAutoSkills();
    case 'summons':         return phaseSummons();
    case 'neutral':         return phaseNeutral();
    case 'enemy':           return phaseEnemy();
  }
}

// ---------------------------------------------------------------
// roundStart —— 回合开始
// ---------------------------------------------------------------
function phaseRoundStart() {
  COMBAT.turn += 1;

  // 重置本回合标记
  COMBAT.nodeTriggered = {};
  COMBAT.usedSkillThisTurn = {};
  COMBAT.usedMoveThisTurn = {};
  COMBAT.actionCount = 0;
  COMBAT.collidedThisTurn = {};

  // 敌人生成：从每个进攻点生成本回合敌人（默认每点 1 只；前 N 回合）
  const scene = COMBAT.scene;
  const gen = scene.enemyGeneration;
  if (gen && COMBAT.turn <= gen.turns) {
    for (const sp of COMBAT.enemySpawnPoints) {
      for (let i = 0; i < gen.perTurn; i++) {
        // 7 种元素独立随机
        const pool = gen.fromPool;
        const element = pool[Math.floor(Math.random() * pool.length)];
        const el = makeSlimeEntity(element);
        if (!el) continue;
        el.x = sp.x; el.y = sp.y;
        const cell = MAP.getCell(COMBAT.map, sp.x, sp.y);
        if (cell) cell.entities.push(el);
        COMBAT.entities.push(el);
        UI.log(`${el.name} 从敌人进攻点出现。`);
      }
    }
  }

  // 主角自动朝向最近的敌人（视觉）
  autoFaceNearestEnemy();

  UI.refreshCombat();
  combatGotoPhase('playerManual');
}

// ---------------------------------------------------------------
// playerManual —— 等待玩家输入（由 UI 层事件驱动）
// ---------------------------------------------------------------
function tryCombatMove(dir) {
  if (!COMBAT || COMBAT.phase !== 'playerManual' || COMBAT.ended) return;

  const hero = COMBAT.heroEntity;
  if (hasHardControl(hero)) {
    UI.toast('被控制，无法行动。');
    return;
  }

  COMBAT.actionCount += 1;
  COMBAT.usedMoveThisTurn['pro'] = true;

  triggerNodeIfFirstTime('pro');

  // 更新朝向
  hero.facing = dir;

  const target = RULES.adjacent(hero.x, hero.y, dir);
  if (!RULES.passable(COMBAT.map, target.x, target.y)) {
    UI.toast('朝向目标格不可通行。');
    UI.refreshCombat();
    return;
  }

  const oldCell = MAP.getCell(COMBAT.map, hero.x, hero.y);
  const newCell = MAP.getCell(COMBAT.map, target.x, target.y);
  if (oldCell) oldCell.entities = oldCell.entities.filter(e => e.key !== hero.key);
  hero.x = target.x; hero.y = target.y;
  if (newCell) newCell.entities.push(hero);

  UI.refreshCombat();
  maybeStartLingeringOrAdvance();
}

function tryCombatSkip() {
  if (!COMBAT || COMBAT.phase !== 'playerManual' || COMBAT.ended) return;
  const hero = COMBAT.heroEntity;
  if (hasHardControl(hero)) { UI.toast('被控制，无法行动。'); return; }

  COMBAT.actionCount += 1;
  COMBAT.usedMoveThisTurn['pro'] = true;
  triggerNodeIfFirstTime('pro');

  UI.refreshCombat();
  maybeStartLingeringOrAdvance();
}

// ---------------------------------------------------------------
// 残存时间 / 进入下一阶段
// ---------------------------------------------------------------
function maybeStartLingeringOrAdvance() {
  if (anyAliveCharNotUsedSkill()) {
    COMBAT.lingering = 1000;
    startLingeringTimer();
  } else {
    combatGotoPhase('autoSkills');
  }
}
function anyAliveCharNotUsedSkill() {
  // 主角方（主角 + 队友）谁还有技能次数 → 简化：先只看主角
  // 队友后续接
  return !COMBAT.usedSkillThisTurn['pro'];
}

function startLingeringTimer() {
  // 简单定时器，UI 上渲染 countdown
  const start = Date.now();
  const tick = () => {
    if (!COMBAT || COMBAT.ended) return;
    const elapsed = Date.now() - start;
    COMBAT.lingering = Math.max(0, 1000 - elapsed);
    UI.refreshCombat();
    if (COMBAT.lingering <= 0) {
      combatGotoPhase('autoSkills');
    } else {
      setTimeout(tick, 100);
    }
  };
  setTimeout(tick, 100);
}


// ---------------------------------------------------------------
// autoSkills / summons / neutral —— 自动执行阶段
// 目前暂只实现 autoSkills（主角方自动技能），summons / neutral 留空
// ---------------------------------------------------------------
function phaseAutoSkills() {
  // 注：主角技能组目前还没完全接好，先空转；后续接技能数据
  combatGotoPhase('summons');
}
function phaseSummons() {
  combatGotoPhase('neutral');
}
function phaseNeutral() {
  combatGotoPhase('enemy');
}

// ---------------------------------------------------------------
// enemy —— 敌方回合
// ---------------------------------------------------------------
function phaseEnemy() {
  const aliveEnemies = COMBAT.entities
    .filter(e => !e.dead && e.faction === 'enemy')
    .sort((a, b) => (a.x + a.y) - (b.x + b.y) || a.key.localeCompare(b.key));

  if (aliveEnemies.length === 0) {
    // 敌人全灭 → 检查自爆/风旋等天赋
    checkBattleEndConditions();
    if (!COMBAT.ended) {
      // 可能有自爆中立单位还在，等它爆炸
    }
    tickAllCooldowns();
    combatGotoPhase('roundStart');
    return;
  }

  COMBAT.activeEnemyIdx = 0;
  runEnemyAtIndex(aliveEnemies, 0);
}

function runEnemyAtIndex(aliveEnemies, i) {
  if (!COMBAT || COMBAT.ended) return;
  if (i >= aliveEnemies.length) {
    // 敌方回合全部执行完
    tickAllCooldowns();
    // 雷史莱姆导电：它自己回合结束时触发
    for (const el of COMBAT.entities) {
      if (el.dead) continue;
      const ts = el.talents || [];
      const cond = ts.find(t => t.kind === 'conductive');
      if (cond && Math.random() < cond.param.chance) {
        triggerConductive(el, cond.param);
      }
    }
    combatGotoPhase('roundStart');
    return;
  }

  const enemy = aliveEnemies[i];

  // 先触发行动节点（节点里扣冻结/束缚持续时间）
  triggerNode(enemy.key);

  // 硬控检查（节点扣完后）
  if (hasHardControl(enemy)) {
    UI.log(`${enemy.name} 被控制，无法行动。`);
    setTimeout(() => runEnemyAtIndex(aliveEnemies, i + 1), 200);
    return;
  }

  // 如果有水泡挂起 → 先结算水泡（下一次自己行动时落下）
  if (enemy.waterBubblePending) {
    resolveWaterBubble(enemy);
  }

  // 执行敌方 AI
  enemyAI(enemy, (nextStep) => {
    // AI 内部完成后，进入下一个敌人
    runEnemyAtIndex(aliveEnemies, i + 1);
  });
}

// ---------------------------------------------------------------
// tickAllCooldowns —— 敌方回合末尾统一扣冷却
// ---------------------------------------------------------------
function tickAllCooldowns() {
  for (const el of COMBAT.entities) {
    if (el.uniqueCd) {
      for (const k of Object.keys(el.uniqueCd)) {
        if (el.uniqueCd[k] > 0) el.uniqueCd[k] -= 1;
      }
    }
    // 自爆节点：fireSlimeExplosion
    if (el.fireSlimeExplosion && el.fireSlimeExplosion.nodeKey) {
      // 自爆挂在 el.buffs 里，duration 在每个 nodeTrigger 时自动 -1
    }
  }
}


// ---------------------------------------------------------------
// enemyAI —— 敌方 AI 主控
// ---------------------------------------------------------------
function enemyAI(enemy, done) {
  // 如果冰雾持续中 → 不移动不放技能，直接放冰雾
  if (enemy.iceFogRemaining > 0) {
    castIceFog(enemy);
    enemy.iceFogRemaining -= 1;
    if (enemy.iceFogRemaining === 0) {
      // 冰雾结束，进入冷却
      enemy.uniqueCd['iceFog'] = 5;
    }
    setTimeout(done, 400);
    return;
  }

  // 水史莱姆：水泡优先使用；用了本回合不移动
  if (enemy.element === 'water') {
    const cd = enemy.uniqueCd['waterBubble'] || 0;
    if (cd === 0) {
      castWaterBubble(enemy);
      setTimeout(done, 400);
      return;
    }
  }

  // 草史莱姆：破土而出（当周围 4 格没有我方、且冷却好了时）
  if (enemy.element === 'grass') {
    const cd = enemy.uniqueCd['grassBlink'] || 0;
    if (cd === 0) {
      castGrassBlink(enemy);
      enemy.uniqueCd['grassBlink'] = 1;  // 每 1 回合可放一次（等你后续确认冷却值）
      setTimeout(done, 400);
      return;
    }
  }

  // 默认：蹦蹦跳跳移动
  hop(enemy, () => {
    // 移动后施加元素附着（如果有 affinity 天赋）
    applyAffinityAttach(enemy);
    setTimeout(done, 200);
  });
}

// ---------------------------------------------------------------
// 蹦蹦跳跳 —— 顺时针 / 逆时针前进 1 格
//   参数 enemy.moveLogic.defaultDir = 'cw' 或 'ccw'
//   拐弯按当前顺/逆时针方向；特殊情况走不动改为随便走一步
//   受我方伤害后，受击时切换方向（在 takeDamage 里处理）
// ---------------------------------------------------------------
function hop(enemy, done) {
  const from = { x: enemy.x, y: enemy.y };
  const map = COMBAT.map;
  const dir = enemy.moveLogic.currentDir || enemy.moveLogic.defaultDir;

  const target = RULES.stepLoopCell(map, enemy.x, enemy.y, dir);
  // 如果 stepLoopCell 返回的是原地（当前格不在外圈），兜底朝主角方向走一步
  let final = target;
  if (target.x === enemy.x && target.y === enemy.y) {
    final = hopFallback(enemy);
  }
  // 如果目标不可通行（void），兜底
  if (!RULES.passable(map, final.x, final.y)) {
    final = hopFallback(enemy);
  }

  // 执行移动
  enemy.facing = dir === 'cw' ? stepLoopCellToFacing(enemy, final) : stepLoopCellToFacing(enemy, final);
  moveEnemyCell(enemy, final.x, final.y);

  // 碰撞伤害检测（每一步经过 + 最终停留）
  checkCollisionAfterMove(enemy, from, final);

  setTimeout(done, 200);
}

function hopFallback(enemy) {
  const dirs = ['up', 'down', 'left', 'right'];
  for (const d of dirs) {
    const t = RULES.adjacent(enemy.x, enemy.y, d);
    if (RULES.passable(COMBAT.map, t.x, t.y)) return t;
  }
  return { x: enemy.x, y: enemy.y };
}

function stepLoopCellToFacing(enemy, target) {
  // 只是把朝向更新为移动方向，UI 显示用
  if (target.x > enemy.x) return 'right';
  if (target.x < enemy.x) return 'left';
  if (target.y > enemy.y) return 'down';
  if (target.y < enemy.y) return 'up';
  return enemy.facing;
}

function moveEnemyCell(enemy, toX, toY) {
  const oldCell = MAP.getCell(COMBAT.map, enemy.x, enemy.y);
  const newCell = MAP.getCell(COMBAT.map, toX, toY);
  if (oldCell) oldCell.entities = oldCell.entities.filter(e => e.key !== enemy.key);
  enemy.x = toX; enemy.y = toY;
  if (newCell) newCell.entities.push(enemy);
}

// ---------------------------------------------------------------
// 碰撞伤害 —— 敌人移动后触发
//   经过的每一格 + 最终停留格，是主角当前所在格就触发
//   敌人每回合限 1 次（collidedThisTurn 标记）
// ---------------------------------------------------------------
function checkCollisionAfterMove(enemy, from, to) {
  if (COMBAT.collidedThisTurn[enemy.key]) return;
  const hero = COMBAT.heroEntity;

  // 移动前已在主角格原地不动 → 不触发
  if (from.x === hero.x && from.y === hero.y &&
      to.x === hero.x && to.y === hero.y) {
    return;
  }

  const heroPos = { x: hero.x, y: hero.y };
  if (to.x === heroPos.x && to.y === heroPos.y) {
    // 最终停留 = 主角格 → 触发
    dealCollisionDamage(enemy, hero);
  } else {
    // 经过（这里 hop 只有一步，但代码结构预留多步）
    // 因为 hop 只有一步，这种情况不会触发；但保留结构
  }
}

function dealCollisionDamage(enemy, hero) {
  const damage = enemy.atk;  // 100% 攻击力，物理伤害
  UI.log(`${enemy.name} 撞到了你，造成 ${damage} 点伤害！`);
  dealRawDamage(hero, damage, 'physical');
  COMBAT.collidedThisTurn[enemy.key] = true;
  UI.refreshCombat();
  checkBattleEndConditions();
}


// ---------------------------------------------------------------
// 敌方独有技能/天赋执行
// ---------------------------------------------------------------

// 草史莱姆 · 破土而出
function castGrassBlink(enemy) {
  // 找最近我方
  const hero = COMBAT.heroEntity;
  // 瞬移到 hero 周围 4 格随机 1 格
  const candidates = [];
  for (let dx = -4; dx <= 4; dx++) {
    for (let dy = -4; dy <= 4; dy++) {
      if (Math.abs(dx) + Math.abs(dy) > 4) continue;
      const tx = hero.x + dx, ty = hero.y + dy;
      if (RULES.passable(COMBAT.map, tx, ty) && !(tx === hero.x && ty === hero.y)) {
        candidates.push({ x: tx, y: ty });
      }
    }
  }
  if (candidates.length === 0) return;
  const t = candidates[Math.floor(Math.random() * candidates.length)];
  moveEnemyCell(enemy, t.x, t.y);

  // 对周围 4 格造成 75% ATK 草元素伤害
  const affected = collectEntitiesInChebyshevRange(COMBAT.map, t.x, t.y, 4);
  for (const e of affected) {
    if (e.faction === 'player') {
      dealElementalDamage(e, enemy.atk * 0.75, 'grass');
    }
  }
  UI.log(`${enemy.name} 破土而出，周围传来草元素冲击波。`);
}

// 水史莱姆 · 水泡
function castWaterBubble(enemy) {
  const hero = COMBAT.heroEntity;
  // 标记：下一次 enemy 自己行动时先结算水泡（落在 hero 当前格）
  enemy.waterBubblePending = { targetX: hero.x, targetY: hero.y, duration: 2 };
  enemy.uniqueCd['waterBubble'] = 4;
  UI.log(`${enemy.name} 向水泡抛出。`);
}

function resolveWaterBubble(enemy) {
  const bb = enemy.waterBubblePending;
  if (!bb) return;
  enemy.waterBubblePending = null;

  const cell = MAP.getCell(COMBAT.map, bb.targetX, bb.targetY);
  if (!cell || cell.entities.length === 0) {
    UI.log(`水泡打空了。`);
    return;
  }
  // 对该格所有单位触发禁锢（敌我都有效）
  for (const ent of cell.entities) {
    if (ent.key === enemy.key) continue;
    ent.buffs.push({ kind: 'bind', name: '禁锢', duration: bb.duration });
    UI.log(`${ent.name} 被水泡禁锢了 ${bb.duration} 回合。`);
  }
}

// 雷史莱姆 · 导电（它自己回合结束时触发）
function triggerConductive(enemy, param) {
  const affected = collectEntitiesInChebyshevRange(COMBAT.map, enemy.x, enemy.y, param.range);
  UI.log(`${enemy.name} 的导电触发了！`);
  for (const e of affected) {
    if (e.key === enemy.key) continue;
    if (e.elementImmune && e.elementImmune.includes('thunder')) continue;
    dealElementalDamage(e, enemy.atk * param.mult, 'thunder');
  }
  // 导电不分敌我，也能施加附着（由 dealElementalDamage 内部处理）
}

// 冰史莱姆 · 冰雾
function castIceFog(enemy) {
  // 前方 3 格：沿主角朝向？不，冰雾是史莱姆自己释放的，按史莱姆当前朝向（蹦蹦跳跳方向）
  // 简化：沿 hero 朝向（和所有技能 owner 指向 hero 朝向统一）
  const hero = COMBAT.heroEntity;
  const cellsInFront = rangeFront(COMBAT.map, enemy.x, enemy.y, hero.facing, 3);
  UI.log(`${enemy.name} 喷出冰雾！`);
  for (const cell of cellsInFront) {
    for (const ent of cell.entities) {
      if (ent.faction === 'player') {
        dealElementalDamage(ent, enemy.atk * 0.8, 'ice');
      }
    }
  }
}

// 元素亲和天赋：移动后为所在地块施加本元素附着
function applyAffinityAttach(enemy) {
  const aff = enemy.talents.find(t => t.kind === 'affinity');
  if (!aff) return;
  const cell = MAP.getCell(COMBAT.map, enemy.x, enemy.y);
  if (!cell) return;
  // 施加元素附着（如果已有附着 → 触发元素反应）
  applyOrReactAttachment(cell, aff.element);
}

// ---------------------------------------------------------------
// 死亡处理（onDeath）
// ---------------------------------------------------------------
function handleSlimeDeath(slime) {
  if (!slime.onDeath) return;
  if (slime.onDeath.kind === 'selfDestruct') {
    // 生成"即将爆炸的火史莱姆"—— 中立阵营，不视为敌人
    // 挂一个 duration = 2 的 buff 在自身（作为延迟爆炸的行动节点）
    const selfDestruct = {
      key: `fire_bomb_${Math.random().toString(36).slice(2, 8)}`,
      name: '即将爆炸的火史莱姆',
      kind: 'summon',
      faction: 'neutral',
      x: slime.x, y: slime.y, facing: 'up',
      hp: 1, maxHp: 1,
      atk: slime.atk, def: 0,
      displayAtk: slime.atk, displayDef: 0,
      speed: 0,
      shield: 0,
      buffs: [],
      debuffs: [],
      dead: false,
      // 挂自爆行动节点（通过 buff duration 扣减 + triggerNode 触发）
      // 为了简单：挂一个 buff { kind: 'selfDestructTimer', duration: 2, trigger: explosion }
      selfDestruct: slime.onDeath,
    };
    // 挂一个节点缓冲（不是真正 triggerNode 里写，而是在 phaseEnemy 前统一走一遍中立 AI 触发）
    selfDestruct.selfDestructTimer = 2;

    COMBAT.entities.push(selfDestruct);
    const cell = MAP.getCell(COMBAT.map, slime.x, slime.y);
    if (cell) cell.entities.push(selfDestruct);

    UI.log(`${slime.name} 死亡，原地变成了「即将爆炸的火史莱姆」！`);
  }

  if (slime.onDeath.kind === 'windSwirl') {
    // 风旋：战斗未结束（还有敌方存活）才触发
    const aliveEnemies = COMBAT.entities.filter(e => !e.dead && e.faction === 'enemy' && e.key !== slime.key);
    if (aliveEnemies.length === 0) {
      UI.log(`${slime.name} 倒下，风旋在空气中消散。`);
      return;
    }
    triggerWindSwirl(slime);
  }
}

function triggerWindSwirl(slime) {
  const param = slime.onDeath.param;
  const candidates = [];
  for (const dx = -param.range; dx <= param.range; dx++) {
    for (const dy = -param.range; dy <= param.range; dy++) {
      if (Math.abs(dx) + Math.abs(dy) > param.range) continue;
      if (dx === 0 && dy === 0) continue;
      const tx = slime.x + dx, ty = slime.y + dy;
      if (RULES.inBounds(COMBAT.map, tx, ty) && RULES.passable(COMBAT.map, tx, ty)) {
        candidates.push({ x: tx, y: ty });
      }
    }
  }
  if (candidates.length === 0) return;
  const pick = candidates[Math.floor(Math.random() * candidates.length)];

  UI.log(`${slime.name} 释放风旋！`);

  // 传送选中格子所有单位到 slime 位置
  const cellFrom = MAP.getCell(COMBAT.map, pick.x, pick.y);
  const cellTo = MAP.getCell(COMBAT.map, slime.x, slime.y);
  if (!cellFrom || !cellTo) return;

  const moved = [...cellFrom.entities];
  // 移动
  cellFrom.entities = [];
  for (const e of moved) {
    e.x = slime.x; e.y = slime.y;
    cellTo.entities.push(e);
    // 独立判断：我方阵营额外造 40% ATK 风伤
    if (e.faction === 'player') {
      dealElementalDamage(e, slime.atk * param.mult, 'wind');
    }
  }
}


// ---------------------------------------------------------------
// 伤害 / 附着 / 元素反应（元素反应直接复用 REACTIONS 模块）
// ---------------------------------------------------------------
function dealRawDamage(target, damage, type) {
  if (!target || target.dead) return 0;

  // 护盾优先（任何无特殊说明的伤害都被护盾挡）
  if (target.shield > 0) {
    const absorbed = Math.min(target.shield, damage);
    target.shield -= absorbed;
    damage -= absorbed;
  }

  // 结算 clamp 0 ~ maxHp
  damage = Math.max(0, damage);
  target.hp -= damage;
  if (target.hp <= 0) {
    target.hp = 0;
    target.dead = true;
    // 岩盾触发：每次被命中（不管是否扣 HP）def -1
    RULES.onHitRockShield(target);
    handleDeath(target);
  } else {
    // 岩盾触发
    RULES.onHitRockShield(target);
  }

  return damage;
}

function dealElementalDamage(target, amount, element) {
  if (!target || target.dead) return 0;
  // 元素免疫
  if (target.elementImmune && target.elementImmune.includes(element)) {
    UI.log(`${target.name} 免疫 ${DATA.ELEMENT_NAME_CN[element] || element}元素。`);
    return 0;
  }
  // 元素抗性（简化：先按 0 处理，后续接）
  const resist = target.elementResist && target.elementResist[element] ? target.elementResist[element] : 0;
  const actual = amount * (1 - resist / 100);
  return dealRawDamage(target, actual, element);
}

function dealPhysicalDamage(target, amount) {
  return dealRawDamage(target, amount, 'physical');
}

// 施加 / 触发元素反应
function applyOrReactAttachment(cell, element) {
  if (!cell || cell.terrain === 'void') return;
  if (!REACTIONS || !REACTIONS.applyAura) return;
  REACTIONS.applyAura(cell, element, null /* source entity */);
}

// ---------------------------------------------------------------
// 范围 / 索敌工具
// ---------------------------------------------------------------
function collectEntitiesInChebyshevRange(map, cx, cy, r) {
  const result = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx, y = cy + dy;
      if (!RULES.inBounds(map, x, y)) continue;
      const cell = MAP.getCell(map, x, y);
      if (!cell) continue;
      for (const e of cell.entities) if (!e.dead) result.push(e);
    }
  }
  return result;
}

function rangeFront(map, cx, cy, facing, r) {
  const cells = [];
  for (let i = 1; i <= r; i++) {
    const target = RULES.adjacent(cx, cy, facing);
    // 这只是方向上的第 1 格，实际应该按 i 次累计
    // 简化处理：沿 facing 方向走 i 步
    const d = RULES.DIR_DELTA[facing];
    const x = cx + d.dx * i, y = cy + d.dy * i;
    if (RULES.inBounds(map, x, y)) cells.push(MAP.getCell(map, x, y));
  }
  return cells;
}

// ---------------------------------------------------------------
// 行动节点触发
// ---------------------------------------------------------------
function triggerNode(entityKey) {
  if (!COMBAT) return;
  if (COMBAT.nodeTriggered[entityKey]) return;
  const ent = COMBAT.entities.find(e => e.key === entityKey);
  if (!ent || ent.dead) return;

  // 1. 防御护盾
  ent.shield += (ent.displayDef || ent.def || 0);

  // 2. 扣 buff/debuff 持续时间
  for (const b of ent.buffs || []) {
    b.duration -= 1;
  }
  ent.buffs = (ent.buffs || []).filter(b => b.duration > 0);
  for (const d of ent.debuffs || []) {
    d.duration -= 1;
  }
  ent.debuffs = (ent.debuffs || []).filter(d => d.duration > 0);

  // 3. 自爆节点持续时间扣减（fire slime self destruct）
  if (ent.selfDestructTimer !== undefined) {
    ent.selfDestructTimer -= 1;
    if (ent.selfDestructTimer <= 0) {
      triggerFireSlimeExplosion(ent);
    }
  }

  COMBAT.nodeTriggered[entityKey] = true;
  UI.refreshCombat();
}

function triggerNodeIfFirstTime(entityKey) {
  triggerNode(entityKey);
}

function triggerFireSlimeExplosion(entity) {
  const sd = entity.selfDestruct;
  UI.log(`即将爆炸的火史莱姆爆炸了！`);
  // 周围 9 格（Chebyshev 1）
  const affected = collectEntitiesInChebyshevRange(COMBAT.map, entity.x, entity.y, 1);
  for (const e of affected) {
    if (e.key === entity.key) continue;
    dealElementalDamage(e, entity.atk * sd.explosionMult, sd.explosionElement);
  }
  entity.dead = true;
  handleDeath(entity);
  // 检查战斗结束：只要还有敌人就不结算；全部没有就正常结算
  checkBattleEndConditions();
}

// ---------------------------------------------------------------
// 硬控判定（节点里扣完持续时间后再检查）
// ---------------------------------------------------------------
function hasHardControl(ent) {
  const all = [...(ent.buffs || []), ...(ent.debuffs || [])];
  return all.some(b => ['freeze', 'bind', 'sleep', 'paralyze'].includes(b.kind));
}

// ---------------------------------------------------------------
// 自动朝向最近敌人
// ---------------------------------------------------------------
function autoFaceNearestEnemy() {
  const hero = COMBAT.heroEntity;
  const enemies = COMBAT.entities.filter(e => !e.dead && e.faction === 'enemy');
  if (enemies.length === 0) return;
  let best = null, bestD = Infinity;
  for (const e of enemies) {
    const d = RULES.manhattan(hero, e);
    if (d < bestD) { bestD = d; best = e; }
  }
  if (best) {
    const dx = best.x - hero.x, dy = best.y - hero.y;
    if (Math.abs(dx) >= Math.abs(dy)) hero.facing = dx > 0 ? 'right' : 'left';
    else hero.facing = dy > 0 ? 'down' : 'up';
  }
}

// ---------------------------------------------------------------
// 死亡处理（统一 onDeath）
// ---------------------------------------------------------------
function handleDeath(ent) {
  if (ent.deathHandled) return;
  ent.deathHandled = true;

  // 岩史莱姆：死亡本身已经被上面 dealRawDamage 里的 handleDeath 触发了
  // 敌人独有的 onDeath
  handleSlimeDeath(ent);
  // 主角死亡
  if (ent.key === 'pro') {
    UI.log(`主角倒下了……`);
    checkBattleEndConditions();
  }
}

// ---------------------------------------------------------------
// 战斗结束条件检查 + 结算
// ---------------------------------------------------------------
function checkBattleEndConditions() {
  if (!COMBAT || COMBAT.ended) return;
  const alivePlayer  = COMBAT.entities.filter(e => !e.dead && e.faction === 'player').length;
  const aliveEnemy   = COMBAT.entities.filter(e => !e.dead && e.faction === 'enemy').length;

  if (alivePlayer === 0) {
    // 主角死亡 → 战败
    COMBAT.ended = true;
    endCombat({ outcome: 'defeat' });
  } else if (aliveEnemy === 0) {
    // 敌人全灭 → 胜利（不再等自爆）
    COMBAT.ended = true;
    endCombat({ outcome: 'victory' });
  }
}

function endCombat({ outcome }) {
  const scene = COMBAT.scene;

  if (outcome === 'victory') {
    // 奖励：物品 + 属性升级二选一/三选一
    UI.log(`战斗胜利！`);
    for (const item of scene.rewards.items || []) {
      UI.log(`获得：${item.key} ×${item.count}`);
      // 具体添加到背包逻辑后续接
    }
    // 属性升级二选一/三选一（UI 弹出选项）
    UI.showStatChoice(scene.rewards.statChoices, scene.rewards.statChoiceCount);

    // 地块 content 标记完成
    const heroPos = COMBAT.heroStart;
    const realCell = MAP.getCell(G.map, heroPos.x, heroPos.y);
    if (realCell && realCell.content) {
      realCell.content.type = 'empty';
      realCell.content.done = true;
    }
  } else if (outcome === 'defeat') {
    UI.log(`战斗失败。健康 -${scene.healthPenalty}`);
    G.hero.health = Math.max(0, G.hero.health - scene.healthPenalty);
    if (G.hero.health <= 0) {
      G.gameOver = true;
    }
  }

  // === 清理 ===
  // 1. 移除非主角新生成的实体（主角保留在 entities 里但地块 entities 里清掉）
  for (const c of G.map.cells) {
    c.entities = c.entities.filter(e => e.key === 'pro');
  }
  // 2. 元素附着保留（不清空）
  // 3. 还原主角位置朝向
  G.px = COMBAT.heroStart.x;
  G.py = COMBAT.heroStart.y;
  G.hero.facing = COMBAT.heroStart.facing;
  G.hero.hp = COMBAT.heroEntity.hp;  // 战斗中 HP 变化同步回去（未死亡时）

  // === UI 切回探索模式 ===
  COMBAT = null;
  G.mode = 'explore';
  UI.switchMode('explore');
  MAP.clearEnemySpawnPointMarks(G.map);  // 真实地图上清除进攻点标记（战斗时没改动真实 map）
  UI.refreshAll();
}

