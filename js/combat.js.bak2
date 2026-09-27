/* ======================================================================
   combat.js — 大重做 v2（按 battle-spec.md 完全重写）
   
   模块切分：
     0. 工具函数 + 兼容层常量
     1. 状态系统（status meta / add / tick / arr / has）—— 原样保留
     2. 地块元素附着（setCellElement / clearCellElement）—— 写 cell.attach
     3. 元素反应引擎（11 种：蒸发/燃烧/超载/融化/扩散/结晶/绽放/感电/冻结/激化/超导）
     4. 战斗状态初始化（initCombatState 重写，保留旧字段兼容）
     5. 敌人生成（_spawnEnemy / _afterSpawnEnemy 保留外壳）
     6. 角色属性（charAtk / totalHeroDefense 等保留）
     7. 伤害框架（effectiveResistance + applyDamageWithElem 统一入口）
     8. 索敌（skillTargets 三规则 + skillEnemies）
     9. 行动节点（triggerActionNode）
    10. 回合状态机（手动→自动→召唤→中立→敌方→结束）
    11. 手动操作（combatMove / selectSkill / castSkill / resolveSkill）
    12. 自动技能 + 连携窗口
    13. 敌人 AI
    14. UI 渲染（updateCombatUI / renderCombatMap / renderSkillBar / ...）
    15. 战斗结算 + 对外兼容（passable / calcEscapeRate）

   必须暴露给外部的接口（签名不变）：
     startCombat(cell) / reenterCombat(snapshot) / enterCombatMode()
     combatState.hero / combatState.enemies / combatState.startSnapshot
     依赖 data.js：ENEMIES / PROTAGONIST / ALLIES / ELEM / TERRAIN_DEFS / ST / ELEM_LIST / rangeOf
   ====================================================================== */

"use strict";

/* ============================
   0. 工具函数 —— 原样保留
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
/* 旧版 AURA_ELEMS —— 战斗中可被附着的元素集合（7 种全可附着） */
const AURA_ELEMS = ELEM_LIST.slice();  // 用 data.js 的 ELEM_LIST（7 种）覆盖旧的 5 种
/* 各敌人对哪种元素免疫（亲和）—— 旧版元素附着系统用，保留以兼容 */
const AFFIN_IMMUNE = {slime:'grass',fireSlime:'fire',waterSlime:'water',thunderSlime:'thunder',iceSlime:'ice',windSlime:'wind',rockSlime:'rock'};

/* 拖拽地图标记位（ui.js 有定义，这里兜底） */
if(typeof mapDragMoved==='undefined') window.mapDragMoved=false;

/* ============ 技能范围 → 格子列表 ============ */
function skillRangeCells(skill, refPos, facing){
  const pos = refPos || combatState.hero;
  const fac = facing || pos.facing || 'up';
  if(typeof rangeOf === 'function' && skill && skill.target){
    const r = rangeOf(skill, pos.x, pos.y, fac);
    if(r) return r.map(c => ({x:c.x, y:c.y}));
  }
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

/* 找到范围内的敌人（按规则 1 默认：只选敌方实体） */
function skillEnemies(skill, refPos, facing){
  const pos = refPos || combatState.hero;
  const cells = skillRangeCells(skill, pos, facing);
  const keys = new Set(cells.map(c=>c.x+','+c.y));
  return combatState.enemies.filter(en => keys.has(en.x+','+en.y));
}

/* 敌人对某元素的额外伤害系数（占位 1.0） */
function enemyDmgMult(enemy, type){ return 1; }

/* 技能伤害预览 */
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

/* 治疗预览（无 healPct → 0） */
function healPreview(charKey, skill){
  if(!skill) return 0;
  if(skill.healPct) return Math.max(1, Math.round(charAtk(charKey)*skill.healPct));
  return 0;
}

/* 天赋触发回调 —— 嗜血/起势 */
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

/* 比翼 —— 陆悠悠暴击后给队友加下次暴击 buff */
function triggerBiyi(){
  for(const k of G.team){
    if(k==='luyouyou') continue;
    const sts = combatState.ally[k]?.statuses;
    if(sts) addStatus(sts, 'crit', null);
  }
  log('【比翼】触发：其余我方角色下一次攻击暴击率+100%。');
}

/* 消耗暴击 buff */
function consumeCritBuff(charKey){
  const sts = combatState?.ally[charKey]?.statuses;
  if(sts && sts.crit){
    delete sts.crit;
    log(`${getChar(charKey).name} 消耗了【屏息】，暴击加成已生效。`);
  }
}

/* 占位：旧敌人附着系统（新规格以地块附着为主） */
function setAura(enemy, elem){ }
function reapplyAura(enemy){ }
function knockBack(enemy){ }

/* 绑定 goBtn —— 信息区「前往」按钮 */
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

function moveCostFor(x,y){ return passable(x,y) ? 1 : null; }

/* ============================
   1. 状态系统 —— 原样保留
   ============================ */
function statusMeta(id){
  if(typeof ST==='object' && ST && ST[id]) return ST[id];
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
   2. 地块元素附着 —— 写 cell.attach（单字段）
   ============================ */
function setCellElement(idx, elem, opts={}){
  if(!G||!G.map) return { reacted:false };
  const cell = G.map.cells[idx];
  if(!cell) return { reacted:false };
  if(cell.terrain === 'void') return { reacted:false };   // 外部地块不接受附着
  if(!elem) return { reacted:false };

  // 旧版兼容：有些地方可能还写 cell.element
  const td = TERRAIN_DEFS[cell.terrain];
  const always = td && td.alwaysElement;

  // 同种元素 → 不叠加，直接返回
  if(cell.attach === elem) return { reacted:false, kind:'same' };

  // 有旧附着 → 触发反应判定
  if(cell.attach && cell.attach !== elem){
    const r = reactionFor(cell.attach, elem);
    if(r){
      // 反应！先短暂写入新元素（spec 要求），然后处理反应，最后清空
      const oldElem = cell.attach;
      cell.attach = elem;
      cell.element = elem;   // 兼容旧字段
      resolveReactionV2(r.key, null, idx, oldElem, elem, combatState);
      // 反应结束 → 清空该地块的全部附着
      cell.attach = null;
      cell.element = null;
      refreshAlwaysElementForCell(idx);
      return { reacted:true, kind:r.key, old:oldElem, new:elem };
    }
    // 不可反应 → 直接取代
    cell.attach = elem;
    cell.element = elem;
    refreshAlwaysElementForCell(idx);
    return { reacted:false, kind:'replaced', old:cell.attach };
  }

  // 无旧附着 → 直接设置
  cell.attach = elem;
  cell.element = elem;
  refreshAlwaysElementForCell(idx);
  return { reacted:false, kind:'set' };
}

function clearCellElement(idx){
  if(!G||!G.map) return;
  const cell = G.map.cells[idx];
  if(!cell) return;
  cell.attach = null;
  cell.element = null;
  refreshAlwaysElementForCell(idx);
}

function refreshAlwaysElementForCell(idx){
  const cell = G.map.cells[idx];
  if(!cell) return;
  const td = TERRAIN_DEFS[cell.terrain];
  if(td && td.alwaysElement){
    cell.attach = td.alwaysElement;
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

/* rangeOf 统一走 data.js 的版本 */

/* ============================
   3. 元素反应引擎 —— 完整 11 种
   ============================ */
// 反应 key（按优先级）
const REACTION_ORDER = [
  'evaporation',      // 火+水 / 水+火
  'melting',          // 火+冰
  'overload',         // 火+雷
  'bloom',            // 水+草
  'electrocharged',   // 水+雷
  'frozen',           // 水+冰
  'burning',          // 火+草
  'superconduct',     // 雷+冰
  'quicken',          // 雷+草
  'crystallize',      // 岩+火/水/雷/冰  ← 新增
  'diffusion',        // 风+任意非风
];
// 两两匹配表
const REACTION_PAIRS = {
  evaporation:    ['fire','water'],
  melting:        ['fire','ice'],
  overload:       ['fire','thunder'],
  bloom:          ['water','grass'],
  electrocharged: ['water','thunder'],
  frozen:         ['water','ice'],
  burning:        ['fire','grass'],
  superconduct:   ['thunder','ice'],
  quicken:        ['thunder','grass'],
  crystallize:    null,  // 特殊：岩+火/水/雷/冰（四选一）
};
// 各反应是否先后影响
const REACTION_ORDER_MATTERS = {
  evaporation: true, melting: true,
  overload: false, bloom: false, electrocharged: false,
  frozen: false, burning: false, superconduct: false,
  quicken: false, crystallize: false, diffusion: false,
};
// 结晶的可触发元素（岩+以下任一）
const CRYSTALLIZE_ELEMS = ['fire','water','thunder','ice'];

function reactionFor(elemA, elemB){
  if(!elemA||!elemB||elemA===elemB) return null;
  // 风 + 任意非风元素 → 扩散
  if(elemA==='wind' && ELEM_LIST.includes(elemB) && elemB!=='wind'){
    return { key:'diffusion', pair: [elemA,elemB] };
  }
  if(elemB==='wind' && ELEM_LIST.includes(elemA) && elemA!=='wind'){
    return { key:'diffusion', pair: [elemA,elemB] };
  }
  // 岩 + 火/水/雷/冰 → 结晶
  if(elemA==='rock' && CRYSTALLIZE_ELEMS.includes(elemB)){
    return { key:'crystallize', pair:[elemA,elemB] };
  }
  if(elemB==='rock' && CRYSTALLIZE_ELEMS.includes(elemA)){
    return { key:'crystallize', pair:[elemA,elemB] };
  }
  // 常规反应对
  for(const key of REACTION_ORDER){
    if(key==='diffusion' || key==='crystallize') continue;
    const pair = REACTION_PAIRS[key];
    if(!pair) continue;
    const [a,b] = pair;
    if((elemA===a&&elemB===b)||(elemA===b&&elemB===a)){
      return { key, pair:[elemA,elemB] };
    }
  }
  return null;
}

function tryReactOnAttach(idx, existingElem, newElem){
  const r = reactionFor(existingElem, newElem);
  if(!r) return null;
  resolveReactionV2(r.key, null, idx, existingElem, newElem, combatState);
  return r.key;
}

/* 反应名（中文映射） */
function reactionName(key){
  const map = {
    evaporation:'蒸发', melting:'融化', overload:'超载',
    bloom:'绽放', electrocharged:'感电', frozen:'冻结',
    burning:'燃烧', superconduct:'超导', quicken:'激化',
    crystallize:'结晶', diffusion:'扩散',
  };
  return map[key] || key;
}

/* 统一的地块坐标辅助 */
function _idxToXY(idx){ return { x: idx % G.map.n, y: Math.floor(idx / G.map.n) }; }
function _xyToIdx(x,y){ return y*G.map.n + x; }

/* 遍历周围 N 格的坐标数组（切比雪夫正方形，带自身） */
function _surround9(cx,cy){
  const out=[];
  for(let dy=-1; dy<=1; dy++) for(let dx=-1; dx<=1; dx++){
    const x=cx+dx, y=cy+dy;
    if(_inBounds(x,y)) out.push({x,y});
  }
  return out;
}
/* 曼哈顿半径 2，5 格含自身（up/down/left/right + self） */
function _surround5(cx,cy){
  const out=[{x:cx,y:cy}];
  for(const [a,b] of [[1,0],[-1,0],[0,1],[0,-1]]){
    const x=cx+a, y=cy+b; if(_inBounds(x,y)) out.push({x,y});
  }
  return out;
}

/* 在周围范围里找敌方实体 */
function _enemiesInRange(cx,cy,cells,cs){
  const out=[];
  for(const {x,y} of cells){
    const e = _entityAt(x,y,cs);
    if(e && e.faction==='enemy' && !e.dead) out.push(e);
  }
  return out;
}

/* 给定坐标 → 实体（优先 enemies，其次 兼容 pets） */
function _entityAt(x,y,cs){
  if(!cs) return null;
  const en = cs.enemies.find(e => !e.dead && e.x===x && e.y===y);
  if(en) return en;
  const hero = cs.hero;
  if(hero && hero.x===x && hero.y===y) return { faction:'ally', ...hero };
  // 队友占位（UI 可能没队友实体）
  return null;
}

/* 获取触发者实体（当前 actor / currentChar 的实体） */
function _getTriggererEntity(cs){
  if(!cs) return null;
  if(cs.actor && cs.actor.who==='ally'){
    return { key:cs.actor.key, faction:'ally' };
  }
  if(cs.currentChar){
    return { key:cs.currentChar, faction:'ally' };
  }
  return null;
}

/* 给某个阵营全部实体加 buff 层 */
function _buffsForFaction(cs, faction, buffId, stacks){
  const targets = [];
  if(faction==='ally'){
    targets.push(cs.hero);
    for(const k of G.team){ if(cs.ally && cs.ally[k]) targets.push(cs.ally[k]); }
  } else if(faction==='enemy'){
    for(const e of cs.enemies) if(!e.dead) targets.push(e);
  }
  for(const t of targets){
    if(!t) continue;
    if(!t.statuses) t.statuses = {};
    const cur = t.statuses[buffId];
    const maxStacks = 10;  // 激化上限 10
    const add = cur ? Math.min(maxStacks - (cur.layers||0), stacks) : stacks;
    if(add > 0){
      addStatus(t.statuses, buffId, null, add);
    }
  }
}

/* 主反应引擎 —— 完整 11 种 */
function resolveReactionV2(key, triggerer, idx, elemA, elemB, cs){
  if(!cs){
    // 兼容旧调用：cs 未注入时尝试用全局
    cs = combatState;
  }
  if(!cs) return;

  const { x:cx, y:cy } = _idxToXY(idx);
  const elemZh = (ELEM[elemB]||ELEM[elemA]||{}).zh || elemB || elemA;
  log(`【${reactionName(key)}】(${cx+1},${cy+1}) 触发，元素：${elemZh}。`);

  // 统一把触发者身份识别出来（用于：蒸发/融化 buff 归属、结晶护盾归属、绽放/感电归属）
  const trg = triggerer || _getTriggererEntity(cs);

  switch(key){

    /* ---------- 蒸发：顺序有影响 ---------- */
    case 'evaporation': {
      // 旧附着 elemA = 先；新附着 elemB = 后
      // 先水后火 → 触发者获 蒸发·水（下次水伤+50%）
      // 先火后水 → 触发者获 蒸发·火（下次火伤+25%）
      let buffId, plusZh;
      if(elemA==='water' && elemB==='fire'){
        buffId = 'evap_water'; plusZh = '下次水伤害+50%';
      } else {
        buffId = 'evap_fire'; plusZh = '下次火伤害+25%';
      }
      // 先给触发者（如果能识别）
      if(trg && trg.key && cs.ally && cs.ally[trg.key]){
        addStatus(cs.ally[trg.key].statuses, buffId, null, 1);
      }
      // 主角也独立获得（兼容旧行为）
      if(cs.ally && cs.ally.pro){
        addStatus(cs.ally.pro.statuses, buffId, null, 1);
      }
      log(`蒸发：${plusZh}。`);
      break;
    }

    /* ---------- 融化：顺序有影响 ---------- */
    case 'melting': {
      // 先冰后火 → 融化·冰（下次冰伤+25%）
      // 先火后冰 → 融化·火（下次火伤+50%）
      let buffId, plusZh;
      if(elemA==='ice' && elemB==='fire'){
        buffId = 'melt_ice'; plusZh = '下次冰伤害+25%';
      } else {
        buffId = 'melt_fire'; plusZh = '下次火伤害+50%';
      }
      if(trg && trg.key && cs.ally && cs.ally[trg.key]){
        addStatus(cs.ally[trg.key].statuses, buffId, null, 1);
      }
      if(cs.ally && cs.ally.pro){
        addStatus(cs.ally.pro.statuses, buffId, null, 1);
      }
      log(`融化：${plusZh}。`);
      break;
    }

    /* ---------- 超载：火+雷 → 周围 5 格敌对受 50% 触发者攻击力火伤 ---------- */
    case 'overload': {
      const atkBase = charAtk('pro') || 30;
      const targets = _enemiesInRange(cx,cy,_surround5(cx,cy),cs);
      for(const en of targets){
        applyDamageWithElem(en, Math.round(atkBase*0.5), 'fire', cs);
      }
      log(`超载：${targets.length} 个敌对单位受到 50% 攻击力火属性伤害。`);
      break;
    }

    /* ---------- 绽放：水+草 → 周围 9 格非实体地块召唤草史莱姆 ---------- */
    case 'bloom': {
      const atkBase = charAtk('pro') || 30;
      const maxHpBase = heroineMaxHp() || 100;
      // 按优先顺序：自身 → 顺时针 8 格
      const dirs = [[0,0],[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]];
      const spawnCells = [];
      for(const [dx,dy] of dirs){
        const x=cx+dx, y=cy+dy;
        if(!_inBounds(x,y)) continue;
        const ci = _xyToIdx(x,y);
        const cell = G.map.cells[ci];
        if(!cell) continue;
        if(cell.terrain==='void' || cell.terrain==='obstacle') continue;
        if(_entityAt(x,y,cs)) continue;  // 非实体地块
        spawnCells.push({x,y});
      }
      const summons = [];
      for(const {x,y} of spawnCells){
        const summon = {
          id:'summon_grass_'+Date.now()+'_'+Math.floor(Math.random()*10000),
          key:null, name:'草史莱姆·绽放', faction:'ally',
          x, y, facing:'up',
          hp:Math.max(10, Math.round(maxHpBase*0.15)),
          maxHp:Math.max(10, Math.round(maxHpBase*0.15)),
          atk:Math.max(5, Math.round(atkBase*0.3)),
          def:0, speed:0, elem:'grass',
          statuses:{}, shield:0, dead:false,
          usedThisTurn:false, nodeTriggered:false,
          isSummon:true, ownerEntityId:'pro',
          ai:'simple_chase',
          def:{ passives:[], skills:[{id:'punch',name:'普攻',kind:'active',target:'adj',type:'physical',mult:1.0,cd:0}] },
          nodeTriggered:false, acted:false, fromBloom:true,
        };
        summons.push(summon);
      }
      // 把召唤物注入 combatState（保持 cs.pets 兼容）
      if(summons.length){
        cs.pets = cs.pets || [];
        for(const s of summons){
          cs.pets.push(s);
          if(cs.enemySummonsByType) cs.enemySummonsByType.grass = cs.enemySummonsByType.grass || [];
        }
      }
      log(`绽放：${summons.length} 只草史莱姆在(${cx+1},${cy+1})周围生成。`);
      break;
    }

    /* ---------- 感电：水+雷 → 3 回合感电结界 + 25% 触发者攻击力雷伤 ---------- */
    case 'electrocharged': {
      // 展开结界
      const bd = {
        kind:'electric', id:'electric_'+Date.now()+'_'+Math.floor(Math.random()*10000),
        x:cx, y:cy, duration:3, triggerNodeEntityId:'pro', independent:true,
      };
      cs.borders = cs.borders || [];
      cs.borders.push(bd);
      cs.zone = cs.zone || [];  // 旧兼容
      cs.zone.push({ id:bd.id, type:'superconduct' /*占位*/, x:cx, y:cy, turns:3 });

      const atkBase = charAtk('pro') || 30;
      // 对周围 9 格敌对造成 25% 攻击力雷伤（结界内）
      const targets = _enemiesInRange(cx,cy,_surround9(cx,cy),cs);
      for(const en of targets){
        applyDamageWithElem(en, Math.round(atkBase*0.25), 'thunder', cs);
      }
      log(`感电：(${cx+1},${cy+1}) 展开 3 回合感电结界，${targets.length} 个敌对单位受雷属性伤害。`);
      break;
    }

    /* ---------- 冻结：水+冰 → 地块上单位获 frozen 2 回合 ---------- */
    case 'frozen': {
      // 目标：自身格 + 周围 8 格
      const allCells = _surround9(cx,cy);
      let frozenCount = 0;
      for(const {x,y} of allCells){
        const en = cs.enemies.find(e => !e.dead && e.x===x && e.y===y);
        if(en){
          addStatus(en.statuses, 'frozen', 2);
          frozenCount++;
        }
        // 主角也可能被冻结
        if(cs.hero && cs.hero.x===x && cs.hero.y===y){
          addStatus(cs.ally.pro.statuses, 'frozen', 2);
          frozenCount++;
        }
      }
      log(`冻结：${frozenCount} 个单位被冻结 2 回合。`);
      break;
    }

    /* ---------- 燃烧：火+草 → 3 回合燃烧结界（允许多个独立） ---------- */
    case 'burning': {
      const bd = {
        kind:'burn', id:'burn_'+Date.now()+'_'+Math.floor(Math.random()*10000),
        x:cx, y:cy, duration:3, triggerNodeEntityId:'pro', independent:true,
      };
      cs.borders = cs.borders || [];
      cs.borders.push(bd);
      cs.zone = cs.zone || [];
      cs.zone.push({ id:bd.id, type:'burning', x:cx, y:cy, turns:3 });
      // 给范围内敌对直接加 burn debuff
      const targets = _enemiesInRange(cx,cy,_surround9(cx,cy),cs);
      for(const en of targets){
        addStatus(en.statuses, 'burn', 3);
      }
      log(`燃烧：(${cx+1},${cy+1}) 展开 3 回合燃烧结界。`);
      break;
    }

    /* ---------- 超导：雷+冰 → 3 回合超导结界 ---------- */
    case 'superconduct': {
      const bd = {
        kind:'superconduct', id:'supercond_'+Date.now()+'_'+Math.floor(Math.random()*10000),
        x:cx, y:cy, duration:3, triggerNodeEntityId:'pro', independent:true,
      };
      cs.borders = cs.borders || [];
      cs.borders.push(bd);
      cs.zone = cs.zone || [];
      cs.zone.push({ id:bd.id, type:'superconduct', x:cx, y:cy, turns:3 });
      log(`超导：(${cx+1},${cy+1}) 展开 3 回合超导结界，雷/冰/物理抗性-40%。`);
      break;
    }

    /* ---------- 激化：雷+草 → 触发者所在阵营全单位各 +2 层 aggro ---------- */
    case 'quicken': {
      _buffsForFaction(cs, 'ally', 'aggro', 2);
      log(`激化：我方所有单位各获 2 层【激化】。`);
      break;
    }

    /* ---------- 结晶：岩+火/水/雷/冰 → 触发者获 8% 基础生命上限护盾（至少 10） ---------- */
    case 'crystallize': {
      const maxHp = heroineMaxHp() || 100;
      const shield = Math.max(10, Math.round(maxHp*0.08));
      // 触发者（或主角）获得护盾
      const targetEntity = (trg && trg.key && cs.ally && cs.ally[trg.key]) || cs.hero;
      if(targetEntity){
        targetEntity.shield = (targetEntity.shield||0) + shield;
        if(targetEntity===cs.hero && cs.ally && cs.ally.pro) cs.ally.pro.shield = targetEntity.shield;
        log(`结晶：获得 ${shield} 点护盾。`);
      }
      break;
    }

    /* ---------- 扩散：风+非风 → 周围 9 格受 30% 触发者攻击力该元素伤害 + 可能连锁 ---------- */
    case 'diffusion': {
      const targetElem = (elemA==='wind') ? elemB : elemA;  // 非风那个
      const atkBase = charAtk('pro') || 30;
      const cells = _surround9(cx,cy);
      let spreadCount = 0;
      for(const {x,y} of cells){
        const ci = _xyToIdx(x,y);
        const cell = G.map.cells[ci];
        if(!cell) continue;
        if(cell.terrain==='void' || cell.terrain==='obstacle') continue;
        // 先给地块加附着（可能触发连锁反应）
        const oldAttach = cell.attach;
        cell.attach = targetElem;
        cell.element = targetElem;
        spreadCount++;
        // 如果该地块有实体 → 造成 30% 攻击力元素伤害
        const en = cs.enemies.find(e => !e.dead && e.x===x && e.y===y);
        if(en){
          applyDamageWithElem(en, Math.round(atkBase*0.3), targetElem, cs);
        }
        const heroHere = cs.hero && cs.hero.x===x && cs.hero.y===y;
        if(heroHere && cs.ally && cs.ally.pro){
          applyDamageWithElem(cs.hero, Math.round(atkBase*0.3), targetElem, cs);
        }
        // 连锁反应：如果这个地块本来有另一种可反应元素 → 再触发一次
        if(oldAttach && oldAttach !== targetElem){
          const r = reactionFor(oldAttach, targetElem);
          if(r){
            const newKey = r.key;
            cell.attach = targetElem;
            resolveReactionV2(newKey, trg, ci, oldAttach, targetElem, cs);
            cell.attach = null;
            cell.element = null;
          }
        }
      }
      log(`扩散：${spreadCount} 格地块被扩散为 ${ELEM[targetElem]?.zh||targetElem} 元素，敌对单位受 30% 攻击力元素伤害。`);
      break;
    }

    default:
      log(`元素反应 ${key} 尚未实现。`);
  }
}

/* 旧 resolveReaction 接口保持兼容（内部转调 V2） */
function resolveReaction(r){
  const cs = combatState;
  if(!cs) return;
  const idx = r.idx;
  const a = r.elemA, b = r.elemB;
  resolveReactionV2(r.key, null, idx, a, b, cs);
}

/* ============================
   4. 战斗状态初始化（initCombatState 重写，保留旧字段兼容）
   ============================ */
function initCombatState(o){
  combatState = null;
  ensureCombatTerrain();

  // 地块元素全清空（同时清空 attach + element）
  for(let i=0; i<G.map.n*G.map.n; i++){
    G.map.cells[i].attach = null;
    G.map.cells[i].element = null;
  }
  refreshAlwaysElementTerrain();

  const ally = {};
  for(const k of G.team){
    ally[k] = {
      statuses: {}, cds: {}, used: false, flatAtk: 0, stolen: 0, gain: 0,
      mom: 0, dead: false, shield: 0, hp: heroineMaxHp(), maxHp: heroineMaxHp(),
      x: G.px, y: G.py, facing: G.hero.facing||'up',
      nodeTriggered: false, acted: false,
    };
  }

  // 全局技能组运行态槽位（来自 data.js buildCombatSkillSlots）
  const slots = buildCombatSkillSlots();

  combatState = {
    // —— 实体引用（兼容旧字段）——
    hero: { x:G.px, y:G.py, facing: G.hero.facing||'up',
      hp: G.hero.hp, maxHp: heroineMaxHp(), shield: 0, statuses: {} },
    enemies: [],
    pets: [],
    ally,
    slots,

    // —— 结界（新旧并存）——
    zone: [],           // 旧兼容
    borders: [],        // 新规格

    // —— 其他运行态 ——
    counter: {}, field: {},
    day: G.day, round: 1,
    entryCell: G.px+','+G.py,
    defeated: [], focusEnemy: null, selectedEnemy: null,
    pendingTarget: null, bubbles: [],
    nodeTriggered: false,

    // —— 状态机字段 ——
    turnOrder: [], turnIndex: 0, actor: null,
    phase: 'player',
    currentChar: G.team[0]||'pro',
    playerMoved: false,
    ended: false,

    // —— 连携 ——
    linkSkills: [], linkWindowUntil: 0, linkPending: null,
    autoSkillQueue: [],
    lingeringUntil: 0,  // 残存时间结束时间戳

    // —— 读档快照 ——
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
    plan:{},  // 占位
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
  const adj = [];
  for(const [a,b] of [[1,0],[-1,0],[0,1],[0,-1]]){
    const x = hero.x+a, y = hero.y+b;
    if(x<0||y<0||x>=n||y>=n) continue;
    if(cs.enemies.some(e=>e.x===x&&e.y===y)) continue;
    const t = G.map.cells[y*n+x].terrain;
    if(t==='obstacle'||t==='void') continue;
    adj.push({x,y});
  }
  if(adj.length) return adj[Math.floor(Math.random()*adj.length)];
  return {x:Math.min(n-1, hero.x+1), y:hero.y};
}

function _refreshHeroShield(){
  const cs = combatState; if(!cs) return;
  const d = totalHeroDefense();
  if(d>0){ cs.hero.shield = d; if(cs.ally && cs.ally.pro) cs.ally.pro.shield = d; }
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

/* 对外兼容：战前函数名 */
function spawnEnemy(key){ return _spawnEnemy(key); }
function afterSpawnEnemy(e){ return _afterSpawnEnemy(e); }
function refreshHeroShield(){ _refreshHeroShield(); }
function initMapCombat(){ }

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
   5. 角色属性（charAtk / totalHeroDefense 等 —— 原样保留）
   ============================ */
function charBaseAtk(k){
  if(k==='pro') return G.hero.atk;
  if(!G.bonds||!G.bonds[k]) return 35;
  const lv = G.bonds[k].level || 1;
  return 35 + 10*lv;
}
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
  if(G.team.includes('luyouyou')) m += 100;
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
  if(combatState && combatState.ally.pro?.statuses?.crit) r += 100;
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
   6. 伤害框架（统一入口 applyDamageWithElem + 外部调用 damageEnemy/damageHero/elemHit）
   ============================ */

/* 元素抗性最终约束 -100 ~ +90 */
function effectiveResistance(res){
  res = res || 0;
  return Math.max(-100, Math.min(90, res));
}

/* 获取某目标对某元素的实际抗性（含超导结界影响） */
function _entityResistFor(target, elem, cs){
  if(!target || !elem) return 0;
  let r = 0;
  if(target === cs.hero){
    r = 0;   // 主角默认无元素抗性（由技能/天赋决定）
  } else {
    r = target.def?.res?.[elem] || 0;
    if(target.res?.[elem]) r = Math.max(r, target.res[elem]);
  }
  // 超导结界：雷/冰/物理抗性 -40%（至少 -10）
  for(const z of (cs.zone||[])){
    if(z.type==='superconduct'){
      const dx = target.x - z.x, dy = target.y - z.y;
      if(Math.abs(dx)+Math.abs(dy) <= 2){
        if(elem==='thunder' || elem==='ice' || elem==='physical'){
          r -= 40;
        }
      }
    }
  }
  return effectiveResistance(r);
}

/* 蒸发/融化 buff 消耗检查（每段伤害前调） */
function _consumeDamageBuff(statuses, elem){
  if(!statuses) return 1;
  // 蒸发·水 → 水伤 +50%；蒸发·火 → 火伤 +25%
  if(elem==='water' && statuses.evap_water){
    const layers = statuses.evap_water.layers || 1;
    delete statuses.evap_water;
    return 1 + 0.5*layers;  // +50% 每层（max 2 层 = +100%）
  }
  if(elem==='fire' && statuses.evap_fire){
    const layers = statuses.evap_fire.layers || 1;
    delete statuses.evap_fire;
    return 1 + 0.25*layers;
  }
  // 融化·冰 → 冰伤 +25%；融化·火 → 火伤 +50%
  if(elem==='ice' && statuses.melt_ice){
    const layers = statuses.melt_ice.layers || 1;
    delete statuses.melt_ice;
    return 1 + 0.25*layers;
  }
  if(elem==='fire' && statuses.melt_fire){
    const layers = statuses.melt_fire.layers || 1;
    delete statuses.melt_fire;
    return 1 + 0.5*layers;
  }
  // 激化 aggro → 草/雷伤 +10% 每一层
  if((elem==='grass' || elem==='thunder') && statuses.aggro){
    let layers = statuses.aggro.layers || 1;
    layers = Math.min(layers, 10);
    statuses.aggro.layers = layers - 1;
    if(statuses.aggro.layers <= 0) delete statuses.aggro;
    return 1 + 0.10;  // 每次消耗 1 层 = +10%（固定）
  }
  return 1;
}

/* 统一伤害入口：entity 可以是 enemy 对象 或 hero (cs.hero) */
function applyDamageWithElem(entity, baseDamage, elem, cs){
  if(!cs || !entity) return 0;
  if(cs.ended) return 0;
  if(!baseDamage || baseDamage<=0) return 0;

  let final = baseDamage;
  const isReal = elem==='real'||elem==='true';

  // 1. 蒸发/融化/激化 buff 消耗（只第一段，多段伤害每段消耗 1 层激化）
  if(!isReal){
    final = final * _consumeDamageBuff(entity.statuses, elem);
  }

  // 2. 冻结时火/雷伤害 × 1.5；但会提前解冻 + 最终伤害 +50%
  const isFrozen = hasStatus(entity.statuses, 'frozen');
  let frozenThaw = false;
  if(isFrozen && (elem==='fire'||elem==='thunder')){
    final = Math.round(final * 1.5);
    frozenThaw = true;
  }

  // 3. 元素抗性
  if(!isReal){
    const res = _entityResistFor(entity, elem, cs);
    const mult = 1 - res/100;
    final = Math.round(final * mult);
  }

  // 4. 暴击（主角攻击）—— 在调用方处理，这里只做框架
  final = Math.max(1, final);

  // 5. 主角格挡
  let blocked = false;
  if(entity === cs.hero){
    const blockP = _proBlockFromItems();
    if(blockP>0 && Math.random()*100 < blockP){
      log('主角【格挡】本次伤害被完全抵消！');
      return 0;
    }
  }

  // 6. 护盾吸收（真实也能挡）
  let through = final;
  const shieldBefore = entity.shield || 0;
  if(shieldBefore > 0){
    const absorbed = Math.min(shieldBefore, final);
    entity.shield = shieldBefore - absorbed;
    through = final - absorbed;
    if(absorbed>0) log(`护盾抵挡 ${absorbed} 点伤害。`);
    final = through;
  }

  // 7. 扣血
  if(entity === cs.hero){
    // 主角：扣 G.hero.hp 以及同步到 cs.hero
    G.hero.hp = Math.max(0, G.hero.hp - final);
    cs.hero.hp = G.hero.hp;
    // 坚守（天赋）回血
    if(final>0){
      const holdP = _proHoldFromItems();
      if(holdP>0 && G.hero.hp>0 && Math.random()*100 < holdP){
        const cap = heroineMaxHp();
        const heal = Math.max(1, Math.round(cap*0.12));
        const nx = Math.min(cap, G.hero.hp + heal);
        if(nx > G.hero.hp){
          const got = nx - G.hero.hp;
          G.hero.hp = nx; cs.hero.hp = nx;
          log(`【坚守】触发，回复 ${got} 点生命。`);
        }
      }
    }
    if(frozenThaw){
      delete entity.statuses.frozen;
      if(cs.ally && cs.ally.pro) delete cs.ally.pro.statuses.frozen;
      addStatus(cs.hero.statuses ||= {}, 'freezed_imm', 3);
      log('冻结提前结束，获得 3 回合【免疫冻结】。');
    }
    return final;
  } else {
    // 敌人
    entity.hp = Math.max(0, entity.hp - final);
    if(entity.hp <= 0){
      entity.dead = true;
    }
    if(frozenThaw){
      delete entity.statuses.frozen;
      addStatus(entity.statuses, 'freezed_imm', 3);
    }
    return final;
  }
}

/* 外部兼容：damageEnemy / damageHero / elemHit / removeEnemy / enemyNode */
function damageEnemy(enemy, dmg, type, fromKey){
  if(!enemy || !combatState?.enemies.includes(enemy)) return 0;
  if(!enemy.hp || enemy.hp<=0 || enemy.dead) return 0;
  const dealt = applyDamageWithElem(enemy, dmg, type, combatState);
  if(dealt>0) log(`${enemy.name} 受到 ${dealt} 点${elemText(type)}。`);
  if(enemy.hp<=0 || enemy.dead){
    log(`${enemy.name} 被击败！`);
    removeEnemy(enemy);
    checkCombatEnd();
  }
  return dealt;
}
function damageHero(dmg, type, fromKey){
  if(!combatState) return 0;
  const dealt = applyDamageWithElem(combatState.hero, dmg, type, combatState);
  if(dealt>0) log(`主角受到 ${dealt} 点${elemText(type)}。`);
  if(G.hero.hp<=0){
    log('你倒下了……');
    checkCombatEnd();
  }
  return dealt;
}
function elemHit(charKey, enemy, type, dmg){
  if(!combatState || !enemy) return { final:dmg, consumed:false };
  const idx = enemy.y*G.map.n + enemy.x;
  // 触发地块反应（如果有）
  const cell = G.map.cells[idx];
  if(cell && cell.attach){
    const result = setCellElement(idx, type);
    return { final:dmg, consumed: !!result.reacted, reaction: result.kind };
  } else {
    // 无旧附着 → 写入新附着
    setCellElement(idx, type);
    return { final:dmg, consumed:false };
  }
}
function removeEnemy(enemy){
  if(!combatState) return;
  const i = combatState.enemies.indexOf(enemy);
  if(i>=0) combatState.enemies.splice(i,1);
  combatState.defeated.push(enemy);
  onEnemyDefeated(enemy);
}
function onEnemyDefeated(enemy){ }
function enemyNode(){ return combatState?.enemies?.[0] || null; }

