/* ============================================================
   js/rules.js —— 模块：范围计算 + 索敌规则（按技能 ruleTag 严格执行）
   规格依据：docs/02-核心概念 · 索敌规则三条铁律 + docs/05-角色·技能·物品 · 技能范围类型
   本文件纯函数模块，不读写全局状态 G / combatState。
   ============================================================ */
"use strict";

const ELEMENTS = ['fire','water','grass','thunder','ice','wind','rock'];
const ROOT_DIRS = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] };

/** 把 facing 字符串（up/down/left/right）转成方向位移 [dx, dy] */
function dirToOffset(facing){ return ROOT_DIRS[facing] || [0,-1]; }

/** 根据 range.type + 原点 + facing 计算范围内所有格子坐标 */
function computeRange(rangeType, ox, oy, facing){
  const cells = [];
  switch(rangeType){
    case 'self':
      cells.push([ox, oy]);
      break;
    case 'self-area4': {
      cells.push([ox,oy]);
      cells.push([ox,oy-1],[ox+1,oy],[ox-1,oy],[ox,oy+1]);
      break;
    }
    case 'selfArea3x3': {
      for(let dx=-1; dx<=1; dx++) for(let dy=-1; dy<=1; dy++) cells.push([ox+dx, oy+dy]);
      break;
    }
    case 'front1': case 'front2': case 'front3': case 'front6': {
      const n = parseInt(rangeType.replace('front',''),10);
      const [dx,dy] = dirToOffset(facing);
      for(let i=1; i<=n; i++) cells.push([ox+dx*i, oy+dy*i]);
      break;
    }
    case 'frontArea3x3': {
      const [dx,dy] = dirToOffset(facing);
      for(let side=-1; side<=1; side++){
        for(let fwd=1; fwd<=3; fwd++){
          cells.push([ox+dx*fwd + (dy===0?side:0), oy+dy*fwd + (dx===0?side:0)]);
        }
      }
      break;
    }
    case 'dist3': {
      for(let dx=-3; dx<=3; dx++)
        for(let dy=-3; dy<=3; dy++)
          if(Math.abs(dx)+Math.abs(dy) <= 3 && !(dx===0&&dy===0))
            cells.push([ox+dx, oy+dy]);
      break;
    }
    case 'dist5': {
      for(let dx=-5; dx<=5; dx++)
        for(let dy=-5; dy<=5; dy++)
          if(Math.abs(dx)+Math.abs(dy) <= 5 && !(dx===0&&dy===0))
            cells.push([ox+dx, oy+dy]);
      break;
    }
    case 'area4': {
      cells.push([ox,oy]);
      cells.push([ox,oy-1],[ox+1,oy],[ox-1,oy],[ox,oy+1]);
      break;
    }
    default:
      cells.push([ox,oy]);
  }
  return cells;
}

/** 过滤：范围内所有非外部地块 */
function filterNonVoid(cells, map){
  return cells.filter(([x,y]) => {
    if(!map || y<0 || y>=map.n || x<0 || x>=map.n) return false;
    const c = map.cells[y*map.n+x];
    return c && c.terrain !== 'void';
  });
}

/** 过滤：范围内的实体列表 */
function filterEntities(cells, entities){
  const out = [];
  for(const [x,y] of cells){
    for(const e of Object.values(entities)){
      if(e && !e.dead && e.x===x && e.y===y) out.push(e);
    }
  }
  return out;
}

/**
 * 索敌规则主函数。
 * ruleTag 取值 'default' | 'careful' | 'indiscriminate'
 * 返回 { attachCells: [[x,y], ...], damageEntities: [entity, ...] }
 * targetFaction: 当 ruleTag==='careful' 时必须传（'ally'|'enemy'|'self'|'all'）
 */
function resolveTargeting(rangeType, ownerPos, ownerFacing, map, entities, ruleTag, targetFaction){
  const allRange = computeRange(rangeType, ownerPos[0], ownerPos[1], ownerFacing);
  const attachAll = filterNonVoid(allRange, map);
  const ents = filterEntities(allRange, entities);

  let attachCells = [], damageEntities = [];

  if(ruleTag === 'indiscriminate'){
    attachCells = attachAll;
    damageEntities = ents.filter(e => !e.dead);  // 包括自身、队友、敌方、中立（除了明确不会被"可攻击"规则击中的）
  } else if(ruleTag === 'careful'){
    // 严格按描述筛选
    const filtered = ents.filter(e => !e.dead && factionMatch(e.faction, targetFaction));
    damageEntities = filtered;
    attachCells = attachAll.filter(([x,y]) => filtered.some(e => e.x===x && e.y===y));
  } else {
    // default：范围所有地块 + 所有可攻击敌对实体
    attachCells = attachAll;
    damageEntities = ents.filter(e => !e.dead && e.faction === 'enemy');
  }

  return { attachCells, damageEntities };
}

function factionMatch(actual, wanted){
  if(wanted === 'all') return true;
  return actual === wanted;
}

/** 判断某个实体是否是合法目标（至少满足 1 个：有地块可附着 / 有实体可命中 / 自身是合法目标） */
function hasValidTargetForSkill(skill, ownerKey, ownerPos, ownerFacing, map, entities, selfIsValid=true){
  const { attachCells, damageEntities } = resolveTargeting(
    skill.range?.type || 'self',
    ownerPos, ownerFacing,
    map, entities,
    skill.ruleTag || 'default',
    skill.target || 'enemy'
  );
  if(attachCells.length > 0) return true;
  if(damageEntities.length > 0) return true;
  // 自身 buff：即使没有范围、没有敌人，也算合法目标
  if(selfIsValid) return true;
  return false;
}

window.rules = {
  dirToOffset,
  computeRange,
  resolveTargeting,
  hasValidTargetForSkill,
};
