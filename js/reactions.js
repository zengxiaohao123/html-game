// =============================================================
// reactions.js —— 元素反应（可直接复用；适配实体堆叠）
// 10 种反应：蒸发、燃烧、超载、融化、冻结、感电、扩散、结晶、绽放、激化、超导
// =============================================================

const REACTION_TABLE = {
  'fire+water':    'evaporate',   // 蒸发：fire + water
  'water+fire':    'evaporate',
  'fire+grass':    'burn',        // 燃烧：fire + grass
  'grass+fire':    'burn',
  'fire+thunder':  'overload',    // 超载：fire + thunder
  'thunder+fire':  'overload',
  'fire+ice':      'melt',        // 融化：fire + ice
  'ice+fire':      'melt',
  'water+ice':     'freeze',      // 冻结：water + ice
  'ice+water':     'freeze',
  'water+thunder': 'electrocute', // 感电：water + thunder
  'thunder+water': 'electrocute',
  'grass+thunder': 'bloom',       // 绽放：grass + thunder
  'thunder+grass': 'bloom',
  'grass+water':   'bloom',       // 绽放：grass + water
  'water+grass':   'bloom',
  'wind+fire':     'diffuse',     // 扩散：wind + 任何可反应元素
  'wind+water':    'diffuse',
  'wind+grass':    'diffuse',
  'wind+thunder':  'diffuse',
  'wind+ice':      'diffuse',
  'rock+fire':     'crystalize',  // 结晶：rock + 火/水/冰/雷
  'rock+water':    'crystalize',
  'rock+ice':      'crystalize',
  'rock+thunder':  'crystalize',
};

// ---------------------------------------------------------------
// applyAura —— 对 cell 施加元素附着，若已有附着则触发反应
//   可直接被战斗模块调用；返回 reaction 名称或 null
// ---------------------------------------------------------------
function applyAura(cell, newElement, sourceEntity) {
  if (!cell || cell.terrain === 'void') return null;

  const old = cell.attach;
  if (!old) {
    cell.attach = newElement;
    return null;
  }

  // 已有附着 → 查表触发反应
  const key = `${old}+${newElement}`;
  const rxn = REACTION_TABLE[key];
  if (!rxn) {
    // 不可反应的元素 → 新附着覆盖旧附着（或保持旧的？这里简化为覆盖）
    cell.attach = newElement;
    return null;
  }

  executeReaction(rxn, cell, old, newElement, sourceEntity);
  return rxn;
}

// ---------------------------------------------------------------
// executeReaction —— 执行具体元素反应的效果
//   注：反应伤害作用于 cell.entities 里的所有合法目标（实体堆叠）
// ---------------------------------------------------------------
function executeReaction(rxn, cell, oldEl, newEl, sourceEntity) {
  // 反应效果的具体伤害 / 状态由数据层配置。这里给一个基础模板，
  // 后续会按设计者的规格进一步填充。
  const targetFactions = ['player', 'summon_player', 'enemy', 'summon_enemy', 'neutral'];
  const hits = [];
  for (const e of cell.entities || []) {
    if (targetFactions.includes(e.faction)) hits.push(e);
  }

  // 伤害 / 状态 —— 简化模板（后续接完整数据）
  const elementForDamage = rxn === 'evaporate' ? newEl
    : rxn === 'burn' ? 'fire'
    : rxn === 'overload' ? 'fire'
    : rxn === 'melt' ? 'fire'
    : rxn === 'freeze' ? 'water'
    : rxn === 'electrocute' ? 'thunder'
    : rxn === 'bloom' ? 'grass'
    : rxn === 'crystalize' ? 'rock'
    : null;

  for (const ent of hits) {
    if (elementForDamage && typeof COMBAT !== 'undefined') {
      COMBAT && dealElementalDamage(ent, 10, elementForDamage);
    }
  }

  // 扩散需要额外处理相邻 8 格
  if (rxn === 'diffuse') {
    // 顺时针一圈相邻 8 格，各自 applyAura
    const map = COMBAT && COMBAT.map;
    if (map) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const cc = MAP.getCell(map, cell.x + dx, cell.y + dy);
          if (cc) applyAura(cc, newEl, sourceEntity);
        }
      }
    }
  }

  // 反应后清空 cell.attach
  cell.attach = null;
}

window.REACTIONS = {
  REACTION_TABLE,
  applyAura,
  executeReaction,
};
