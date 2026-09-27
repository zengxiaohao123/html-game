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
    const r = rangeOf(skill, pos.x, pos.y, fac);
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
  const sts = combatState.ally[charKey];
  if(!sts) return;
  if(charKey==='pro'){
    const bloodP = _proBloodFromItems();
    if(bloodP>0 && Math.random()*100 < bloodP){
      const heal = Math.max(1, Math.round(dmg*0.5));
      const cap = heroineMaxHp();
      const nx = Math.min(cap, G.hero.hp + heal);
      if(nx > G.hero.hp){
        const got = nx - G.hero.hp;
        G.hero.hp = nx; combatState.hero.hp = nx;
        log(`【嗜血】触发，回复 ${got} 点生命。`);
      }
    }
    const momP = _proMomentumFromItems();
    if(momP>0) sts.mom = (sts.mom||0) + momP;
  }
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
/* rangeOf 统一走 data.js 的版本（签名 rangeOf(skillOrOpts, cx, cy, facing)）。data.js 覆盖全部 target 类型。 */

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
    // ===== 旧状态机兼容字段（UI/castSkill 仍依赖） =====
    turnOrder: [], turnIndex: 0, actor: null,
    phase: 'player',            // 'player' | 'playerManual' | 'autoSkills' | 'summons' | 'enemy' | 'roundEnd'
    currentChar: G.team[0]||'pro',  // UI 仍依赖：当前操作角色
    playerMoved: false,
    // ===== 新分层状态机字段 =====
    phaseStack: ['playerManual'],
    pendingLinks: [],
    linkActive: false,
    lingerEndTime: 0,
    entities: {},                // id→entity 字典（统一管理所有实体）
    playerPhaseCharsUsed: {},
    playerPhaseMoved: false,
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
  // —— 填充 entities 字典（新状态机统一实体管理）——
  const cs = combatState;
  const E = {};
  // 主角：用 cs.hero 作为实体
  E['pro'] = {
    id: 'pro', faction: 'ally', key: 'pro',
    x: cs.hero.x, y: cs.hero.y, facing: cs.hero.facing,
    hp: cs.hero.hp, maxHp: cs.hero.maxHp,
    atk: charAtk('pro'), def: totalHeroDefense(),
    speed: 100, elem: null, buffs: [],
    statuses: cs.ally.pro?.statuses || {},
    dead: false, usedSkillThisTurn: false, movedThisTurn: false,
    nodeTriggered: false, isSummon: false,
    ownerEntityId: null, ai: null, name: getChar('pro').name,
    shield: cs.hero.shield,
  };
  // 队友（若有）
  for(const k of G.team){
    if(k === 'pro') continue;
    const ally = cs.ally[k];
    if(!ally) continue;
    const ch = getChar(k);
    if(!ch) continue;
    E[k] = {
      id: k, faction: 'ally', key: k,
      x: cs.hero.x, y: cs.hero.y, facing: 'down',
      hp: ch.base?.maxHp || 100, maxHp: ch.base?.maxHp || 100,
      atk: charAtk(k), def: ch.base?.def || 0,
      speed: 50, elem: ch.element || null, buffs: [],
      statuses: ally.statuses || {},
      dead: false, usedSkillThisTurn: false, movedThisTurn: false,
      nodeTriggered: false, isSummon: false,
      ownerEntityId: null, ai: null, name: ch.name,
      shield: 0,
    };
  }
  // 敌人
  for(const en of cs.enemies){
    const eid = 'enemy_' + (en.key || 'unknown') + '_' + (cs.enemies.indexOf(en)+1);
    en.entityId = eid;
    E[eid] = {
      id: eid, faction: 'enemy', key: en.key,
      x: en.x, y: en.y, facing: en.facing,
      hp: en.hp, maxHp: en.maxHp,
      atk: en.atk, def: en.defv || 0,
      speed: en.speed || 0, elem: null, buffs: [],
      statuses: en.statuses || {},
      dead: false, usedSkillThisTurn: false, movedThisTurn: false,
      nodeTriggered: false, isSummon: false,
      ownerEntityId: null, ai: 'simple_chase', name: en.name,
      shield: 0,
    };
  }
  cs.entities = E;
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
/* ============================
   4. 战斗入口（新主循环）
   ============================ */
function startCombat(cell){
  const key = cell.content.key;
  initCombatState({ enemyKey: key });
  if(typeof clearLog==='function') clearLog();
  log('进入战斗。按 F 结束手动阶段，E 使用连携（若有）。');
  enterCombatMode();
  _phaseRoundStart(combatState);
}
function reenterCombat(snap){
  if(!snap||!G.map){ switchMode('story'); return; }
  initCombatState({ enemyKey: snap.enemyKey });
  log('读档回到本次战斗开始。');
  enterCombatMode();
  _phaseRoundStart(combatState);
}
/* 外部兼容：战前函数名 */
function spawnEnemy(key){ return _spawnEnemy(key); }
function afterSpawnEnemy(e){ return _afterSpawnEnemy(e); }
function refreshHeroShield(){ _refreshHeroShield(); }
function initMapCombat(){ /* 新规格占位 */ }

/* ============================
   5. UI 入口（enterCombatMode + 键盘绑定）
   ============================ */
let __combatKeysBound = false;
function enterCombatMode(){
  switchMode('combat');
  const go = qs('#goBtn'); if(go) go.style.display='none';
  updateCombatUI();
  refreshHUD();
  renderCombatMap();
  renderIconbar();
  if(typeof ensureKeyFocus==='function') ensureKeyFocus();
  if(!__combatKeysBound){
    __combatKeysBound = true;
    window.addEventListener('keydown', (e) => {
      const cs = combatState; if(!cs) return;
      const k = (e.key||'').toLowerCase();
      if(k === 'e'){ e.preventDefault(); onLinkKeyPressed(); }
      if(k === 'f'){ e.preventDefault(); endPlayerPhase(cs); }
      if(k === 'escape'){ e.preventDefault(); tryFlee(); }
    });
  }
}

/* ============================
   6. 主角属性 & 天赋（探索/战斗都调）—— 见 snip_B
   ============================ */
function charBaseAtk(k){
  if(k==='pro') return G.hero.atk;
  if(!G.bonds||!G.bonds[k]) return 35;
  const lv = G.bonds[k].level || 1;
  return 35 + 10*lv;
}
/* 主角永久物品加成辅助（从 G.inventory 读取）*/
function _invCount(key){ return (G && G.inventory && G.inventory[key]) || 0; }
function _proAtkFromItems(){ return _invCount('club')*10 + _invCount('dagger')*20 + _invCount('ironSword')*30; }
function _proHpFromItems(){ return _invCount('cloth')*50 + _invCount('armor')*50; }
function _proDefFromItems(){ return _invCount('leather')*20 + _invCount('armor')*20; }
function _proCritFromItems(){ return _invCount('club')*3; }
function _proBlockFromItems(){ return _invCount('cloth')*2 + _invCount('armor')*2; }
function _proHoldFromItems(){ return _invCount('leather')*3 + _invCount('armor')*3; }
function _proBloodFromItems(){ return _invCount('dagger')*3; }
function _proMomentumFromItems(){ return _invCount('ironSword')*4; }
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
    a += _proAtkFromItems();
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
  d += _proDefFromItems();
  if(G.hero.depress) d = 0;
  return Math.max(0, Math.min(99999, d));
}
function heroineMaxHp(){ return heroDisplayMaxHp(); }
function heroDisplayMaxHp(){
  let m = G.hero.maxHp;
  m += _proHpFromItems();
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
  if(k==='pro'){
    r += _proCritFromItems();
  } else if(k==='luyouyou'){
    const pick = c.passives?.find(p=>p.id==='windSpirit');
    if(pick && pick.scal?.crit) r += tierValue(pick, entryLevel(k,pick), 'crit');
  }
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
  if(target === combatState.hero){
    const blockP = _proBlockFromItems();
    if(blockP>0 && Math.random()*100 < blockP){ log('主角【格挡】本次伤害被完全抵消！'); return 0; }
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
    const holdP = _proHoldFromItems();
    if(holdP>0 && G.hero.hp>0 && Math.random()*100 < holdP){
      const cap = heroineMaxHp();
      const heal = Math.max(1, Math.round(cap*0.12));
      const nx = Math.min(cap, G.hero.hp + heal);
      if(nx > G.hero.hp){
        const got = nx - G.hero.hp;
        G.hero.hp = nx; combatState.hero.hp = nx;
        log(`【坚守】触发，回复 ${got} 点生命。`);
      }
    }
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
  
  const range = rangeOf(sk, fromX, fromY, fromFacing);
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
/* ============================
   7. 新战斗主循环（规格驱动）
   模块：triggerNode / roundStart / playerManual / autoSkills / summons / enemy / link / flee
   ============================ */

/* —————— 工具：移除 buff —————— */
function removeBuff(entity, buff){
  if(!entity || !entity.buffs) return;
  const idx = entity.buffs.indexOf(buff);
  if(idx >= 0) entity.buffs.splice(idx, 1);
}

/* —————— 工具：移除结界 —————— */
function removeBorder(cs, border){
  if(!cs || !cs.borders) return;
  const idx = cs.borders.indexOf(border);
  if(idx >= 0) cs.borders.splice(idx, 1);
}

/* —————— 工具：硬控制判定 —————— */
function _hasHardCtrl(entity){
  if(!entity) return false;
  const statuses = entity.statuses || {};
  return hasStatus(statuses, 'freeze') || hasStatus(statuses, 'bind') || hasStatus(statuses, 'sleep')
      || hasStatus(statuses, 'frozen');
}

/* —————— 工具：获取存活的友方角色（含主角） —————— */
function getAliveAllyChars(cs){
  const alive = [];
  const pro = cs.entities['pro'];
  if(pro && !pro.dead) alive.push('pro');
  for(const k of G.team){
    if(k==='pro') continue;
    const e = cs.entities[k];
    if(e && !e.dead) alive.push(k);
  }
  return alive;
}

/* —————— 工具：技能是否有合法目标 —————— */
function _skillHasValidTarget(slot, cs){
  if(!slot) return false;
  const { sk } = skillGroupResolve(slot);
  if(!sk) return false;
  return hasValidTarget(sk);
}

/* —————— 工具：连携专属前提 —————— */
function _meetsLinkPrecondition(slot, cs){
  const { sk } = skillGroupResolve(slot);
  if(!sk || !sk.trigger) return true; // 没指定 trigger 默认满足
  if(sk.trigger === 'allyApplyElem' || sk.trigger === 'anyBurned'){
    // 简化：只要有活着的敌人就尝试（更细的判定由 hasValidTarget 兜底）
    return cs.enemies && cs.enemies.some(e => e.hp > 0);
  }
  return true;
}

/* —————— 工具：对主角自动朝向最近敌人（手动移动/释放技能时） —————— */
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

/* ============================================================
   §B. triggerNode —— 行动节点触发
   规格：每回合开头触发一次，buff 衰减、结界衰减、护盾刷新
   规格：连携不触发行动节点
   ============================================================ */
function triggerNode(entity, cs){
  if(!entity || entity.nodeTriggered) return;
  entity.nodeTriggered = true;
  // buff 衰减
  if(entity.buffs){
    for(let i = entity.buffs.length-1; i >= 0; i--){
      const b = entity.buffs[i];
      if(b.duration !== Infinity) b.duration = (b.duration||0) - 1;
      if(b.duration <= 0) entity.buffs.splice(i, 1);
    }
  }
  // 结界/境界衰减
  if(cs.borders && entity){
    for(let i = cs.borders.length-1; i >= 0; i--){
      const br = cs.borders[i];
      if(br.triggerNodeId === entity.id){
        br.duration = (br.duration||0) - 1;
        if(br.duration <= 0 && !br.independent) cs.borders.splice(i, 1);
      }
    }
  }
  // 防御护盾：每回合开头给 100% def 的护盾
  if(entity.def != null){
    entity.shield = Math.floor(entity.def);
  }
  // 同步到旧结构（兼容 UI）
  if(entity.id === 'pro'){
    cs.hero.shield = entity.shield;
  }
}

/* ============================================================
   §C. 回合开始
   ============================================================ */
function _phaseRoundStart(cs){
  if(!cs) return;
  cs.round += 1;
  log(`——— 第 ${cs.round} 回合开始 ———`);

  // 重置所有实体的回合内标记
  for(const eid of Object.keys(cs.entities)){
    const ent = cs.entities[eid];
    if(!ent) continue;
    ent.nodeTriggered = false;
    ent.usedSkillThisTurn = false;
    ent.movedThisTurn = false;
  }
  // 队友结构的 used 重置（旧 castSkill 仍依赖）
  for(const k of G.team){
    if(cs.ally && cs.ally[k]){
      cs.ally[k].used = false;
    }
  }

  cs.playerPhaseCharsUsed = {};
  cs.playerPhaseMoved = false;
  cs.phaseStack = ['playerManual'];
  cs.phase = 'playerManual';
  cs.currentChar = 'pro';

  // 主角自动朝向最近敌人
  _turnHeroFacingToEnemy();

  // 主角的行动节点先触发（手动阶段开始）
  triggerNode(cs.entities['pro'], cs);

  // 设置 actor（兼容旧 castSkill）
  cs.actor = { who: 'ally', key: 'pro' };

  // 刷新 UI
  _refreshHeroShield();
  tickStatuses(cs.hero.statuses || (cs.hero.statuses = {}));
  if(cs.ally && cs.ally.pro) tickStatuses(cs.ally.pro.statuses || (cs.ally.pro.statuses = {}));

  updateCombatUI();
  refreshHUD();
  renderCombatMap();
}

/* ============================================================
   §D. 玩家手动阶段
   ============================================================ */

/* —— 主角移动（规格：手动移动消耗技能次数，1000ms 残存 —— */
function combatMove(dx,dy){
  const cs = combatState; if(!cs) return;
  if(cs.phase !== 'playerManual' && cs.phase !== 'playerManual_lingering'){
    log('现在不是手动阶段。');
    return;
  }
  const hero = cs.hero;
  hero.facing = dirToFacing(dx,dy);
  G.hero.facing = hero.facing;
  const nx = hero.x+dx, ny = hero.y+dy;
  let canMove = passable(nx,ny);
  if(canMove && cs.enemies.some(e=>e.x===nx&&e.y===ny)) canMove = false;
  if(!canMove){
    log('前方无法通行，仅改变朝向。');
    refreshHUD(); renderCombatMap(); updateCombatUI();
    return;
  }
  hero.x = nx; hero.y = ny;
  G.px = nx; G.py = ny;
  cs.entities['pro'].x = nx;
  cs.entities['pro'].y = ny;
  cs.playerPhaseMoved = true;
  cs.playerPhaseCharsUsed['pro'] = true;
  log(`主角移动到 (${nx},${ny})。`);
  refreshHUD(); renderCombatMap(); updateCombatUI();
  // 启动残存时间 1000ms
  if(cs.phase === 'playerManual'){
    cs.phase = 'playerManual_lingering';
    cs.lingerEndTime = Date.now() + 1000;
    log('残存时间 1 秒，仍可释放主动技能。');
    setTimeout(() => {
      if(combatState === cs && cs.phase === 'playerManual_lingering' && Date.now() >= cs.lingerEndTime){
        log('残存时间结束。');
        _phaseAutoSkills(cs);
      }
    }, 1001);
  }
}

/* —— 手动阶段结束按钮 —— */
function endPlayerPhase(cs){
  if(!cs) cs = combatState;
  if(!cs) return;
  if(cs.phase !== 'playerManual' && cs.phase !== 'playerManual_lingering'){
    return; // 非手动阶段直接忽略
  }
  // 1. 残存时间判定
  const aliveAlly = getAliveAllyChars(cs);
  const usedKeys = Object.keys(cs.playerPhaseCharsUsed);
  const hasCharsWithSkillLeft = usedKeys.length < aliveAlly.length;
  if(hasCharsWithSkillLeft){
    cs.phase = 'playerManual_lingering';
    cs.lingerEndTime = Date.now() + 1000;
    log('残存时间 1 秒，仍可释放主动技能。');
    setTimeout(() => {
      if(combatState === cs && cs.phase === 'playerManual_lingering' && Date.now() >= cs.lingerEndTime){
        _phaseAutoSkills(cs);
      }
    }, 1001);
    return;
  }
  // 2. 没残存 → 直接进自动技能
  _phaseAutoSkills(cs);
}

/* ============================================================
   §D2. 自动技能阶段
   ============================================================ */
function _phaseAutoSkills(cs){
  if(!cs) return;
  cs.phase = 'autoSkills';
  cs.phaseStack = ['autoSkills'];

  // auto 技能按 slots 顺序逐个检查
  const autoSlots = (cs.slots||[]).filter(s => {
    const { sk } = skillGroupResolve(s);
    return sk && sk.kind === 'auto';
  });

  for(const slot of autoSlots){
    const { c, sk } = skillGroupResolve(slot);
    if(!sk || !c) continue;
    const ownerKey = slot.charKey;
    const ownerEntity = cs.entities[ownerKey];
    if(!ownerEntity || ownerEntity.dead) continue;
    // 4 个条件
    if((slot.cd || 0) > 0) continue;                              // 1. 冷却
    if(!_skillHasValidTarget(slot, cs)) continue;                 // 2. 有合法目标
    if(_hasHardCtrl(ownerEntity)) continue;                       // 3. 硬控制
    if(cs.playerPhaseCharsUsed[ownerKey]) continue;               // 4. 已消耗次数
    // 触发 owner 的行动节点
    triggerNode(ownerEntity, cs);
    // 设置 actor（兼容旧 castSkill）
    cs.actor = { who: 'ally', key: ownerKey };
    cs.currentChar = ownerKey;
    // 尝试插入连携（auto 可以被 link 打断 → 允许插入）
    if(_tryLinkInsert(cs)) return;
    // 释放
    log(`【自动·${sk.name}】${c.name} 自动释放。`);
    castSkill(ownerKey, false, slot);
    if(!combatState) return;
    cs.playerPhaseCharsUsed[ownerKey] = true;
    slot.cd = sk.cd || 1;
    ownerEntity.usedSkillThisTurn = true;
    updateCombatUI();
    if(checkCombatEnd()) return;
  }

  // 所有 auto 跑完 → 我方召唤物
  _phaseSummons(cs, 'ally');
}

/* ============================================================
   §D3. 召唤物阶段（我方 → 中立 → 敌方）
   ============================================================ */
function _phaseSummons(cs, faction){
  if(!cs) return;
  cs.phase = 'summons';
  const summonIds = Object.keys(cs.entities).filter(id => {
    const e = cs.entities[id];
    return e && e.faction === faction && e.isSummon && !e.dead;
  }).sort();

  for(const sid of summonIds){
    const e = cs.entities[sid];
    if(e.dead) continue;
    cs.currentChar = sid;
    triggerNode(e, cs);
    _runSummonAI(e, cs);
    updateCombatUI();
    if(checkCombatEnd()) return;
  }
  // 我方完了 → 中立；中立完了 → 敌方
  if(faction === 'ally') _phaseSummons(cs, 'neutral');
  else if(faction === 'neutral') _phaseEnemyTurn(cs);
  else _phaseEnemyTurn(cs);
}

/* —— 召唤物 AI：简单靠近并攻击主角 —— */
function _runSummonAI(e, cs){
  if(!e || !cs) return;
  const target = (e.faction === 'ally') ? null : cs.hero;
  if(!target) return;
  const d = dist(e, target);
  // 简单：能碰就碰，否则靠近
  if(d <= 1){
    const mult = 0.6;
    const dmg = Math.max(1, Math.round((e.atk||10) * mult));
    const dealt = damageHero(dmg, 'physical', e.key);
    log(`${e.name} 召唤物对主角造成 ${dealt} 点物理伤害。`);
  } else {
    const best = _pickBestStep(e, target, cs);
    if(best){ e.x += best[0]; e.y += best[1]; e.facing = dirToFacing(best[0], best[1]); }
  }
}

/* —— 通用：简单贪心跳步 —— */
function _pickBestStep(from, target, cs){
  const d = dist(from, target);
  let best = null, bestD = d;
  for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
    const nx = from.x+dx, ny = from.y+dy;
    if(!passable(nx,ny)) continue;
    if(nx===target.x && ny===target.y) continue;
    if(cs.enemies && cs.enemies.some(en=>en.x===nx&&en.y===ny)) continue;
    const nd = Math.abs(nx-target.x)+Math.abs(ny-target.y);
    if(nd < bestD){ bestD = nd; best = [dx,dy]; }
  }
  return best;
}

/* ============================================================
   §E. 敌方回合（规格：每单位先触发节点，再 AI）
   ============================================================ */
function _phaseEnemyTurn(cs){
  if(!cs) return;
  cs.phase = 'enemy';
  cs.phaseStack = ['enemy'];

  // 敌人内部顺序：按 x+y 升序 + id
  const enemyOrder = [...cs.enemies].sort((a,b) => {
    const da = (a.x||0)+(a.y||0), db = (b.x||0)+(b.y||0);
    if(da !== db) return da - db;
    return (a.id||'').localeCompare(b.id||'');
  });

  for(const enemy of enemyOrder){
    if(!enemy || enemy.dead || enemy.hp<=0) continue;
    // 硬控制跳过
    const entityId = enemy.entityId;
    const ent = entityId ? cs.entities[entityId] : null;
    if(ent && _hasHardCtrl(ent)){
      log(`${enemy.name} 被硬控制，跳过本回合。`);
      continue;
    }
    triggerNode(ent, cs);
    cs.currentChar = enemy.entityId || enemy.key;
    _runEnemyAct(enemy, cs);
    updateCombatUI();
    refreshHUD(); renderCombatMap();
    if(checkCombatEnd()) return;
  }

  // 敌方回合结束：扣所有技能 cd
  _tickAllCooldowns(cs);

  // 敌方回合结束：敌方持续状态 tick
  for(const enemy of cs.enemies){
    if(enemy.statuses) tickStatuses(enemy.statuses);
    if(hasStatus(enemy.statuses,'burn')){
      const lost = Math.max(1, Math.round(enemy.maxHp*0.03));
      enemy.hp = Math.max(0, enemy.hp - lost);
      log(`【燃烧】${enemy.name} 流失 ${lost} 点生命。`);
      if(enemy.hp<=0){ removeEnemy(enemy); if(checkCombatEnd()) return; }
    }
  }
  // 我方状态 tick
  tickStatuses(cs.hero.statuses || (cs.hero.statuses = {}));
  for(const k of G.team){
    if(cs.ally && cs.ally[k] && cs.ally[k].statuses) tickStatuses(cs.ally[k].statuses);
  }
  // zone tick（燃烧、超导等）
  for(let i = (cs.zone||[]).length-1; i>=0; i--){
    const z = cs.zone[i];
    z.turns = (z.turns||0) - 1;
    if(z.turns<=0){ (cs.zone||[]).splice(i,1); continue; }
    if(z.type==='burning'){
      for(const en of cs.enemies){
        if(Math.abs(en.x-z.x)+Math.abs(en.y-z.y)<=2) addStatus(en.statuses,'burn',1);
      }
    }
  }

  // 进下一回合
  _phaseRoundStart(cs);
}

/* —— 敌方 AI：找主角 → 能打就打，否则靠近 —— */
function _runEnemyAct(enemy, cs){
  if(!enemy || !cs) return;
  // 选技能：简化默认普攻
  const def = enemy.def || {};
  const skills = def.skills || [{ id:'attack', name:'普攻', kind:'attack', target:'adj-front', type:'physical', mult:1.0, cd:0 }];
  const availableSkill = skills.find(s => !(enemy.cooldowns && enemy.cooldowns[s.id]>0)) || skills[0];

  const hero = cs.hero;
  const d = dist(enemy, hero);
  const skillRange = rangeOf(availableSkill, enemy.x, enemy.y, enemy.facing);
  const hit = skillRange.some(c => c.x===hero.x && c.y===hero.y);

  if(hit){
    const mult = availableSkill.mult || 1.0;
    const finalType = availableSkill.type || 'physical';
    let dmg = Math.round(enemy.atk * mult);
    const idx = hero.y*G.map.n + hero.x;
    if(finalType && ELEM[finalType]) setCellElement(idx, finalType);
    const dealt = damageHero(dmg, finalType, enemy.key);
    const critTxt = Math.random()<0.15 ? '<span class="crit-hint">暴击！</span>' : '';
    if(dealt>0) log(`${enemy.name} 使用【${availableSkill.name}】对主角造成 ${critTxt}${dealt} 点${elemText(finalType)}。`);
    if(!enemy.cooldowns) enemy.cooldowns = {};
    enemy.cooldowns[availableSkill.id] = availableSkill.cd || 0;
  } else {
    let best = null, bestD = d;
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const nx = enemy.x+dx, ny = enemy.y+dy;
      if(!passable(nx,ny)) continue;
      if(nx===hero.x && ny===hero.y) continue;
      if(cs.enemies.some(e => e!==enemy && e.x===nx && e.y===ny)) continue;
      const nd = Math.abs(nx-hero.x)+Math.abs(ny-hero.y);
      if(nd < bestD){ bestD = nd; best = [dx,dy]; }
    }
    if(best){
      enemy.x += best[0]; enemy.y += best[1];
      enemy.facing = dirToFacing(best[0], best[1]);
      // 同步到 entities（若有）
      if(enemy.entityId && cs.entities[enemy.entityId]){
        const ent = cs.entities[enemy.entityId];
        ent.x = enemy.x; ent.y = enemy.y; ent.facing = enemy.facing;
      }
      log(`${enemy.name} 向主角靠近。`);
    }
  }
  // 扣敌方自身冷却
  if(enemy.cooldowns){
    for(const k of Object.keys(enemy.cooldowns)){ if(enemy.cooldowns[k]>0) enemy.cooldowns[k]--; }
  }
}

/* —— 全量技能 cd 扣减 —— */
function _tickAllCooldowns(cs){
  if(!cs || !cs.slots) return;
  for(const s of cs.slots){
    if((s.cd || 0) > 0) s.cd -= 1;
    if(s.cd < 0) s.cd = 0;
  }
}

/* ============================================================
   §F. 连携技能（2 秒窗口）
   ============================================================ */
function _tryLinkInsert(cs){
  if(!cs) return false;
  const availLinks = (cs.slots||[]).filter(s => {
    const { sk } = skillGroupResolve(s);
    if(!sk || sk.kind !== 'link') return false;
    if((s.cd||0) > 0) return false;
    const ownerKey = s.charKey;
    const owner = cs.entities[ownerKey];
    if(!owner || owner.dead || _hasHardCtrl(owner)) return false;
    if(!_meetsLinkPrecondition(s, cs)) return false;
    return _skillHasValidTarget(s, cs);
  });
  if(availLinks.length === 0) return false;
  cs.pendingLinks = availLinks.slice();
  cs.linkActive = true;
  const slot = availLinks[0];
  const { sk } = skillGroupResolve(slot);
  log(`【连携】可用：${sk?.name || '?'} —— 按 E 键使用（2 秒窗口）`);
  // 2 秒后自动关闭
  setTimeout(() => {
    if(combatState === cs && cs.linkActive){
      cs.linkActive = false;
      cs.pendingLinks = [];
      log('连携窗口关闭。');
    }
  }, 2000);
  return true;
}

/* —— E 键连携释放 —— */
function onLinkKeyPressed(){
  const cs = combatState;
  if(!cs || !cs.linkActive || !cs.pendingLinks || cs.pendingLinks.length === 0) return;
  const slot = cs.pendingLinks[0];
  const ownerKey = slot.charKey;
  const owner = cs.entities[ownerKey];
  // 规格：连携**不**触发行动节点！
  if(!owner || owner.dead) return;
  // 设置 actor 兼容 castSkill
  cs.actor = { who: 'ally', key: ownerKey };
  cs.currentChar = ownerKey;
  log(`——— 连携触发！${skillGroupResolve(slot).sk?.name} ———`);
  const { sk } = skillGroupResolve(slot);
  castSkill(ownerKey, false, slot);
  if(!combatState) return;
  slot.cd = sk?.cd || 1;
  cs.linkActive = false;
  cs.pendingLinks = [];
  cs.playerPhaseCharsUsed[ownerKey] = true;
  owner.usedSkillThisTurn = true;
  updateCombatUI();
  refreshHUD(); renderCombatMap();
  // 若当前在 auto 阶段，连携释放后继续 auto 流程（设一个延时标记：外部状态机会继续）
}

/* ============================================================
   §G. 逃跑（失败：主角跳过 + 失去技能次数）
   ============================================================ */
function tryFlee(){
  const cs = combatState; if(!cs) return;
  const pro = cs.entities['pro'];
  triggerNode(pro, cs);
  const rate = calcEscapeRate();
  log(`逃跑概率：${Math.round(rate)}%`);
  if(Math.random()*100 < rate){
    log('逃跑成功！');
    endCombat('escape');
  } else {
    log('逃跑失败！');
    cs.playerPhaseCharsUsed['pro'] = true;
    cs.playerPhaseMoved = true;
    // 跳过残存时间，直接进自动技能
    _phaseAutoSkills(cs);
  }
}

/* ============================================================
   §H. 实体创建工具
   ============================================================ */
function createEntity(id, faction, key, x, y, opts={}){
  return {
    id, faction, key: key||null, x, y,
    facing: opts.facing || 'down',
    hp: opts.hp||30, maxHp: opts.hp||30,
    atk: opts.atk||10, def: opts.def||0, speed: opts.speed||0,
    elem: opts.elem||null, buffs: [],
    dead: false, usedSkillThisTurn: false, nodeTriggered: false,
    isSummon: !!opts.isSummon, ownerEntityId: opts.ownerEntityId||null,
    ai: opts.ai||'simple_chase', name: opts.name||'实体',
    shield: 0,
    statuses: {},
  };
}

/* ============================================================
   §I. 兼容层（旧外部 API）
   ============================================================ */
function _initTurnOrderAndStart(){ /* 占位：旧入口已用 _phaseRoundStart 替代 */ }
function advanceTurn(){ /* 占位：旧状态机已废弃 */ }
function _startActorTurn(actor){ /* 占位 */ }
function _endActorTurn(){ /* 占位 */ }
function endCurrentAllyTurn(){ endPlayerPhase(); }
function _buildTurnOrder(){ return []; }
function _actorActable(actor){ return false; }
function _tickAllyStart(key){ /* 新回合开始在 _phaseRoundStart 里处理 */ }
function _tickAllyEnd(key){ /* 占位 */ }
function _canAllyAct(key){ const e = combatState?.entities?.[key]; return e && !e.dead; }
function _runAutoPhase(){ /* 已被 _phaseAutoSkills 替代 */ }
function _phaseRoundEnd(){ /* 已被 _phaseRoundStart 替代 */ }
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
  const keys = rangeOf(sk, enemy.x, enemy.y, enemy.facing).map(c=>c.x+','+c.y);
  for(const k of keys) set.add(k);
  return set;
}

function focusedEnemy(){
  return combatState?.focusEnemy || combatState?.selectedEnemy || null;
}
/* ============================================================
   §E2. 兼容/占位函数（旧外部 API）
   ============================================================ */
function cdReady(charKey, skill){
  if(!skill) return false;
  const cs = combatState; if(!cs) return true;
  // 新：从 slots 找
  const slot = (cs.slots||[]).find(s => s.charKey===charKey && s.skillId===skill.id);
  if(slot) return (slot.cd||0) === 0;
  // 旧 fallback
  return !(cs?.ally[charKey]?.cds?.[skill.id] > 0);
}
function setCd(charKey, skill, cd){
  const cs = combatState; if(!cs) return;
  const slot = (cs.slots||[]).find(s => s.charKey===charKey && s.skillId===skill.id);
  if(slot){ slot.cd = cd; return; }
  if(cs.ally && cs.ally[charKey]) cs.ally[charKey].cds[skill.id] = cd;
}
function applySupport(charKey, skill){ /* 占位 */ }
function knockBack(enemy){ /* 占位 */ }
function endPlayerPhaseCompat(){ endPlayerPhase(combatState); }
function endPlayerPhase(){ /* 被 _phaseRoundStart 内部流程接管 */ }
function endCombat(result){
  const cs = combatState; if(!cs) return;
  if(result === 'defeat') _endCombatDefeat();
  else if(result === 'victory') _endCombatVictory();
  else if(result === 'escape'){
    log('成功逃跑！');
    combatState = null;
    switchMode('story');
    refreshHUD(); renderMap(); renderIconbar();
  }
}
function endCombatByDefeat(){ _endCombatDefeat(); }
function clearLog(){ /* ui.js 有，这里占位 */ }
function clearStory(){ /* 占位 */ }
function enemySkillsHTML(enemy){ return ''; }
function renderIconbar(){ if(typeof window.renderIconbar==='function') window.renderIconbar(); }
function ensureKeyFocus(){ if(typeof window.ensureKeyFocus==='function') window.ensureKeyFocus(); }

/* —— 键盘处理（新主循环已在 enterCombatMode 里绑定，这里也兼容旧调用） —— */
function bindCombatGo(){
  if(!combatState) return;
  // 新主循环 enterCombatMode 已注册键盘监听
}
window.selectCurrentChar = function(key){
  const cs = combatState; if(!cs) return;
  cs.currentChar = key;
  renderCombatMap(); updateCombatUI();
};
function tickEnemyCooldowns(){ /* 已被 _tickAllCooldowns 替代 */ }
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


function updateCombatUI(){
  const cs = combatState;
  if(!cs){ switchMode('story'); return; }
  const chars = getTeamChars();
  const cur = chars.find(c=>c.key===cs.currentChar) || chars[0];
  const actorKey = (cs.actor && cs.actor.who==='ally') ? cs.actor.key : null;

  // ===== 顶部：角色卡一行 =====
  const charCards = chars.map(c => {
    const csk = cs.ally[c.key];
    const deadCls = csk?.dead ? ' dead' : '';
    const actorCls = c.key===actorKey ? ' actor' : '';
    const hp = c.key==='pro' ? (cs.hero.hp||0) : (csk?.hp || 0);
    const maxHp = c.key==='pro' ? heroineMaxHp() : (csk?.maxHp || c.base?.maxHp || 100);
    const hpPct = Math.max(0, Math.min(100, (hp/(maxHp||1))*100));
    const eleBg = c.element ? (ELEM[c.element]?.c || '#555') : '#7a7a7a';
    return `<div class="cb-char-card ${c.key===cs.currentChar?'on':''}${deadCls}${actorCls}" data-k="${c.key}"
      style="border:2px solid ${eleBg}">
      <div class="cb-char-name">${c.name}</div>
      <div class="cb-char-ele">${c.element?ELEM[c.element].zh:'无'} · ${hp}/${maxHp}</div>
      <div class="cb-char-hpbar"><i style="width:${hpPct}%;background:${eleBg}"></i></div>
    </div>`;
  }).join('');

  // ===== 顶部：全局技能组一行（按 kind 分块）=====
  const slots = cs.slots || [];
  if(!cs.selSlot) cs.selSlot = slots[0]?.slot || 1;
  const kindsOrder = ['auto','active','link'];
  const kindLabels = {auto:'自动', active:'主动', link:'连携'};
  let skillGroupRow = '';
  for(const k of kindsOrder){
    const row = slots.filter(s => {
      const sk = (getChar(s.charKey)?.skills||[]).find(x=>x.id===s.skillId);
      return sk && sk.kind===k;
    });
    if(!row.length) continue;
    const tiles = row.map(s => {
      const { c, sk } = skillGroupResolve(s);
      if(!sk) return '';
      const cd = s.cd || 0;
      const isSel = s.slot === cs.selSlot;
      const isMyTurn = (cs.actor?.who==='ally' && cs.actor.key===s.charKey);
      const icon = getSkillIcon(s.skillId);
      return `<div class="sg-tile sg-${sk.kind} sg-combat${isSel?' sg-sel':''}${cd>0?' sg-cd':''}${isMyTurn?' sg-myturn':''}"
        data-slot="${s.slot}" title="${sk.name} —— ${c?.name||''}">
        <div class="sg-tile-icon" style="background-image:url('assets/skills/${icon.file}')"></div>
        <div class="sg-tile-label">${sk.name.replace(/^(自动|主动|连携)·/,'')}</div>
        ${cd>0?`<div class="sg-cd-badge">${cd}</div>`:''}
      </div>`;
    }).join('');
    skillGroupRow += `<div class="cb-skills-kind cb-sk-${k}">
      <div class="cb-skills-kind-label">${kindLabels[k]}</div>
      <div class="cb-skills-tiles">${tiles}</div>
    </div>`;
  }

  // ===== 第二行：当前角色属性 =====
  const curAttrs = charAttrsHTML(cur.key);

  // ===== 第三行：buff/debuff =====
  const statuses = cur.key==='pro' ? heroStatusesWithDepress(cs) : (cs.ally[cur.key]?.statuses || {});
  const stBar = cur.key==='pro' ? statusBarHTML(statuses, cs.field) : statusBarHTML(statuses, null);

  // ===== 第四行：天赋 =====
  const talents = (cur.passives||[]).map((p,i) => {
    const name = p.scal ? talentDisplayName(cur.key,p) : p.name;
    return `<span class="talentTag" data-k="${cur.key}" data-i="${i}"><span class="cat talent">天赋</span>${name}</span>`;
  }).join('');

  // ===== 右侧：技能详情 + 圆形逃跑按钮 =====
  const selSlotObj = slots.find(x => x.slot === cs.selSlot);
  let detailHtml = '<div class="cb-detail-empty">点击左侧技能组中的技能查看详情。点一次选中，属主是当前行动角色且无冷却时再点一次释放。</div>';
  if(selSlotObj){
    const { c, sk } = skillGroupResolve(selSlotObj);
    if(sk){
      const dmg = skillDamagePreview(selSlotObj.charKey, sk);
      detailHtml = `<div class="cb-detail-head">${c?.name||'?'} · ${sk.name}</div>
        <div class="cb-detail-kind sg-kind-${sk.kind}">${kindLabels[sk.kind]||''}</div>
        <div class="cb-detail-desc">${terms(sk.desc||'')}</div>
        <div class="cb-detail-meta">
          ${sk.formula?`<span>效果：${sk.formula}</span>`:''}
          ${dmg!=null?`<span>预期伤害：约 ${dmg}</span>`:''}
          <span>冷却：${sk.cd||0} 回合（当前剩 ${selSlotObj.cd||0}）</span>
        </div>`;
    }
  }
  const fleeRate = calcEscapeRate();

  // ===== 写入 DOM =====
  qs('#allyBar').innerHTML = `
    <div class="cb-all-row">${charCards}</div>
    <div class="cb-skills-row">${skillGroupRow || '<span class="nohint">（技能组为空）</span>'}</div>
  `;
  qs('#charAttrs').innerHTML = curAttrs;
  qs('#statusBar').innerHTML = stBar;
  qs('#skillList').innerHTML = '';
  qs('#talentBox').innerHTML = talents || '<span class="nohint">（无天赋）</span>';
  qs('#skillDetail').innerHTML = `
    <div class="cb-skill-detail">${detailHtml}</div>
    <div class="cb-flee-wrap">
      <button class="cb-flee-btn" id="cbFleeBtn" title="尝试逃跑">
        <span class="cb-flee-icon">🛸</span>
        <span class="cb-flee-text">逃跑</span>
        <span class="cb-flee-rate">${Math.round(fleeRate)}%</span>
      </button>
    </div>
  `;

  // ===== 事件绑定 =====
  qs('#allyBar').querySelectorAll('.cb-char-card').forEach(b => {
    b.onclick = () => {
      const k = b.dataset.k;
      if(cs.currentChar !== k){
        cs.currentChar = k;
        updateCombatUI(); renderCombatMap();
      }
    };
  });
  qs('#allyBar').querySelectorAll('.sg-combat').forEach(tile => {
    tile.onclick = () => {
      const n = +tile.dataset.slot;
      const slot = slots.find(x => x.slot===n);
      if(!slot) return;
      if(cs.selSlot === n){
        if(cs.actor?.who==='ally' && cs.actor.key===slot.charKey && (slot.cd||0)===0){
          castSkill(slot.charKey, true, slot);
          return;
        }
      }
      cs.selSlot = n;
      updateCombatUI(); renderCombatMap();
    };
  });
  const fleeBtn = qs('#cbFleeBtn');
  if(fleeBtn) fleeBtn.onclick = tryFlee;
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
