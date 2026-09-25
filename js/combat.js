/* ======================================================================
   combat.js — 大重做 v2（全重写，不计代价）
   
   模块切分：
     0. 工具函数
     1. 状态系统（status meta + add/tick/arr/has）
     2. 地块元素附着（setCellElement / clearCellElement / refreshAlwaysTerrain）
     3. 元素反应引擎（REACTIONS 完整 10 种 + resolveReactions）
     4. 战斗状态初始化（initCombatState / 兼容外部 startCombat / reenterCombat）
     5. 敌人生成（spawnEnemy / afterSpawnEnemy / 占位）
     6. 动作节点（triggerNodeFor —— 护盾 / tick 状态 / 总是地形刷新）
     7. 伤害框架（calcDamage / applyDamage —— 统一入口）
     8. 伤害入口（damageEnemy / damageHero / elemHit）
     9. 主角操作（castSkill / combatMove / selectSkill / tryFlee）
    10. 敌人 AI（enemyTurn → 简化但闭环）
    11. 回合状态机（phase: player→auto→summons→neutral→enemy→end）
    12. UI 渲染（renderCombatMap / updateCombatUI / heroInfoHTML / enemyInfoHTML / statusChipHTML / renderSkillBar）
    13. UI 交互（combatCellClick / bindCombatButtons）
    14. 战斗结算（checkCombatEnd / endCombat / grantRewardItems / showCombatEndPopup / victory / defeat）

   必须暴露给外部的接口：
     startCombat(cell) / reenterCombat(snapshot) / enterCombatMode()
     依赖 data.js 暴露：ENEMIES / PROTAGONIST / ALLIES / ELEM / TERRAIN_DEFS / ST / REACTIONS
   ====================================================================== */

"use strict";

/* ============================
   0. 工具函数
   ============================ */
function log(s){ if(typeof window.log==='function') window.log(s); else console.log(s); }
function prompt(s){ if(typeof window.prompt==='function') window.prompt(s); }
function el(html){ if(typeof window.el==='function') return window.el(html); const d=document.createElement('div'); d.innerHTML=html; return d.firstElementChild; }
function R(x){ return typeof x==='number'? Math.round(x): x; }
function dist(a,b){ return Math.abs(a.x-b.x)+Math.abs(a.y-b.y); }
function distCheb(a,b){ return Math.max(Math.abs(a.x-b.x), Math.abs(a.y-b.y)); }
function facingDir(f){ return f==='up'?[0,-1]:f==='down'?[0,1]:f==='left'?[-1,0]:[1,0]; }
function dirToFacing(dx,dy){ if(dx>0)return 'right'; if(dx<0)return 'left'; if(dy>0)return 'down'; return 'up'; }

function elemText(t){
  if(!t||t==='physical') return '物理伤害';
  if(t==='real'||t==='true') return '真实伤害';
  if(t==='stamina') return '耐力';
  if(ELEM[t]) return `<span class="${ELEM[t].c||('elem-'+t)}">${ELEM[t].zh}</span>元素伤害`;
  return '伤害';
}
function hasP(e,id){ return !!(e&&e.def&&e.def.passives&&e.def.passives.some(p=>p.id===id)); }
function hasSkill(e,id){ return !!(e&&e.def&&e.def.skills&&e.def.skills.some(s=>s.id===id)); }
function teamSizeBonus(){
  const t=(G&&G.team&&G.team.length)||3;
  return { atkMult: t>=3?1.30:t===2?1.15:1.00, hpMult: t>=3?1.40:t===2?1.20:1.00 };
}
function rBuffs(){ if(!G.records) G.records={}; if(!G.records.buffs) G.records.buffs={}; return G.records.buffs; }

/* ============ 战前 UI 兼容层：缺失的全局常量 & 辅助函数 ============ */
/* 旧版 AURA_ELEMS（战斗中可被附着的元素集合）—— 风、岩不可附着 */
const AURA_ELEMS = ['fire','water','grass','thunder','ice'];
/* 各敌人对哪种元素免疫（亲和）—— 旧版元素附着系统用 */
const AFFIN_IMMUNE = {slime:'grass',fireSlime:'fire',waterSlime:'water',thunderSlime:'thunder',iceSlime:'ice',windSlime:'wind',rockSlime:'rock'};

/* 拖拽地图标记位（ui.js 有定义，这里兜底） */
if(typeof mapDragMoved==='undefined') window.mapDragMoved=false;

/* 战前：技能范围 → 格子列表（兼容旧 target） */
function skillRangeCells(skill, refPos, facing){
  // 新版：统一用 rangeOf（支持 distN/adjN/lineN/frontN/self 等）
  const pos = refPos || combatState.hero;
  const fac = facing || pos.facing || 'up';
  if(rangeOf && skill && skill.target){
    const r = rangeOf({ type: skill.target, x:pos.x, y:pos.y, facing:fac });
    if(r) return r.map(c => ({x:c.x, y:c.y}));
  }
  // 旧规格 fallback（仅当 skill.target 是字符串且 rangeOf 不认识时）
  const out = [];
  const n = G.map.n;
  const [dx,dy] = facingDir(fac);
  const [fx,fy] = [pos.x+dx, pos.y+dy];
  const t = skill && skill.target;
  if(t==='front'){ if(passable(fx,fy)) out.push({x:fx,y:fy}); }
  else if(t==='adj'){
    for(const [a,b] of [[1,0],[-1,0],[0,1],[0,-1]]){ if(passable(pos.x+a,pos.y+b)) out.push({x:pos.x+a,y:pos.y+b}); }
  }
  else if(t==='frontline'){
    const r = skill.range || 3;
    for(let i=1;i<=r;i++){ if(passable(pos.x+dx*i,pos.y+dy*i)) out.push({x:pos.x+dx*i,y:pos.y+dy*i}); }
  }
  else if(t==='nearest'){
    const r = skill.range || 3;
    for(let x=0;x<n;x++) for(let y=0;y<n;y++)
      if(passable(x,y) && Math.abs(x-pos.x)+Math.abs(y-pos.y)<=r) out.push({x,y});
  }
  else out.push({x:pos.x, y:pos.y});
  return out;
}



/* 战前：找到范围内的敌人 */
function skillEnemies(skill, refPos, facing){
  const pos = refPos || combatState.hero;
  const cells = skillRangeCells(skill, pos, facing);
  const keys = new Set(cells.map(c=>c.x+','+c.y));
  return combatState.enemies.filter(en => keys.has(en.x+','+en.y));
}



/* 战前：敌人对某元素的额外伤害系数（占位 1.0） */
function enemyDmgMult(enemy, type){ return 1; }

/* 战前：技能伤害预览 */
function skillDamagePreview(charKey, skill){
  if(!skill) return null;
  if(skill.mult != null && charAtk){
    return Math.max(1, Math.round(charAtk(charKey) * skill.mult));
  }
  if(typeof skill.effect === 'function'){
    return Math.max(1, Math.round(charAtk(charKey)*skill.effect(1)));
  }
  return null;
}

/* 战前：治疗预览（无 healPct → 0） */
function healPreview(charKey, skill){
  if(!skill) return 0;
  if(skill.healPct) return Math.max(1, Math.round(charAtk(charKey)*skill.healPct));
  return 0;
}

/* 战前：天赋触发回调 —— 嗜血/起势 */
function applyTalentOnAttack(charKey, dmg){
  if(!combatState) return;
  const c = getChar(charKey), sts = combatState.ally[charKey];
  if(!sts) return;
  const blood = c.passives?.find(p=>p.id==='blood');
  if(blood && Math.random()*100 < tierValue(blood, entryLevel(charKey,blood), 'prob')){
    if(charKey==='pro'){
      const heal = Math.max(1, Math.round(dmg*0.5));
      const cap = heroineMaxHp();
      const nx = Math.min(cap, G.hero.hp + heal);
      if(nx > G.hero.hp){
        const got = nx - G.hero.hp;
        G.hero.hp = nx; combatState.hero.hp = nx;
        log(`【嗜血】触发，回复 ${got} 点生命。`);
      }
    }
  }
  const momentum = c.passives?.find(p=>p.id==='momentum');
  if(momentum) sts.mom = (sts.mom||0) + tierValue(momentum, entryLevel(charKey,momentum), 'dmg');
}

/* 战前：比翼 —— 陆悠悠暴击后给队友加下次暴击 buff */
function triggerBiyi(){
  for(const k of G.team){
    if(k==='luyouyou') continue;
    const sts = combatState.ally[k]?.statuses;
    if(sts) addStatus(sts, 'crit', null);
  }
  log('【比翼】触发：其余我方角色下一次攻击暴击率+100%。');
}

/* 战前：消耗暴击 buff */
function consumeCritBuff(charKey){
  const sts = combatState?.ally[charKey]?.statuses;
  if(sts && sts.crit){
    delete sts.crit;
    log(`${getChar(charKey).name} 消耗了【屏息】，暴击加成已生效。`);
  }
}

/* 战前：设置敌人元素附着（亲和敌人会自动补回，不需要真附着——本重做以地块附着为主，这里保留占位） */
function setAura(enemy, elem){ /* 新规格以地块附着为主，敌人附着占位 */ }
function reapplyAura(enemy){ /* 占位 */ }

/* 战前：击退（新规格简化为无效果） */
function knockBack(enemy){ /* 占位 */ }

/* 战前：绑定 goBtn —— 信息区「前往」按钮（战斗内点击相邻格） */
function bindCombatGo(x,y){
  const cs = combatState;
  const go = qs('#goBtn');
  if(!cs || !go) return;
  if(cs.playerMoved){ go.style.display='none'; return; }
  const dx = x - cs.hero.x, dy = y - cs.hero.y;
  const manhattan = Math.abs(dx) + Math.abs(dy);
  if(manhattan !== 1){ go.style.display='none'; return; }
  if(!passable(x,y)){ go.style.display='none'; return; }
  if(cs.enemies.some(e=>e.x===x&&e.y===y)){ go.style.display='none'; return; }
  go.style.display='block';
  go.disabled=false;
  go.textContent='前往';
  go.onclick = ()=>{
    if(!combatState) return;
    combatMove(dx,dy);
    go.style.display='none';
  };
}

/* 战前：计算移动成本（占位 1） */
function moveCostFor(x,y){ return passable(x,y) ? 1 : null; }

/* ============================
   1. 状态系统
   ============================ */
function statusMeta(id){
  // 先查 data.js 的 ST（大重做写的完整状态库）
  if(typeof ST==='object' && ST && ST[id]) return ST[id];
  // 降级兜底：战前的一些状态 id
  const fallback = {
    burn: { name:'燃烧', kind:'debuff', desc:'回合开始流失3%生命' },
    bind: { name:'束缚', kind:'debuff', desc:'无法移动' },
    sleep: { name:'睡眠', kind:'debuff', desc:'回合开始流失10%生命' },
    alert: { name:'警觉', kind:'buff', desc:'下次攻击+30%' },
    crit: { name:'暴击buff', kind:'buff', desc:'下次攻击必定暴击' },
    atkUp: { name:'攻击↑', kind:'buff', desc:'攻击力+25%' },
    poison: { name:'中毒', kind:'debuff', desc:'每回合受伤' },
    shield: { name:'护盾', kind:'buff', desc:'抵挡伤害' },
    freeze: { name:'冻结', kind:'debuff', desc:'行动被锁' },
  };
  return fallback[id] || { name:id, kind:'neutral', desc:'' };
}
function addStatus(statuses, id, turns, layers){
  if(!statuses) return;
  const meta = statusMeta(id);
  const cur = statuses[id];
  const newLayers = (cur && layers!=null) ? (cur.layers||0)+layers : (layers||0);
  const newTurns = turns!=null ? turns : (cur? cur.turns : null);
  const stacking = meta && meta.stacking==='stacks';
  statuses[id] = {
    id, name: meta.name, kind: meta.kind, desc: meta.desc,
    turns: newTurns,
    layers: newLayers || 0,
    stacks: stacking ? (cur&&cur.stacks||0)+1 : undefined,
  };
}
function tickStatuses(statuses){
  if(!statuses) return;
  for(const id of Object.keys(statuses)){
    const s = statuses[id];
    if(s.turns != null){
      s.turns--;
      if(s.turns<=0) delete statuses[id];
    }
  }
}
function statusArr(statuses){ return Object.values(statuses||{}); }
function hasStatus(statuses,id){ return !!(statuses&&statuses[id]); }

/* ============================
   2. 地块元素附着
   ============================ */
function setCellElement(idx, elem, opts={}){
  if(!G||!G.map) return;
  const cell = G.map.cells[idx];
  if(!cell) return;
  const td = TERRAIN_DEFS[cell.terrain];
  // 禁止总是附着地形被第三种元素覆盖
  if(td && td.alwaysElement && elem && elem !== td.alwaysElement && cell.element === td.alwaysElement){
    // 已经是 alwaysElement 了，新的 elem 尝试进来 → 允许反应（下面 tryReactOnAttach 处理），但不能替换为第三种
    const existing = cell.element;
    cell.element = elem;  // 先临时切换让反应能匹配
    const r = tryReactOnAttach(idx, existing, elem);
    if(!r){
      // 没发生反应 → 恢复 alwaysElement（禁止新元素常驻）
      cell.element = td.alwaysElement;
    }
    return r;
  }
  // 普通设置
  const existing = cell.element;
  if(existing && existing !== elem){
    const r = tryReactOnAttach(idx, existing, elem);
    if(r){
      cell.element = null;  // 反应后清空
      refreshAlwaysElementForCell(idx);
      return r;
    }
  }
  cell.element = elem;
  refreshAlwaysElementForCell(idx);
  return null;
}
function clearCellElement(idx){
  if(!G||!G.map) return;
  const cell = G.map.cells[idx];
  if(!cell) return;
  cell.element = null;
  refreshAlwaysElementForCell(idx);
}
function refreshAlwaysElementForCell(idx){
  const cell = G.map.cells[idx];
  if(!cell) return;
  const td = TERRAIN_DEFS[cell.terrain];
  if(td && td.alwaysElement){
    cell.element = td.alwaysElement;
  }
}
function refreshAlwaysElementTerrain(){
  if(!G||!G.map) return;
  for(let i=0; i<G.map.n*G.map.n; i++){
    refreshAlwaysElementForCell(i);
  }
}
function ensureCombatTerrain(){
  if(!G||!G.map) return;
  G.map.n = G.map.n || G.map.size || 7;
  for(let i=0; i<G.map.n*G.map.n; i++){
    const c = G.map.cells[i];
    if(!TERRAIN_DEFS[c.terrain]){
      if(c.terrain==='void') c.terrain='void';
      else if(c.terrain==='obstacle') c.terrain='obstacle';
      else c.terrain='ground';
    }
  }
}
function rangeOf(opts){
  /* 范围统一入口：给定 opts 描述 → 返回 {x,y,elem} 格子列表
     支持的描述（和 data.js 里 skill.target 对齐）:
       opts.type: 'self'|'front'|'front2'|'front3'|'adj4'|'adj5'|'adj8'|'adj9'|'dist2'|'dist3'|'adj12'|'adj16'|'adj21'|'adj23'|'adj25'|'line-front2'|'line-front3'|'front6'|'front9'
       opts.x, opts.y: 起始坐标
       opts.facing: 'up'|'down'|'left'|'right'
       opts.elem: 要施加的元素（可空）
  */
  const result = [];
  const push = (x,y)=>{
    if(x<0||y<0||x>=G.map.n||y>=G.map.n) return;
    if(!passable(x,y) && opts.type!=='dist3' && opts.type!=='adj25') return;
    result.push({x,y,elem: opts.elem});
  };
  const f = opts.facing || 'up';
  const [fx,fy] = facingDir(f);
  const cur = {x: opts.x, y: opts.y};
  const key = (opts.type||'adj4').toLowerCase();
  
  switch(key){
    case 'self':
      push(cur.x, cur.y); break;
    case 'front':
      push(cur.x+fx, cur.y+fy); break;
    case 'front2':
      for(let s=1;s<=2;s++) push(cur.x+fx*s, cur.y+fy*s); break;
    case 'front3':
      for(let s=1;s<=3;s++) push(cur.x+fx*s, cur.y+fy*s); break;
    case 'adj4': {
      for(const [a,b] of [[1,0],[-1,0],[0,1],[0,-1]]) push(cur.x+a, cur.y+b); break;
    }
    case 'adj5':
      push(cur.x,cur.y); for(const [a,b] of [[1,0],[-1,0],[0,1],[0,-1]]) push(cur.x+a, cur.y+b); break;
    case 'adj8': {
      for(const [a,b] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) push(cur.x+a, cur.y+b); break;
    }
    case 'adj9':
      push(cur.x,cur.y); for(const [a,b] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) push(cur.x+a, cur.y+b); break;
    case 'dist2': {
      for(let dy=-2; dy<=2; dy++) for(let dx=-2; dx<=2; dx++){
        const d=Math.abs(dx)+Math.abs(dy); if(d===0||d>2) continue;
        push(cur.x+dx, cur.y+dy);
      }
      break;
    }
    case 'dist3': {
      for(let dy=-3; dy<=3; dy++) for(let dx=-3; dx<=3; dx++){
        const d=Math.abs(dx)+Math.abs(dy); if(d===0||d>3) continue;
        push(cur.x+dx, cur.y+dy);
      }
      break;
    }
    case 'front6': {
      // (-1~1, 0~1) 相对朝向
      const rx = [f==='up'||f==='down' ? -1 : 0, 0, f==='up'||f==='down' ? 1 : 0];
      const ry = [f==='left'||f==='right' ? -1 : 0, 0, f==='left'||f==='right' ? 1 : 0];
      // 朝向方向扩展
      const ex = f==='up' ? 0 : f==='down' ? 0 : f==='left' ? -1 : 1;
      const ey = f==='up' ? -1 : f==='down' ? 1 : 0;
      for(let j=0; j<2; j++) for(let i=0;i<rx.length;i++) push(cur.x+rx[i]+ex*j, cur.y+ry[i]+ey*j);
      break;
    }
    case 'front9': {
      const rx = [f==='up'||f==='down' ? -1 : 0, 0, f==='up'||f==='down' ? 1 : 0];
      const ry = [f==='left'||f==='right' ? -1 : 0, 0, f==='left'||f==='right' ? 1 : 0];
      const ex = f==='up' ? 0 : f==='down' ? 0 : f==='left' ? -1 : 1;
      const ey = f==='up' ? -1 : f==='down' ? 1 : 0;
      for(let j=0; j<3; j++) for(let i=0;i<rx.length;i++) push(cur.x+rx[i]+ex*j, cur.y+ry[i]+ey*j);
      break;
    }
    case 'line-front2':
      for(let s=1;s<=2;s++){
        if(!passable(cur.x+fx*s, cur.y+fy*s)) break;
        push(cur.x+fx*s, cur.y+fy*s);
      } break;
    case 'line-front3':
      for(let s=1;s<=3;s++){
        if(!passable(cur.x+fx*s, cur.y+fy*s)) break;
        push(cur.x+fx*s, cur.y+fy*s);
      } break;
    default:
      // 默认 adj4
      for(const [a,b] of [[1,0],[-1,0],[0,1],[0,-1]]) push(cur.x+a, cur.y+b);
  }
  return result;
}

/* ============================
   3. 元素反应引擎（完整 10 种）
   ============================ */
// 反应顺序 key（有序）
const REACTION_ORDER = [
  'evaporation',   // 火+水 / 水+火
  'melting',       // 火+冰
  'superconduct',  // 冰+雷
  'frozen',        // 水+冰
  'electrocharged',// 水+雷
  'bloom',         // 水+草
  'burning',       // 火+草
  'overload',      // 火+雷
  'quicken',       // 雷+草
  'diffusion',     // 风+任意（扩散）
];
// 两两匹配表（优先顺序：数组下标决定优先级）
const REACTION_PAIRS = {
  evaporation:    ['fire','water'],    // 顺序有影响：火→水=蒸发·火 buff；水→火=蒸发·水 buff
  melting:        ['fire','ice'],      // 火→冰=融化·火；冰→火=融化·冰
  superconduct:   ['ice','thunder'],
  frozen:         ['water','ice'],
  electrocharged: ['water','thunder'],
  bloom:          ['water','grass'],
  burning:        ['fire','grass'],
  overload:       ['fire','thunder'],
  quicken:        ['thunder','grass'],
  // diffusion 特殊处理（任意元素 + 风）
};
function reactionFor(elemA, elemB){
  if(!elemA||!elemB||elemA===elemB) return null;
  // 风 + 任意元素 → 扩散
  if(elemA==='wind'||elemB==='wind') return { key:'diffusion', pair: [elemA,elemB], orderMatters:false };
  for(const key of REACTION_ORDER){
    if(key==='diffusion') continue;
    const pair = REACTION_PAIRS[key];
    if(!pair) continue;
    const [a,b] = pair;
    if((elemA===a&&elemB===b)||(elemA===b&&elemB===a)){
      return { key, pair:[a,b], orderMatters: key==='evaporation'||key==='melting' };
    }
  }
  return null;
}
function tryReactOnAttach(idx, existingElem, newElem){
  const r = reactionFor(existingElem, newElem);
  if(!r) return null;
  resolveReaction({ idx, elemA: existingElem, elemB: newElem, key: r.key, orderMatters: r.orderMatters });
  return r.key;
}
function resolveReaction(r){
  const cs = combatState;
  if(!cs) return;
  const idx = r.idx;
  const cx = idx % G.map.n;
  const cy = Math.floor(idx / G.map.n);
  const a = r.elemA, b = r.elemB;
  const triggerer = cs.currentChar && cs.ally[cs.currentChar] ? cs.ally[cs.currentChar] : null;
  log(`【${reactionName(r.key)}】(${cx+1},${cy}) 发生反应。`);
  switch(r.key){
    case 'evaporation': {
      // existing=fire new=water → 蒸发·火（火方+25%火伤buff）；反之蒸发·水
      const which = a==='fire' ? 'evap_fire' : 'evap_water';
      const targetElem = a==='fire' ? '火' : '水';
      if(triggerer){
        addStatus(triggerer.statuses, which);
        const s = triggerer.statuses[which]; s.turns = null; s.stacks = 1;
      }
      // 主角专属：获得对应 buff
      if(cs.ally.pro){
        const proElem = a==='fire' ? 'evap_fire' : 'evap_water';
        addStatus(cs.ally.pro.statuses, proElem);
        cs.ally.pro.statuses[proElem].turns = null;
      }
      log(`蒸发·${targetElem}：下次${targetElem}属性伤害+${which==='evap_fire'?'25':'50'}%`);
      break;
    }
    case 'melting': {
      // existing=fire new=ice → 融化·火（+火伤buff）；冰方获得+50%冰伤buff 但被火反应后消失
      const which = a==='fire' ? 'melt_fire' : 'melt_ice';
      if(triggerer){
        addStatus(triggerer.statuses, which);
        triggerer.statuses[which].turns = null; triggerer.statuses[which].stacks = 1;
      }
      log(`融化：双方各获 +30% 对应元素伤害 buff。`);
      break;
    }
    case 'superconduct': {
      // 生成超导结界：周围元素地块上的单位防御-40%
      cs.zone.push({ id:'supercond_'+Date.now(), type:'superconduct', x:cx, y:cy, turns:3 });
      log(`超导：展开 3 回合超导结界，结界内单位防御-40%，冰/雷抗性-30%。`);
      break;
    }
    case 'frozen': {
      // 冻结：对范围内（5×5）所有单位施加冻结
      for(let dy=-2; dy<=2; dy++) for(let dx=-2; dx<=2; dx++){
        const ix = cx+dx, iy = cy+dy;
        if(ix<0||iy<0||ix>=G.map.n||iy>=G.map.n) continue;
        const enemy = cs.enemies.find(e=>e.x===ix&&e.y===iy);
        if(enemy) addStatus(enemy.statuses, 'freeze', 1);
      }
      if(cs.hero.x>=cx-2&&cs.hero.x<=cx+2&&cs.hero.y>=cy-2&&cs.hero.y<=cy+2){
        addStatus(cs.ally.pro.statuses, 'freeze', 1);
      }
      log(`冻结：(5,5) 范围内所有单位被冻结 1 回合。`);
      break;
    }
    case 'electrocharged': {
      // 感电：范围内单位感电（持续掉血 + 与水地块有关联）
      for(let dy=-1; dy<=1; dy++) for(let dx=-1; dx<=1; dx++){
        const ix=cx+dx, iy=cy+dy;
        const enemy=cs.enemies.find(e=>e.x===ix&&e.y===iy);
        if(enemy) addStatus(enemy.statuses, 'electrocharged', 3);
      }
      log(`感电：周围 3×3 单位感电 3 回合。`);
      break;
    }
    case 'bloom': {
      // 绽放：生成草史莱姆（占位简化）
      const pet = {
        key:'bloomSlime', name:'草史莱姆·绽放', icon:'🟢', x:cx, y:cy, facing:'up',
        atk: Math.max(5, Math.round(charAtk('pro')*0.3)),
        hp: Math.max(10, Math.round(heroDisplayMaxHp()*0.15)),
        maxHp: Math.max(10, Math.round(heroDisplayMaxHp()*0.15)),
        defv:0, speed:0, statuses:{}, shield:0,
        def:{ passives:[], skills:[{id:'punch',name:'普攻',kind:'attack',target:'adj-front',type:'physical',mult:1.0,cd:0}] },
        nodeTriggered:false, acted:false, fromBloom:true,
      };
      cs.pets = cs.pets || [];
      cs.pets.push(pet);
      log(`绽放：在(${cx+1},${cy+1})生成草史莱姆·绽放。`);
      break;
    }
    case 'burning': {
      // 燃烧：生成燃烧结界（持续3回合，每秒 tick）
      cs.zone.push({ id:'burn_'+Date.now(), type:'burning', x:cx, y:cy, turns:3 });
      log(`燃烧：展开(${cx+1},${cy+1})周围 4 格的燃烧结界。`);
      break;
    }
    case 'overload': {
      // 超载：立即对周围 4 格敌人造成火+雷混合伤害（简化为直接 30% 攻击力）
      const base = charAtk('pro') || 30;
      for(const en of cs.enemies){
        if(en.x===cx&&en.y===cy || Math.abs(en.x-cx)+Math.abs(en.y-cy)===1){
          damageEnemy(en, Math.round(base*0.5), 'thunder', 'pro');
          damageEnemy(en, Math.round(base*0.5), 'fire', 'pro');
        }
      }
      log(`超载：对相邻格子敌人造成火+雷元素伤害。`);
      break;
    }
    case 'quicken': {
      // 激化：所有我方角色下次攻击 +25% 伤害
      for(const k of G.team){
        if(cs.ally[k]) addStatus(cs.ally[k].statuses, 'quicken', 1);
      }
      log(`激化：我方角色下次攻击 +25% 伤害。`);
      break;
    }
    case 'diffusion': {
      // 扩散：顺时针 8 格扩散现有元素（简化）
      const dirs = [[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]];  // 上→右上→右→右下→下→左下→左→左上
      const targetElem = a==='wind' ? b : a;  // 非风的那个
      let spread = 0;
      for(const [dx,dy] of dirs){
        const ix=cx+dx, iy=cy+dy;
        if(ix<0||iy<0||ix>=G.map.n||iy>=G.map.n) continue;
        const ix2 = iy*G.map.n + ix;
        const cell = G.map.cells[ix2];
        const td = TERRAIN_DEFS[cell.terrain];
        if(td && td.alwaysElement===targetElem) continue;  // 总是该元素 → 跳过避免冲突
        setCellElement(ix2, targetElem);
        spread++;
      }
      log(`扩散：${spread} 格地块被扩散为${ELEM[targetElem]?.zh||targetElem}元素。`);
      break;
    }
  }
}
function reactionName(key){
  const map = {evaporation:'蒸发',melting:'融化',superconduct:'超导',frozen:'冻结',electrocharged:'感电',bloom:'绽放',burning:'燃烧',overload:'超载',quicken:'激化',diffusion:'扩散'};
  return map[key] || key;
}

/* ============================
   4. 战斗状态初始化
   ============================ */
function initCombatState(o){
  combatState = null;
  ensureCombatTerrain();
  // 地块元素全清空
  for(let i=0; i<G.map.n*G.map.n; i++) G.map.cells[i].element = null;
  refreshAlwaysElementTerrain();

  const ally = {};
  for(const k of G.team){
    ally[k] = {
      statuses: {}, cds: {}, used: false, flatAtk: 0, stolen: 0, gain: 0,
      mom: 0, dead: false,
    };
  }
  // 全局技能组运行态槽位（从 G.skillGroup 复制，加 cd/used 运行字段）
  const slots = buildCombatSkillSlots();

  combatState = {
    hero: { x:G.px, y:G.py, facing: G.hero.facing||'up',
      hp: G.hero.hp, maxHp: heroineMaxHp(), shield: 0 },
    enemies: [], pets: [], ally, slots,
    zone: [], counter: {}, field: {},
    day: G.day, round: 1,
    entryCell: G.px+','+G.py,
    defeated: [], focusEnemy: null,
    pendingTarget: null, bubbles: [],
    nodeTriggered: false,
    // ===== 新状态机字段 =====
    turnOrder: [], turnIndex: 0, actor: null,
    phase: 'player',            // 'player' | 'auto' | 'enemy'（UI 仍依赖）
    currentChar: G.team[0]||'pro',  // UI 仍依赖：最后一个行动或即将行动的队友
    playerMoved: false,
    startSnapshot: {
      heroHp: G.hero.hp,
      vehicles: JSON.parse(JSON.stringify(G.vehicles||[])),
      vehicleSel: G.vehicleSel!=null?G.vehicleSel:0,
      enemyKey: o.enemyKey,
    },
  };
  const e = _spawnEnemy(o.enemyKey);
  combatState.enemies.push(e);
  _afterSpawnEnemy(e);
  combatState.pets = combatState.pets || [];
  _refreshHeroShield();
}
function _spawnEnemy(key){
  const def = ENEMIES[key];
  if(!def) return null;
  const b = teamSizeBonus();
  let atk = Math.round(def.atk*b.atkMult);
  let maxHp = Math.floor(def.maxHp*b.hpMult);
  let defv = def.def||0;
  let speed = def.speed||0;
  const passives = def.passives || [];
  
  if(passives.find(p=>p.id==='newbie') && G.day<13){ maxHp = Math.max(1, maxHp-60); }
  if(passives.find(p=>p.id==='rockshield')){ maxHp = Math.floor(maxHp*0.9); defv += 10; }
  if(passives.find(p=>p.id==='comeback')){
    const cnt = Math.min(5, (G.records?.chunibyoCount)||0);
    if(cnt){ atk += 15*cnt; maxHp += 40*cnt; speed += 5*cnt; }
  }
  const growthP = passives.find(p=>p.id==='growth') || passives.find(p=>p.id==='growth2');
  if(growthP){
    const isPro = !!passives.find(p=>p.id==='growth2');
    const days = Math.max(0, (G.day||1)-1);
    const n = Math.min(isPro?20:Infinity, days);
    if(n>0){
      atk = Math.round(atk*(1+((isPro?0.08:0.05)*n)));
      maxHp = Math.floor(maxHp*(1+((isPro?0.10:0.05)*n)));
      speed += n;
    }
  }
  const pos = _randomEmptyCombatCell();
  return {
    key, def, name: def.name, icon: def.icon, tier: def.tier,
    x: pos.x, y: pos.y, facing: dirToFacing(G.px-pos.x, G.py-pos.y),
    atk, baseAtkAtSpawn:atk, hp: maxHp, maxHp, defv, speed,
    res: def.res||{}, healthPenalty: def.healthPenalty||0,
    statuses:{}, cooldowns:{}, shield:0,
    nodeTriggered:false, acted:false, chargingSkill:null,
    plan:{},  // 占位：enemyTurn 会填意图
  };
}
function _afterSpawnEnemy(e){
  const cs = combatState;
  if(!cs) return;
  if(hasP(e,'swarm')){
    cs.enemies = [];
    const pool=['slime','fireSlime','waterSlime','thunderSlime','iceSlime','windSlime','rockSlime'];
    for(let i=0; i<3; i++){
      const k = pool[Math.floor(Math.random()*pool.length)];
      const sub = _spawnEnemy(k);
      cs.enemies.push(sub);
    }
    cs.defeated.push(e);
    log('史莱姆集群四散，冲出 3 只史莱姆！');
    return;
  }
}
function _randomEmptyCombatCell(){
  if(!G.map) return {x:0,y:0};
  const cs = combatState;
  const n = G.map.n;
  const hero = cs.hero;
  // 优先主角相邻 4 格
  const adj = [];
  for(const [a,b] of [[1,0],[-1,0],[0,1],[0,-1]]){
    const x = hero.x+a, y = hero.y+b;
    if(x<0||y<0||x>=n||y>=n) continue;
    if(cs.enemies.some(e=>e.x===x&&e.y===y)) continue;
    // 战前硬编码 terrain==='ground'；兼容探索地图的 building/forest/mine 等 → 这些也能站（战斗时当作空地）
    const t = G.map.cells[y*n+x].terrain;
    if(t==='obstacle'||t==='void') continue;  // 只有这两个不能进
    adj.push({x,y});
  }
  if(adj.length) return adj[Math.floor(Math.random()*adj.length)];
  // 兜底：主角同格右侧 1 格（即使被墙包围也不会 null）
  return {x:Math.min(n-1, hero.x+1), y:hero.y};
}
function _refreshHeroShield(){
  const cs = combatState; if(!cs) return;
  const d = totalHeroDefense();
  if(d>0) cs.hero.shield = d;
}
function startCombat(cell){
  const key = cell.content.key;
  initCombatState({ enemyKey: key });
  if(typeof clearLog==='function') clearLog();
  log('进入战斗。你得击败所有敌人。');
  enterCombatMode();
  _initTurnOrderAndStart();
}
function reenterCombat(snap){
  if(!snap||!G.map){ switchMode('story'); return; }
  initCombatState({ enemyKey: snap.enemyKey });
  log('读档回到本次战斗开始。');
  enterCombatMode();
  _initTurnOrderAndStart();
}
/* 外部兼容：战前函数名 */
function spawnEnemy(key){ return _spawnEnemy(key); }
function afterSpawnEnemy(e){ return _afterSpawnEnemy(e); }
function refreshHeroShield(){ _refreshHeroShield(); }
function initMapCombat(){ /* 新规格占位 */ }

/* ============================
   5. UI 入口（enterCombatMode）
   ============================ */
function enterCombatMode(){
  switchMode('combat');
  const go = qs('#goBtn'); if(go) go.style.display='none';
  updateCombatUI();
  refreshHUD();
  renderCombatMap();
  renderIconbar();
  if(typeof ensureKeyFocus==='function') ensureKeyFocus();
}

/* ============================
   6. 主角属性 & 天赋（探索/战斗都调）
   ============================ */
function charBaseAtk(k){
  if(k==='pro') return G.hero.atk;
  if(!G.bonds||!G.bonds[k]) return 35;
  const lv = G.bonds[k].level || 1;
  return 35 + 10*lv;
}
function charAtk(k){
  let a = charBaseAtk(k);
  const c = getChar(k);
  if(c && c.passives) for(const p of c.passives){
    const lv = entryLevel(k,p);
    if(p.scal?.atk) a += tierValue(p,lv,'atk');
    if(p.scal?.self) a += tierValue(p,lv,'self');
  }
  if(k==='pro'){
    for(const ally of G.team){
      const ac = ALLIES[ally]; if(!ac) continue;
      for(const p of (ac.passives||[])){
        const lv = entryLevel(ally,p);
        if(p.scal?.pro) a += tierValue(p,lv,'pro');
      }
    }
    if(G.hero.depress){ a = 0; }
  }
  if(combatState && combatState.ally[k]){
    const s = combatState.ally[k];
    a += (s.flatAtk||0) + (s.gain||0) - (s.stolen||0);
    const st = s.statuses; if(st.atkUp) a += Math.round(charBaseAtk(k)*0.25);
  }
  return Math.round(a);
}
function totalHeroDefense(){
  let d = G.hero.def||0;
  const pro = getChar('pro');
  const hold = pro.passives?.find(p=>p.id==='hold');
  if(hold) d += tierValue(hold, entryLevel('pro',hold), 'def');
  if(G.hero.depress) d = 0;
  return Math.max(0, Math.min(99999, d));
}
function heroineMaxHp(){ return heroDisplayMaxHp(); }
function heroDisplayMaxHp(){
  let m = G.hero.maxHp;
  const pro = getChar('pro');
  if(pro.passives) for(const p of pro.passives){
    const lv = entryLevel('pro',p);
    if(p.scal?.hp) m += tierValue(p,lv,'hp');
  }
  if(G.team.includes('luyouyou')) m += 100;  // 烹饪天赋
  return m;
}
function heroDodgeRate(){
  if(!G.team.includes('luyouyou')) return 0;
  const fl = getChar('luyouyou').passives?.find(p=>p.id==='dance');
  return fl ? vTier(fl,'dodge',entryLevel('luyouyou',fl)) : 0;
}
function baseCritRate(k){
  let r = 0;
  const c = getChar(k);
  const pick = k==='pro' ? c.passives?.find(p=>p.id==='crit') :
               k==='luyouyou' ? c.passives?.find(p=>p.id==='windSpirit') : null;
  if(pick && pick.scal?.crit) r += tierValue(pick, entryLevel(k,pick), 'crit');
  return r;
}
function charCritRate(k){
  let r = baseCritRate(k);
  const st = combatState && combatState.ally[k] && combatState.ally[k].statuses;
  if(st?.crit) r += 100;
  if(combatState && combatState.ally.pro?.statuses?.crit) r += 100;  // 比翼
  return Math.max(0, Math.min(100, r));
}
function vTier(passive, field, lv){
  if(!passive || !passive.scal) return 0;
  const f = passive.scal[field]; if(!f) return 0;
  const base = f.base || 0;
  const grow = f.grow || 0;
  const n = lv || 1;
  const val = base + grow*(n-1);
  return Math.round(f.pct ? val : val);
}
function tierValue(p, lv, field){ return vTier(p, field, lv); }
function entryLevel(charKey, passive){
  if(!G.bonds) return 1;
  const bond = G.bonds[charKey];
  return bond ? bond.level : 1;
}
function heroDisplayAtk(){ return charAtk('pro'); }
function heroDisplayDef(){ return totalHeroDefense(); }

/* ============================
   7. 伤害框架（统一入口）
   ============================ */
function _applyDamageToTarget(target, dmg, type, fromKey){
  // target 可以是 hero combatState.hero 或 enemy 对象
  if(!target || dmg<=0) return 0;
  let final = dmg;
  // 真实/无属性：跳过抗性，仍被护盾挡
  const isReal = type==='real'||type==='true';
  
  // 1. 抗性计算（真实伤害跳过）
  if(!isReal){
    let res = 0;
    if(target === combatState.hero){
      // 主角抗性：没有 per-element 抗性表，一律 0（护盾/天赋减伤在别处做）
      res = 0;
    } else {
      // 敌人抗性：优先 enemy 自带 def.res 或 res 字段
      res = target.def?.res?.[type] || 0;
      if(target.res?.[type]) res = Math.max(res, target.res[type]);
    }
    // 风元素地块 +风抗性
    const cs = combatState;
    if(cs){
      const idx = target.y*G.map.n + target.x;
      const cell = G.map.cells[idx];
      if(cell && cell.element==='wind'){
        // 风地块对来自主角的风元素伤害 +抗性（新规格没说但合理）
      }
      // 超导结界 -40% 防御等效 +30% 冰/雷伤 等效 -30% 抗性
      for(const z of cs.zone){
        if(z.type==='superconduct'){
          if(Math.abs(target.x-z.x)+Math.abs(target.y-z.y)<=2){
            if(type==='ice'||type==='thunder') res -= 30;
          }
        }
        if(z.type==='burning'){
          if(Math.abs(target.x-z.x)+Math.abs(target.y-z.y)<=2){
            if(type==='fire'){ /* 燃烧地块 ×2 火伤（新规格）*/ }
          }
        }
      }
      // 冻结 +50% 伤害加成（target 被冻结时）
      if(hasStatus(target.statuses,'freeze') && (type==='fire'||type==='thunder')){
        final = Math.round(final * 1.5);
      }
    }
    res = Math.max(-100, Math.min(90, res));
    final = Math.max(1, Math.round(final * (1 - res/100)));
  }
  
  // 2. 风元素地块主角 +物理伤（新规格）
  if(combatState && fromKey==='pro' && type==='physical'){
    const idx = G.hero.y*G.map.n + G.hero.x;
    if(G.map.cells[idx]?.element==='wind'){
      // 新规格：风地块触发双动（不是伤害 buff），跳过
    }
  }
  
  // 3. 主角格挡（物理/真实/元素 都能被挡，除了某些天赋）
  if(fromKey && typeof target !== 'object'){}  // 不会发生
  const pro = getChar('pro');
  if(target === combatState.hero){
    // 主角受击：暴击 / 格挡
    const crit = Math.random()*100 < baseCritRate('pro');  // 受击时主角自身暴击率？不：被打是对方暴击。这里占位简化
    const blockP = pro.passives?.find(p=>p.id==='block');
    if(blockP && Math.random() < vTier(blockP, 'dodge', entryLevel('pro',blockP))){
      log('主角【格挡】本次伤害被完全抵消！');
      return 0;
    }
  }
  
  // 4. 护盾抵挡（真实/反伤可穿透，先应用再穿透）
  let through = final;
  const shieldBefore = target.shield || 0;
  if(shieldBefore > 0){
    const absorbed = Math.min(shieldBefore, final);
    target.shield = shieldBefore - absorbed;
    through = final - absorbed;
    if(absorbed>0) log(`护盾抵挡 ${absorbed} 点伤害。`);
    final = through;
  }
  
  // 5. 扣血
  if(target === combatState.hero){
    G.hero.hp = Math.max(0, G.hero.hp - final);
    combatState.hero.hp = G.hero.hp;
  } else {
    target.hp = Math.max(0, target.hp - final);
  }
  
  return final;
}
function damageEnemy(enemy, dmg, type, fromKey){
  if(!enemy || !combatState?.enemies.includes(enemy)) return 0;
  if(!enemy.hp || enemy.hp<=0) return 0;
  // 敌人属性免疫
  if(type && ENEMIES[enemy.key]?.immue?.includes(type)) return 0;  // 占位简化
  // 反伤（如果主角有反伤天赋 → 反给敌人）
  // 简化：先 applyDamageToTarget
  const before = enemy.hp;
  const dealt = _applyDamageToTarget(enemy, dmg, type, fromKey);
  if(dealt>0 && fromKey==='pro' && charAtk('pro')>0){
    // 主角反伤占位
  }
  if(enemy.hp<=0){
    enemy.hp = 0;
    log(`${enemy.name} 被击败！`);
    removeEnemy(enemy);
    checkCombatEnd();
  }
  return dealt;
}
function damageHero(dmg, type, fromKey){
  if(!combatState) return;
  const before = G.hero.hp;
  const dealt = _applyDamageToTarget(combatState.hero, dmg, type, fromKey);
  G.hero.hp = Math.max(0, G.hero.hp - 0);  // hero hp 由 _applyDamageToTarget 处理
  if(G.hero.hp<=0){
    G.hero.hp = 0;
    log('你倒下了……');
    checkCombatEnd();
  }
  return dealt;
}
function elemHit(charKey, enemy, type, dmg){
  // 元素命中：如果敌人当前地块已有元素附着 → 触发反应
  if(!combatState || !enemy) return { final:dmg, consumed:false };
  const idx = enemy.y*G.map.n + enemy.x;
  const cell = G.map.cells[idx];
  if(!cell) return { final:dmg, consumed:false };
  // 伤害先算（反应不改变伤害数值但会给 buff）
  const r = tryReactOnAttach(idx, cell.element, type);
  return { final: dmg, consumed: !!r, reaction: r };
}
function removeEnemy(enemy){
  if(!combatState) return;
  const i = combatState.enemies.indexOf(enemy);
  if(i>=0) combatState.enemies.splice(i,1);
  combatState.defeated.push(enemy);
  onEnemyDefeated(enemy);
}
function onEnemyDefeated(enemy){ /* 各种天赋钩子，占位 */ }
function enemyNode(){ return combatState?.enemies?.[0] || null; }

/* ============================
   8. 主角操作（castSkill / combatMove / selectSkill / tryFlee）
   ============================ */
function _activeSkillsOf(charKey){
  const c = getChar(charKey);
  if(!c) return [];
  // 从 data.js 里的 skills 字段（按大重做规格）
  return (c.skills||[]).filter(s=> s.kind==='active' || s.kind==='auto');
}


function _resolveTargetsForSkill(sk, charKey){
  const cs = combatState;
  const curChar = cs.currentChar;
  const hero = cs.hero;
  const fromX = charKey==='pro' ? hero.x : hero.x;  // 队友占位（后续队友独立行动再处理）
  const fromY = charKey==='pro' ? hero.y : hero.y;
  const fromFacing = hero.facing;
  
  const range = rangeOf({ type: sk.target, x:fromX, y:fromY, facing:fromFacing, elem: sk.type });
  const result = [];
  if(sk.kind==='support'){
    // 辅助技能：选我方
    result.push('hero');
  } else {
    for(const {x,y} of range){
      const en = cs.enemies.find(e=>e.x===x&&e.y===y);
      if(en) result.push(en);
    }
  }
  return result;
}
function combatMove(dx,dy){
  const cs = combatState; if(!cs) return;
  // 只允许主角在自己的行动回合里移动
  if(!cs.actor || cs.actor.who !== 'ally' || cs.actor.key !== 'pro'){
    log('现在不是主角的行动回合。'); return;
  }
  if(cs.ally.pro.used){ log('主角本回合已行动。'); return; }
  const hero = cs.hero;
  const nx = hero.x+dx, ny = hero.y+dy;
  if(!passable(nx,ny)){ log('此方向无法通行。'); return; }
  if(cs.enemies.some(e=>e.x===nx&&e.y===ny)){ log('敌人占据此格，无法移动过去。'); return; }
  hero.x = nx; hero.y = ny; hero.facing = dirToFacing(dx,dy);
  G.px = nx; G.py = ny;
  cs.playerMoved = true;
  log(`主角移动到 (${nx},${ny})。`);
  refreshHUD(); renderCombatMap(); updateCombatUI();
}
function tryFlee(){
  const cs = combatState; if(!cs) return;
  const mvs = [];
  for(const en of cs.enemies){ const mv = Math.round(en.speed||0)+1; mvs.push(mv); }
  const heroMv = 100;
  const maxEnemySpeed = Math.max(...mvs, 0);
  const rate = Math.max(0, Math.min(100, Math.round((heroMv-maxEnemySpeed)/100*100)));
  log(`逃跑判定：我方速度 ${heroMv}，敌方最快 ${maxEnemySpeed}，成功率 ${rate}%。`);
  if(Math.random()*100 < rate){
    log('逃跑成功！');
    combatState = null;
    switchMode('story');
    refreshHUD(); renderMap(); renderIconbar();
  } else {
    log('逃跑失败，敌人包围了你。');
    // 失败：结束当前 actor，让状态机自然推进
    if(cs.actor) _endActorTurn();
  }
}

/* ============================
   9. 统一回合状态机（turnOrder + advanceTurn）
   参考 ExperienceRecall 教训：死亡/冻结 skip 放进 advanceTurn 循环
   ============================ */

/* 构建当前轮的行动顺序：我方逐个 → auto 阶段 → 敌人逐个 */
function _buildTurnOrder(){
  const out = [];
  for(const k of G.team) out.push({ who:'ally', key:k });
  out.push({ who:'auto' });
  for(let i=0; i<combatState.enemies.length; i++) out.push({ who:'enemy', idx:i });
  return out;
}

/* 判断一个 actor 当前是否可以行动 */
function _actorActable(actor){
  if(!actor) return false;
  if(actor.who === 'auto') return true;  // auto 阶段永远执行（没技能就是空跑）
  if(actor.who === 'ally'){
    if(combatState.ally[actor.key].dead) return false;
    if(combatState.ally[actor.key].used && combatState.ally[actor.key].mom===0){
      // used 标记 + 没起势 → 跳过（等新回合自动重置 used）
      // 但若起势叠加，允许继续行动
    }
    return true;
  }
  if(actor.who === 'enemy'){
    const e = combatState.enemies[actor.idx];
    if(!e || e.hp <= 0) return false;
    if(hasStatus(e.statuses,'freeze')) return false;
    if(hasStatus(e.statuses,'sleep')) return false;
    return true;
  }
  return false;
}

/* 找到下一个可行动 actor（可能跳过死亡/冻结） */
function advanceTurn(){
  const cs = combatState;
  if(!cs) return;
  while(cs.turnIndex < cs.turnOrder.length){
    const actor = cs.turnOrder[cs.turnIndex];
    if(_actorActable(actor)){
      _startActorTurn(actor);
      return;
    }
    cs.turnIndex++;
  }
  // turnOrder 跑完 → 回合结束
  _phaseRoundEnd();
}

/* 某个 actor 开始自己的行动回合 */
function _startActorTurn(actor){
  const cs = combatState;
  cs.actor = actor;

  if(actor.who === 'ally'){
    cs.currentChar = actor.key;   // UI 还在依赖 currentChar
    cs.phase = 'player';
    _tickAllyStart(actor.key);
    if(actor.key === 'pro') _turnHeroFacingToEnemy();   // 自动面向最近敌人
    refreshHUD(); renderCombatMap(); updateCombatUI();
    log(`轮到 ${getChar(actor.key).name} 行动。`);
  } else if(actor.who === 'auto'){
    cs.phase = 'auto';
    _runAutoPhase();
    // auto 阶段是一段式的，跑完直接结束
    _endActorTurn();
  } else if(actor.who === 'enemy'){
    cs.phase = 'enemy';
    _runEnemyAct(actor);
    _endActorTurn();
  }
}

/* 当前 actor 结束自己的行动回合 */
function _endActorTurn(){
  const cs = combatState;
  if(!cs || !cs.actor) return;
  const actor = cs.actor;

  // 后置结算
  if(actor.who === 'ally')  _tickAllyEnd(actor.key);
  if(actor.who === 'enemy') _tickEnemyEnd(actor);
  if(actor.who === 'auto')  { /* 已在 _runAutoPhase 里结算 */ }

  cs.actor = null;
  cs.turnIndex++;

  if(!checkCombatEnd()) advanceTurn();
}

/* 玩家主动结束当前队友的行动（跳回合/放弃） */
function endCurrentAllyTurn(){
  const cs = combatState; if(!cs || !cs.actor) return;
  if(cs.actor.who !== 'ally') return;
  log(`${getChar(cs.actor.key).name} 结束行动。`);
  _endActorTurn();
}

/* ============================
   10. Ally 回合内细节
   ============================ */
function _tickAllyStart(key){
  const aly = combatState.ally[key]; if(!aly) return;
  // 回合开始：cd 递减（所有 slots 上的 cd 是全局的，这里统一减）
  for(const s of combatState.slots){
    if(s.cd > 0) s.cd--;
  }
}

function _tickAllyEnd(key){
  const aly = combatState.ally[key]; if(!aly) return;
  // 行动结束：used 标记保持到 auto 阶段之后再统一清
  // 起势（momentum）保留整场战斗
}

/* 玩家可用 check：当前队友是否能行动（活着） */
function _canAllyAct(key){
  const aly = combatState.ally[key]; if(!aly) return false;
  if(aly.dead) return false;
  return true;
}

/* ============================
   11. Auto 阶段：全队 auto 技能依次自动释放
   ============================ */
function _runAutoPhase(){
  const cs = combatState;
  if(!cs.slots || !cs.slots.length) return;

  // 先把上一轮所有 ally 的 used 重置掉（auto 阶段代表玩家阶段结束）
  for(const k of G.team){
    if(cs.ally[k]) cs.ally[k].used = false;
  }

  for(const slot of cs.slots){
    const { c, sk } = skillGroupResolve(slot);
    if(!c || !sk) continue;
    if(sk.kind !== 'auto') continue;             // 只跑 auto 类
    if(slot.cd > 0) continue;                    // cd 还没好
    if(!_canAllyAct(slot.charKey)) continue;      // 属主已死亡
    const aly = cs.ally[slot.charKey];
    if(aly.used) continue;                       // 已行动过（队友轮到 auto 阶段）

    const charName = c.name;
    log(`【自动·${sk.name}】${charName} 自动释放。`);
    resolveSkill(slot.charKey, sk, false);
    if(!combatState) return;
    slot.cd = sk.cd || 0;
    aly.used = true;
  }

  // auto 阶段跑完：标记所有队友 used=true，防止再行动
  for(const k of G.team){
    if(cs.ally[k]) cs.ally[k].used = true;
  }
}


/* 辅助：主角自动朝向最近敌人（进入行动回合时自动做） */
function _turnHeroFacingToEnemy(){
  const cs = combatState; if(!cs) return;
  const hero = cs.hero;
  let best = null, bestD = Infinity;
  for(const e of cs.enemies){
    if(e.hp<=0) continue;
    const d = Math.abs(e.x-hero.x)+Math.abs(e.y-hero.y);
    if(d < bestD){ bestD = d; best = e; }
  }
  if(best){
    const dx = best.x - hero.x, dy = best.y - hero.y;
    if(dx!==0 || dy!==0){
      hero.facing = dirToFacing(dx, dy);
      G.hero.facing = hero.facing;
    }
  }
}

/* ============================
   12. Enemy 回合
   ============================ */
function _runEnemyAct(actor){
  const cs = combatState;
  const en = cs.enemies[actor.idx];
  if(!en) return;

  // 选技能（简化版本：默认普攻）
  const def = en.def || {};
  const skills = def.skills || [{ id:'attack', name:'普攻', kind:'attack', target:'adj-front', type:'physical', mult:1.0, cd:0 }];
  const availableSkill = skills.find(s => !(en.cooldowns && en.cooldowns[s.id]>0)) || skills[0];

  // 找主角（敌人目标目前锁定主角）
  const hero = cs.hero;
  const tx = hero.x, ty = hero.y;
  const d = dist(en, hero);

  const skillRange = rangeOf({ type: availableSkill.target, x:en.x, y:en.y, facing:en.facing });
  const hit = skillRange.some(c => c.x===tx && c.y===ty);

  if(hit){
    const mult = availableSkill.mult || 1.0;
    const finalType = availableSkill.type || 'physical';
    let dmg = Math.round(en.atk * mult);
    // 敌人元素攻击也会触发地块反应
    const idx = hero.y*G.map.n + hero.x;
    if(finalType && ELEM[finalType]) setCellElement(idx, finalType);
    const dealt = damageHero(dmg, finalType, en.key);
    const critTxt = Math.random()<0.15 ? '<span class="crit-hint">暴击！</span>' : '';
    if(dealt>0) log(`${en.name} 使用【${availableSkill.name}】对主角造成 ${critTxt}${dealt} 点${elemText(finalType)}。`);
    if(!en.cooldowns) en.cooldowns = {};
    en.cooldowns[availableSkill.id] = availableSkill.cd || 0;
  } else {
    // 移动靠近：曼哈顿贪心（不动到主角身上、不踩队友）
    let best = null, bestD = d;
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const nx = en.x+dx, ny = en.y+dy;
      if(!passable(nx,ny)) continue;
      if(nx===hero.x && ny===hero.y) continue;
      if(cs.enemies.some(e => e!==en && e.x===nx && e.y===ny)) continue;
      const nd = Math.abs(nx-tx)+Math.abs(ny-ty);
      if(nd < bestD){ bestD = nd; best = [dx,dy]; }
    }
    if(best){
      en.x += best[0]; en.y += best[1];
      en.facing = dirToFacing(best[0], best[1]);
      log(`${en.name} 向主角靠近。`);
    }
  }

  // tick 敌人自身冷却
  if(en.cooldowns){
    for(const k of Object.keys(en.cooldowns)){ if(en.cooldowns[k]>0) en.cooldowns[k]--; }
  }

  renderCombatMap(); updateCombatUI(); refreshHUD();
}

function _tickEnemyEnd(actor){
  const cs = combatState;
  const en = cs.enemies[actor.idx];
  if(!en) return;
  // 燃烧/中毒等持续状态 tick
  tickStatuses(en.statuses);
  if(hasStatus(en.statuses,'burn')){
    const lost = Math.max(1, Math.round(en.maxHp*0.03));
    en.hp = Math.max(0, en.hp - lost);
    log(`【燃烧】${en.name} 流失 ${lost} 点生命。`);
    if(en.hp<=0){
      log(`${en.name} 被【燃烧】击败！`);
      removeEnemy(en);
    }
  }
}

/* ============================
   13. 回合结束结算
   ============================ */
function _phaseRoundEnd(){
  const cs = combatState; if(!cs) return;
  cs.round++;
  _refreshHeroShield();

  // 全局状态递减（地块元素自然扩散/衰减已在地块模块处理，这里减队伍状态）
  for(const k of G.team){
    if(cs.ally[k]) tickStatuses(cs.ally[k].statuses);
  }
  // zone tick
  for(let i = cs.zone.length-1; i>=0; i--){
    const z = cs.zone[i];
    z.turns--;
    if(z.turns<=0){ cs.zone.splice(i,1); continue; }
    if(z.type==='burning'){
      for(const en of cs.enemies){
        if(Math.abs(en.x-z.x)+Math.abs(en.y-z.y)<=2) addStatus(en.statuses,'burn',1);
      }
    }
  }
  // 主角状态 tick（debuff 影响 hp 恢复等）
  tickStatuses(cs.hero.statuses || (cs.hero.statuses={}));

  // 清空所有 used 标记 + 准备下一轮
  for(const k of G.team){
    if(cs.ally[k]){ cs.ally[k].used = false; cs.ally[k].mom = 0; }
  }
  cs.playerMoved = false;

  // 重建 turnOrder，回到第 0 位
  cs.turnOrder = _buildTurnOrder();
  cs.turnIndex = 0;

  log(`第 ${cs.round} 回合开始。`);
  advanceTurn();
}

/* ========= 入口别名（startCombat 里用） ========= */
function _initTurnOrderAndStart(){
  const cs = combatState;
  cs.turnOrder = _buildTurnOrder();
  cs.turnIndex = 0;
  advanceTurn();
}

function heroInfoHTML(){
  const cs = combatState; if(!cs) return '';
  const c = getChar('pro');
  const hpPct = Math.max(0, G.hero.hp) / (G.hero.maxHp||100) * 100;
  const atk = charAtk('pro');
  const def = totalHeroDefense();
  const crit = charCritRate('pro');
  const dodge = heroDodgeRate();
  return `
    <div class="hero-info">
      <b>主角</b>（${G.team.map(k=>getChar(k).name).join('、')}）<br>
      HP: ${G.hero.hp}/${G.hero.maxHp||heroineMaxHp()}
      <div class="hpbar"><i style="width:${hpPct}%"></i></div>
      攻击力 ${atk} · 防御 ${def} · 暴击 ${crit}% · 闪避 ${dodge}%<br>
      护盾: ${cs.hero.shield || 0} | 行动力: ${G.hero.actionPoint||0}
    </div>
  `;
}
function enemyInfo(){
  const cs = combatState; if(!cs) return '';
  return cs.enemies.map((en,i)=>{
    const hpPct = Math.max(0, en.hp)/en.maxHp*100;
    return `
      <div class="enemy-item" data-i="${i}">
        <b>${en.icon} ${en.name}</b>（${en.tier||''}）<br>
        HP: ${en.hp}/${en.maxHp}
        <div class="hpbar"><i style="width:${hpPct}%"></i></div>
        ATK ${en.atk} · DEF ${en.defv||0} · SPD ${en.speed||0}
        ${statusChipHTML_for(en)}
      </div>
    `;
  }).join('<br>');
}
function statusChipHTML_for(unit){
  const sts = unit.statuses; if(!sts) return '';
  const chips = [];
  for(const id of Object.keys(sts)){
    const s = sts[id];
    let html = `<span class="stchip" data-desc="${s.desc||''}" data-name="${s.name||id}" data-ttl="${s.turns!=null?s.turns:''}" data-stack="${s.stacks||0}">`;
    html += `<b>${s.name||id}</b>`;
    if(s.turns!=null) html += ` · ${s.turns}回合`;
    if(s.layers) html += ` · 层${s.layers}`;
    if(s.stacks) html += ` · ${s.stacks}`;
    html += `</span>`;
    chips.push(html);
  }
  return chips.join(' ');
}

function renderSkillBar(){
  const cs = combatState; if(!cs) return '';
  const c = getChar(cs.currentChar); if(!c) return '';
  const sks = _activeSkillsOf(cs.currentChar);
  if(!sks.length) return '<i>（没有可用技能）</i>';
  return sks.map((sk,i)=>{
    const cd = cs.ally[cs.currentChar]?.cds?.[sk.id] || 0;
    const disabled = cd>0 ? ' disabled' : '';
    const activeSel = cs.ally[cs.currentChar]?.selectedSkillId===sk.id ? ' selected' : '';
    return `<button class="skill-btn${activeSel}${disabled}" data-id="${sk.id}" data-k="${i+1}">
      <b>[${i+1}]</b> ${sk.name}${cd?` · 冷却 ${cd}`:''}${sk.mult?` · ${Math.round(sk.mult*100)}%`:''}
    </button>`;
  }).join(' ');
}
function updateCombatInfo(){ updateCombatUI(); }

/* ============================
   12. UI 交互
   ============================ */


/* ============================
   13. 战斗结算
   ============================ */
function checkCombatEnd(){
  const cs = combatState; if(!cs) return;
  // 敌人全灭 → 胜利
  if(cs.enemies.length===0){
    _endCombatVictory();
  }
  // 主角 hp ≤ 0 → 失败
  if(G.hero.hp<=0){
    _endCombatDefeat();
  }
}
function _endCombatVictory(){
  const cs = combatState; if(!cs) return;
  const enemies = cs.defeated.slice();
  combatState = null;
  grantRewardItems(enemies, true);
  grantRewardAttr();
  switchMode('story');
  log('战斗胜利！');
  renderMap(); refreshHUD(); renderIconbar();
  showCombatEndPopup('战斗胜利', ['你击败了所有敌人。'], true);
}
function _endCombatDefeat(){
  const cs = combatState; if(!cs) return;
  combatState = null;
  switchMode('story');
  log('战斗失败，被敌人击倒。');
  renderMap(); refreshHUD(); renderIconbar();
  showCombatEndPopup('战斗失败', ['你被敌人击倒了。'], false);
}
function grantRewardItems(enemies, isVictory){
  if(!isVictory) return;
  const total = enemies.length || 1;
  const coin = 10 + total*5 + Math.floor(Math.random()*total*10);
  G.inventory = G.inventory || {};
  G.inventory.coin = (G.inventory.coin||0) + coin;
  log(`获得奖励：${coin} 金币。`);
}
function grantRewardAttr(){ /* 天赋升级占位 */ }
function grantVictoryRewards(){ grantRewardItems(combatState?.defeated||[], true); }
function showCombatEndPopup(title, lines, isVictory){
  if(typeof openModal!=='function') return;
  openModal(title, `<p>${lines.join('</p><p>')}</p>
    <button class="mbtn big" onclick="closeModal()">继续探索</button>`, 'small');
}

/* ============================
   14. 对外兼容层（战前函数名）
   ============================ */
function enemyResistWith(enemy, type){
  if(!enemy || !enemy.def) return 0;
  let r = enemy.res?.[type] || enemy.def.res?.[type] || 0;
  const cs = combatState;
  if(cs){
    for(const z of cs.zone){
      if(z.type==='superconduct' && Math.abs(enemy.x-z.x)+Math.abs(enemy.y-z.y)<=2){
        if(type==='ice'||type==='thunder') r -= 30;
      }
    }
  }
  return Math.max(0, Math.min(90, r));
}
function enemyRangeKeys(enemy){
  const set = new Set();
  if(!enemy || !enemy.def) return set;
  const sk = enemy.def.skills?.find(s=>s.target);
  if(!sk) return set;
  const keys = rangeOf({ type:sk.target, x:enemy.x, y:enemy.y, facing:enemy.facing }).map(c=>c.x+','+c.y);
  for(const k of keys) set.add(k);
  return set;
}

function focusedEnemy(){
  return combatState?.focusEnemy || combatState?.selectedEnemy || null;
}
function cdReady(charKey, skill){
  return !(combatState?.ally[charKey]?.cds?.[skill.id] > 0);
}
function setCd(charKey, skill, cd){
  if(combatState?.ally[charKey]) combatState.ally[charKey].cds[skill.id] = cd;
}
function applySupport(charKey, skill){ /* 占位 */ }
function knockBack(enemy){ /* 占位 */ }
function endPlayerPhase(){ _phaseEnemy(); }
function endCombat(result){ if(result==='defeat') _endCombatDefeat(); else _endCombatVictory(); }
function endCombatByDefeat(){ _endCombatDefeat(); }
function clearLog(){ /* ui.js 有，这里占位 */ }
function clearStory(){ /* 占位 */ }




function enemySkillsHTML(enemy){ return ''; }

function renderIconbar(){ if(typeof window.renderIconbar==='function') window.renderIconbar(); }
function ensureKeyFocus(){ if(typeof window.ensureKeyFocus==='function') window.ensureKeyFocus(); }

/* ============================
   15. keyboard handler 入口（main.js 会调）
   ============================ */
function bindCombatGo(){ /* 占位 */ }
window.selectCurrentChar = function(key){
  const cs = combatState; if(!cs) return;
  cs.currentChar = key;
  renderCombatMap(); updateCombatUI();
};

/* ============================
   16. 冷却 tick 函数（被外部调）
   ============================ */
function cdReady(charKey, skill){
  return !(combatState?.ally[charKey]?.cds?.[skill.id] > 0);
}
function tickEnemyCooldowns(){ /* 占位 */ }

/* ============================
   17. escape rate（探索 UI 可能调）
   ============================ */
function calcEscapeRate(){
  if(!combatState) return 0;
  const mv = combatState.enemies.map(e=>Math.round(e.speed||0)+1);
  const maxEnemy = Math.max(...mv, 0);
  const hero = 100;
  return Math.max(0, Math.min(100, Math.round((hero-maxEnemy)/100*100)));
}


/* ===========================================
   === 以下是从战前 combat.js 搬回的 UI/交互函数 ===
   =========================================== */


/* pre-combat UI: passable */
function passable(x,y){
  const n = G.map.n;
  if(x<0||y<0||x>=n||y>=n) return false;
  const c = G.map.cells[y*n+x];
  const td = TERRAIN_DEFS[c.terrain];
  if(td){
    if(td.impassable) return false;
    return true;
  }
  // 旧 terrain fallback（只认 void/obstacle/river 为不可通）
  if(c.terrain==='void'||c.terrain==='obstacle'||c.terrain==='river') return false;
  return true;
};


/* pre-combat UI: updateCombatUI */
function updateCombatUI(){
  const cs = combatState;
  if(!cs){ switchMode('story'); return; }
  const chars = getTeamChars();
  const cur = chars.find(c=>c.key===cs.currentChar) || chars[0];

  // 队友卡：当前 actor 高亮
  const actorKey = (cs.actor && cs.actor.who==='ally') ? cs.actor.key : null;
  qs('#allyBar').innerHTML = chars.map(c => {
    const cls = c.key===actorKey ? ' actor' : '';
    return `<div class="allyCard${cls}"><div class="allyName">${c.name}</div><div class="allyElem">${c.element?ELEM[c.element].zh:'无属性'}</div></div>`;
  }).join('');

  // 属性 + 状态栏
  qs('#charAttrs').innerHTML = charAttrsHTML(cur.key);
  qs('#statusBar').innerHTML = cur.key==='pro'
    ? statusBarHTML(heroStatusesWithDepress(cs), cs.field)
    : statusBarHTML(cs.ally[cur.key]?.statuses, null);

  // 技能列表（从 cs.slots 全取，不按角色过滤）
  const slots = cs.slots || [];
  cs.selSlot = cs.selSlot || slots[0]?.slot || 1;
  const selSlotNum = cs.selSlot;

  const fleeBase = cs.enemies[0];
  const fleeTag = fleeBase ? `<div class="skillTag escape"><span class="skillNum">🛸</span>逃　跑 ${Math.round(calcEscapeRate(fleeBase))}%</div>` : '';

  qs('#skillList').innerHTML = slots.map(s => {
    const { c, sk } = skillGroupResolve(s);
    if(!sk) return '';
    const cd = s.cd || 0;
    const cdTxt = cd>0 ? `<span class="nohint">冷却${cd}</span>` : '';
    const isSel = s.slot === selSlotNum;
    const isMyTurn = (cs.actor?.who==='ally' && cs.actor.key===s.charKey);
    const cls = `${sk.kind==='attack'?'attack':'skill'}${isSel?' active':''}${isMyTurn?' myturn':''}`;
    const kindLabel = sk.kind==='auto'?'自动':sk.kind==='active'?'主动':sk.kind==='link'?'连携':'辅助';
    return `<div class="skillTag ${cls}" data-slot="${s.slot}">
      <span class="skillNum">${s.slot}</span>
      <span class="cat">${kindLabel}</span>
      <span class="charTag">${c?.name||'?'}</span>
      ${sk.name}${cdTxt}
    </div>`;
  }).join('') + fleeTag;

  // 点击选中 → 再点一次释放
  qs('#skillList').querySelectorAll('.skillTag[data-slot]').forEach(b => {
    b.onclick = () => {
      const n = +b.dataset.slot;
      if(cs.selSlot === n){
        const slot = cs.slots.find(x=>x.slot===n);
        if(slot) castSkill(slot.charKey, true, slot);
      } else {
        cs.selSlot = n;
        updateCombatUI(); renderCombatMap();
      }
    };
  });
  qs('#skillList').querySelector('.skillTag.escape')?.addEventListener('click', tryFlee);

  // 天赋
  qs('#talentBox').innerHTML = cur.passives.map((p,i) => {
    const name = p.scal ? talentDisplayName(cur.key,p) : p.name;
    return `<span class="talentTag" data-k="${cur.key}" data-i="${i}"><span class="cat talent">天赋</span>${name}</span>`;
  }).join('');

  // 技能详情
  const selSlotObj = slots.find(x => x.slot === selSlotNum);
  let detailHtml = '<div class="skillDetailText">点技能查看详情（点一次选中，再点一次释放）</div>';
  if(selSlotObj){
    const { c, sk } = skillGroupResolve(selSlotObj);
    if(sk){
      detailHtml = `<div class="skillDetailName">[槽${selSlotObj.slot}] ${c?.name||'?'} · ${sk.name}</div>
        <div class="skillDetailText">${describeSkill(selSlotObj.charKey, sk)}</div>`;
    }
  }
  qs('#skillDetail').innerHTML = detailHtml;
}


/* pre-combat UI: renderCombatMap */
function renderCombatMap(){
  if(!combatState) return;
  const cs = combatState;
  const m = G.map;
  const grid = qs('#mapGrid');
  grid.style.gridTemplateColumns = `repeat(${m.n},44px)`;
  grid.innerHTML = '';

  // 范围高亮：当前选中 slot 对应技能的范围
  let rangeKeys = new Set();
  const selSlotNum = cs.selSlot || 1;
  const selSlot = (cs.slots||[]).find(x => x.slot===selSlotNum);
  if(selSlot){
    const { c, sk } = skillGroupResolve(selSlot);
    if(sk && sk.target){
      const cells = skillRangeCells(sk, cs.hero, cs.hero.facing);
      rangeKeys = new Set(cells.map(c=>c.x+','+c.y));
    }
  }

  for(let y=0;y<m.n;y++) for(let x=0;x<m.n;x++){
    const c = m.cells[y*m.n+x];
    const cell = el('<div class="cell"></div>');
    if(c.terrain==='obstacle') cell.classList.add('obstacle');
    else if(c.terrain==='void') cell.classList.add('void');

    const key = x+','+y;
    if(rangeKeys.has(key)) cell.classList.add('range-ally');

    // 地块元素高亮边框
    if(c.element){
      const e = ELEM[c.element];
      if(e){ cell.style.outline = `2px solid ${e.c || '#fff'}`; cell.style.outlineOffset = '-2px'; }
    }

    if(cs.hero.x===x && cs.hero.y===y){ cell.classList.add('player'); cell.classList.add('facing-'+cs.hero.facing); }
    for(const en of cs.enemies){
      if(en.x===x && en.y===y){
        cell.textContent = en.icon; cell.style.color = '#fff'; cell.classList.add('efacing-'+en.facing); cell.title = en.name;
        if(en.maxHp>0) cell.innerHTML += `<div class="hpbar"><i style="width:${Math.max(0,en.hp)/en.maxHp*100}%"></i></div>`;
      }
    }
    for(const pt of (cs.pets||[])){
      if(pt.x===x && pt.y===y){ cell.textContent='🟢'; cell.title='友方草史莱姆'; if(pt.maxHp>0) cell.innerHTML+=`<div class="hpbar"><i style="width:${Math.max(0,pt.hp)/pt.maxHp*100}%;background:#6ee07a"></i></div>`; }
    }
    cell.dataset.x=x; cell.dataset.y=y;
    cell.addEventListener('click', () => combatCellClick(x,y));
    grid.appendChild(cell);
  }
}


/* pre-combat UI: selectSkill */
function selectSkill(charKey, skillId){
  const cs = combatState; if(!cs) return;
  if(!cs.slots || !cs.slots.length){ // 兜底：slots 还没建时跳过
    cs.ally[charKey].selSkill = skillId;
    updateCombatUI(); renderCombatMap();
    return;
  }
  // 从 slots 里找这个 skill（优先属主是 charKey，或全局匹配 skillId）
  let slot = cs.slots.find(s => s.charKey===charKey && s.skillId===skillId);
  if(!slot) slot = cs.slots.find(s => s.skillId===skillId);
  if(!slot) { log(`找不到技能槽：${skillId}`); return; }

  // 属主不是当前 actor → 切 actor 再用（自动状态机）
  if(slot.charKey !== charKey){
    // 直接 cast，因为当前就是 actor
  }

  // 选中 = 标记到 ally.selSkill；双击 = 释放
  cs.ally[charKey].selSkill = skillId;
  updateCombatUI(); renderCombatMap();
}

;


/* pre-combat UI: castSkill */
function castSkill(charKey, manual, slotEntry){
  const cs = combatState; if(!cs) return;
  // 权限：只能当前 actor 且就是 charKey 放
  if(!cs.actor || cs.actor.who !== 'ally' || cs.actor.key !== charKey){
    if(manual) log(`现在不是 ${getChar(charKey).name} 的行动回合。`);
    return;
  }
  if(cs.ally[charKey].used){
    if(manual) log(`本回合 ${getChar(charKey).name} 已行动。`);
    return;
  }

  // 找到 slot
  let slot = slotEntry;
  if(!slot){
    const selId = cs.ally[charKey].selSkill;
    slot = cs.slots && cs.slots.find(s => s.charKey===charKey && s.skillId===selId);
  }
  if(!slot){ if(manual) log('找不到对应的技能槽。'); return; }
  if(slot.cd > 0){
    if(manual) log(`「${slot.skillId}」冷却中（剩 ${slot.cd} 回合）。`);
    return;
  }

  const { c:char, sk:skill } = skillGroupResolve(slot);
  if(!skill){ if(manual) log('技能定义缺失。'); return; }
  if(!hasValidTarget(skill)){
    if(manual) log(`「${skill.name}」当前没有可命中的目标。`);
    return;
  }

  // 释放
  resolveSkill(charKey, skill, manual);
  if(!combatState) return;

  // 更新运行态
  slot.cd = skill.cd || 0;
  slot.usedThisRound = true;
  cs.ally[charKey].used = true;

  updateCombatUI(); renderCombatMap(); refreshHUD();

  // 手动释放：结束当前 actor，让状态机推进
  if(manual){
    _endActorTurn();
  }
}

;


/* pre-combat UI: skillRangeCells */



/* pre-combat UI: describeSkill */
function describeSkill(charKey, skill){ if(!skill) return ''; let d=skill.desc||''; const dmg=skillDamagePreview(charKey, skill); if(skill.scal){ const level=entryLevel(charKey,skill); const ext={}; if(dmg!=null&&skill.formula) ext.DMG=`${skill.formula}（当前约${dmg}点）`; const hp=healPreview(charKey,skill); if(hp) ext.Y=hp; d=lvDescText(skill,level,ext); } else { if(dmg!=null&&skill.formula) d=d.replace(/\{DMG\}/g,`${skill.formula}（当前约${dmg}点）`); if(skill.healPct) d=d.replace(/\{Y\}/g,Math.round(charAtk(charKey)*skill.healPct)); } return terms(d); };


/* pre-combat UI: skillDisplayName */
function skillDisplayName(ownerKey,s){ return s.scal?`${s.name}·等级${entryLevel(ownerKey,s)}`:s.name; };


/* pre-combat UI: talentDisplayName */
function talentDisplayName(ownerKey,p){ return p.scal?`${p.name}·等级${entryLevel(ownerKey,p)}`:p.name; };


/* pre-combat UI: charAttrsHTML */
function charAttrsHTML(key){ if(key==='pro'){ const h=G.hero; return `<span class="attr"><b>攻击</b> ${R(charAtk('pro'))}</span><span class="attr"><b>闪避率</b> ${heroDodgeRate()}%</span><span class="attr"><b>生命</b> ${R(combatState.hero.hp)}/${R(heroineMaxHp())}</span><span class="attr"><b>防御</b> ${R(totalHeroDefense())}</span><span class="attr"><b>暴击率</b> ${charCritRate(key)}%</span><span class="attr"><b>逃跑速度</b> ${R(h.escapeSpeed)}</span>`; } const c=getChar(key); return `<span class="attr"><b>攻击</b> ${R(charAtk(key))}</span><span class="attr"><b>暴击率</b> ${charCritRate(key)}%</span>`; };


/* pre-combat UI: statusBarHTML */
function statusBarHTML(statuses, extraField){ let chips=''; chips+=statusArr(statuses).map(statusChipHTML).join(''); if(extraField&&Object.keys(extraField).length){ chips+=`<span class="stlabel">全场</span>`+statusArr(extraField).map(statusChipHTML).join(''); } return `<div class="stbar">${chips||'<span class="stempty">无状态</span>'}</div>`; };


/* pre-combat UI: statusChipHTML */
function statusChipHTML(s){ const label = s.id==='poison' ? `中毒 ·${s.layers||0}层` : s.name; const safe=(s.desc||'').replace(/\"/g,'&quot;'); return `<span class="stchip st-${s.kind}" data-st="${s.id}" data-name="${s.id==='poison'?'中毒':s.name}" data-desc="${safe}">${label}${s.turns!=null?` ·${s.turns}回合`:''}</span>`; };


/* pre-combat UI: heroStatusesWithDepress */
function heroStatusesWithDepress(cs){ const s={...(cs.ally.pro.statuses||{})}; if(G.hero.depress && !s.depress){ s.depress={...((ST&&ST.depress)||{id:'depress', name:'抑郁', kind:'debuff', desc:'心理压力过高。攻击、防御强制归零。持续一整天。'})}; } return s; };


/* pre-combat UI: combatCellClick */
function combatCellClick(x,y){ const cs=combatState; if(!cs) return; if(mapDragMoved) return; cs.infoCell={x,y}; cs.pendingTarget={x,y}; const enemy=cs.enemies.find(en=>en.x===x&&en.y===y); cs.focusEnemy = enemy || null; if(enemy){ cs.selectedEnemy=enemy; cs.enemyPage=0; } updateCombatInfo(); bindCombatGo(x,y); renderCombatMap(); };


/* pre-combat UI: resolveSkill */
function resolveSkill(charKey, skill, manual){
  if(!combatState) return;
  const char = getChar(charKey);
  if(!char) return;

  // 治疗类：主目标自己（简化版）
  if(skill.healPct){
    const heal = Math.round(charAtk(charKey) * skill.healPct);
    if(charKey==='pro'){
      const cap = heroineMaxHp();
      G.hero.hp = Math.min(cap, G.hero.hp + heal);
      combatState.hero.hp = G.hero.hp;
    }
    log(`${char.name} 给自己回复 ${heal} 点生命。`);
    return;
  }

  // 吸收元素（通灵 skill.commune / 万火之源 等）—— 简化
  if(skill.applyElem && !skill.mult){
    // 纯吸收/元素附着类技能：对地块或自身用
    if(skill.applyElem){
      const idx = combatState.hero.y*G.map.n + combatState.hero.x;
      setCellElement(idx, skill.applyElem);
      log(`${char.name} 对所在地块施加了【${ELEM[skill.applyElem]?.zh||skill.applyElem}】。`);
    }
    return;
  }

  // 攻击类：找敌人
  const pool = skillEnemies(skill);
  if(!pool.length) return;

  // 选目标（简化：全目标，或随机1个）
  let targets;
  if(skill.multTarget){
    const arr = pool.slice();
    const n = Math.min(skill.multTarget, arr.length);
    targets = [];
    for(let i=0;i<n;i++) targets.push(arr.splice(Math.floor(Math.random()*arr.length),1)[0]);
  } else if(skill.randTarget || skill.target==='dist2' || skill.target==='dist3'){
    targets = [ pool[Math.floor(Math.random()*pool.length)] ];
  } else {
    targets = pool.slice();
  }

  // 偷取攻击（wish）
  let stealSt = 0;
  if(skill.stealAlliesAtk){
    for(const k of G.team){
      if(k===charKey || !combatState.ally[k]) continue;
      const s = Math.round(charAtk(k) * skill.stealAlliesAtk);
      stealSt += s;
      combatState.ally[k].stolen = (combatState.ally[k].stolen||0) + s;
    }
    combatState.ally[charKey].gain = (combatState.ally[charKey].gain||0) + stealSt;
    if(stealSt>0) log(`${char.name} 偷取 ${stealSt} 点攻击（来自队友）。`);
  }

  let effBase = charAtk(charKey);
  const mom = combatState.ally[charKey]?.mom || 0;
  const critThis = Math.random()*100 < charCritRate(charKey);
  let finalType = skill.type || 'physical';
  if(charKey==='luyouyou' && critThis && finalType==='physical') finalType = 'wind';

  let hitAny = false;
  for(const enemy of targets){
    if(!combatState || !combatState.enemies.includes(enemy)) continue;
    let dmg = Math.max(1, Math.round(
      effBase
      * (1 - enemyResistWith(enemy, finalType)/100)
      * (skill.mult || 1)
      * (1 + mom/100)
    ));
    if(critThis) dmg = dmg * 2;

    const eh = elemHit(charKey, enemy, finalType, dmg);
    dmg = eh.final;

    const critTxt = critThis ? '<span class="crit-hint">暴击！</span>' : '';
    const dealt = damageEnemy(enemy, dmg, finalType, charKey);
    if(dealt > 0){
      hitAny = true;
      log(`${char.name} 使用 <b>${skill.name}</b>，对 ${enemy.name} 造成 ${critTxt}<b>${Math.round(dmg)}</b> 点${elemText(finalType)}。`);
    }

    // 元素附着到地块（敌人当前格）+ 燃烧/束缚
    if(!combatState) return;
    const eidx = enemy.y*G.map.n + enemy.x;
    if(finalType !== 'physical' && AURA_ELEMS.includes(finalType) && !AFFIN_IMMUNE[enemy.key]){
      setCellElement(eidx, finalType);
    }
    if(skill.burnDur || skill.burn){
      addStatus(enemy.statuses, 'burn', skill.burnDur || skill.burn);
      log(`${enemy.name} 进入【燃烧】状态。`);
    }
    if(skill.bindTurns || skill.bind){
      addStatus(enemy.statuses, 'bind', skill.bindTurns || skill.bind);
      log(`${enemy.name} 被【束缚】。`);
    }
  }

  // 战后天赋钩子
  if(hitAny){
    applyTalentOnAttack(charKey, Math.round(effBase));
    if(critThis && charKey==='luyouyou') triggerBiyi();
    consumeCritBuff(charKey);
  }
  checkCombatEnd();
}

;


/* pre-combat UI: hasValidTarget */
function hasValidTarget(skill){
  if(!combatState) return false;
  if(skill.kind==='link'){
    // link 技能条件检查（简化：有 trigger 就检查，没 trigger 就默认没条件）
    if(skill.trigger==='allyApplyElem' || skill.trigger==='anyBurned'){
      return skillEnemies(skill).length > 0;
    }
    return true;  // 其他 trigger 暂不判定，默认可用
  }
  if(skill.kind==='support' || skill.kind==='self') return true;
  return skillEnemies(skill).length > 0;
}

;
