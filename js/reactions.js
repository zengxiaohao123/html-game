/* ============================================================
   js/reactions.js —— 模块：元素反应表 + 反应栈
   规格依据：docs/02-核心概念 §九 · 元素反应
   ============================================================ */
"use strict";

/**
 * 反应表：key = 'elem1:elem2'（elem1 是地块原附着，elem2 是新附着）
 * 顺序敏感的会写两个 key（如 fire:water 和 water:fire）
 * 每个反应返回一个描述对象，由 resolveReaction 消费
 */
const REACTION_TABLE = {
  // —— 蒸发（顺序敏感）——
  'fire:water': { kind:'evap', desc:'蒸发', token:'evapFire', layer:2 },  // 水触发 → 触发者得 蒸发·火
  'water:fire': { kind:'evap', desc:'蒸发', token:'evapWater', layer:2 }, // 火触发 → 触发者得 蒸发·水

  // —— 燃烧（火+草，顺序无关）——
  'fire:grass': { kind:'burn', desc:'燃烧', zoneType:'burn', duration:3, selfNode:true },
  'grass:fire': { kind:'burn', desc:'燃烧', zoneType:'burn', duration:3, selfNode:true },

  // —— 超载（火+雷，顺序无关）——
  'fire:thunder': { kind:'overload', desc:'超载', range:'area5' },
  'thunder:fire': { kind:'overload', desc:'超载', range:'area5' },

  // —— 融化（顺序敏感）——
  'fire:ice': { kind:'melt', desc:'融化', token:'meltFire', layer:2 },  // 冰触发 → 融化·火
  'ice:fire': { kind:'melt', desc:'融化', token:'meltIce', layer:2 },  // 火触发 → 融化·冰

  // —— 扩散（四种组合，顺序无关）——
  'fire:wind':   { kind:'diffuse', desc:'扩散·火', element:'fire',  range:'area9' },
  'water:wind':  { kind:'diffuse', desc:'扩散·水', element:'water', range:'area9' },
  'thunder:wind':{ kind:'diffuse', desc:'扩散·雷', element:'thunder', range:'area9' },
  'ice:wind':    { kind:'diffuse', desc:'扩散·冰', element:'ice',   range:'area9' },
  'wind:fire':   { kind:'diffuse', desc:'扩散·火', element:'fire',  range:'area9' },
  'wind:water':  { kind:'diffuse', desc:'扩散·水', element:'water', range:'area9' },
  'wind:thunder':{ kind:'diffuse', desc:'扩散·雷', element:'thunder', range:'area9' },
  'wind:ice':    { kind:'diffuse', desc:'扩散·冰', element:'ice',   range:'area9' },

  // —— 结晶（四种组合，顺序无关）——
  'fire:rock':   { kind:'crystal', desc:'结晶', element:'fire' },
  'water:rock':  { kind:'crystal', desc:'结晶', element:'water' },
  'thunder:rock':{ kind:'crystal', desc:'结晶', element:'thunder' },
  'ice:rock':    { kind:'crystal', desc:'结晶', element:'ice' },
  'rock:fire':   { kind:'crystal', desc:'结晶', element:'fire' },
  'rock:water':  { kind:'crystal', desc:'结晶', element:'water' },
  'rock:thunder':{ kind:'crystal', desc:'结晶', element:'thunder' },
  'rock:ice':    { kind:'crystal', desc:'结晶', element:'ice' },

  // —— 绽放（水+草，顺序无关）——
  'water:grass': { kind:'bloom', desc:'绽放', summon:'slimeGrass', summonFaction:'ally', summonOwner:'trigger', range:'area9_priorSelf' },
  'grass:water': { kind:'bloom', desc:'绽放', summon:'slimeGrass', summonFaction:'ally', summonOwner:'trigger', range:'area9_priorSelf' },

  // —— 感电（水+雷，顺序无关）——
  'water:thunder': { kind:'electrocute', desc:'感电', zoneType:'electrify', duration:3, selfNode:true, followWater:true, dmgFaction:'enemy', dmgPct:0.25 },
  'thunder:water': { kind:'electrocute', desc:'感电', zoneType:'electrify', duration:3, selfNode:true, followWater:true, dmgFaction:'enemy', dmgPct:0.25 },

  // —— 冻结（水+冰，顺序无关）——
  'water:ice': { kind:'freeze', desc:'冻结', debuff:'freeze', duration:2, immuneDebuff:'immuneFreeze', immuneDuration:3 },
  'ice:water': { kind:'freeze', desc:'冻结', debuff:'freeze', duration:2, immuneDebuff:'immuneFreeze', immuneDuration:3 },

  // —— 激化（草+雷，顺序无关）——
  'grass:thunder': { kind:'intensify', desc:'激化', buff:'intensify', stacks:2, max10:true, triggerFaction:'ownerAll', dmgBoost:0.1 },
  'thunder:grass': { kind:'intensify', desc:'激化', buff:'intensify', stacks:2, max10:true, triggerFaction:'ownerAll', dmgBoost:0.1 },

  // —— 超导（雷+冰，顺序无关）——
  'thunder:ice': { kind:'supercon', desc:'超导', zoneType:'supercon', duration:3, selfNode:true, resistChange:-0.4, resistElements:['thunder','ice','physical'], minPenalty:-0.1 },
  'ice:thunder': { kind:'supercon', desc:'超导', zoneType:'supercon', duration:3, selfNode:true, resistChange:-0.4, resistElements:['thunder','ice','physical'], minPenalty:-0.1 },
};

/** 同种元素 → 不反应 */
function sameElement(elem1, elem2){ return elem1 === elem2; }

/** 返回新附着的替代规则：如果两个异种元素在反应表里找不到 → 后者取代前者 */
function willReact(elem1, elem2){ return !!REACTION_TABLE[elem1+':'+elem2]; }

/** 取得反应描述（如果有反应）；否则返回 null 表示取代 */
function lookupReaction(elem1, elem2){ return REACTION_TABLE[elem1+':'+elem2] || null; }

window.reactions = { ELEMENTS, REACTION_TABLE, sameElement, willReact, lookupReaction };
