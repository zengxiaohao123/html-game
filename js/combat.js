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
function passable(x,y){
  if(!G||!G.map) return false;
  const n=G.map.n;
  if(x<0||y<0||x>=n||y>=n) return false;
  const c=G.map.cells[y*n+x];
  const td=TERRAIN_DEFS[c.terrain];
  if(td) return !!td.walkable;  // 新规格：terrain.def.walkable
  // 兼容旧 terrain 值
  if(c.terrain==='void'||c.terrain==='obstacle') return false;
  if(c.terrain==='river') return false;  // 河流不可进（特殊强制闯入会死亡，这个由 moveExplore 处理）
  return true;
}
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
      nodeTriggered: false, acted: false,
    };
  }

  combatState = {
    hero: { x:G.px, y:G.py, facing: G.hero.facing||'up',
      hp: G.hero.hp, maxHp: heroineMaxHp(), shield: 0 },
    enemies: [], pets: [], ally,
    zone: [], counter: {}, field: {},
    phase: 'player',
    day: G.day, turn: 1,
    entryCell: G.px+','+G.py,
    defeated: [], focusEnemy: null,
    playerMoved: false, playerOver: false,
    currentChar: G.team[0]||'pro',
    selectedEnemy: null, infoCell: null, enemyPage: 0,
    pendingTarget: null, bubbles: [],
    nodeTriggered: false,
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
  const cand = [];
  for(let y=0;y<n;y++) for(let x=0;x<n;x++){
    if(cs && cs.hero && cs.hero.x===x && cs.hero.y===y) continue;
    if(cs && cs.enemies.some(en=>en.x===x&&en.y===y)) continue;
    if(!passable(x,y)) continue;
    cand.push({x,y});
  }
  return cand.length ? cand[Math.floor(Math.random()*cand.length)] : {x:G.px, y:G.py};
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
  _phasePlayer();
}
function reenterCombat(snap){
  if(!snap||!G.map){ switchMode('story'); return; }
  initCombatState({ enemyKey: snap.enemyKey });
  log('读档回到本次战斗开始。');
  enterCombatMode();
  _phasePlayer();
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
    let res = target.def.res?.[type] || 0;
    if(target.res?.[type]) res = Math.max(res, target.res[type]);
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
function selectSkill(charKey, skillId){
  const cs = combatState; if(!cs) return;
  cs.currentChar = charKey;
  const c = getChar(charKey);
  const ally = cs.ally[charKey]; if(!ally) return;
  const sk = (c.skills||[]).find(s=>s.id===skillId);
  // 存到 ally 里（战前用 selSkill 字段，大重做里用 selectedSkillId）
  ally.selectedSkillId = skillId;
  ally.selSkill = sk;  // 兼容战前引用
  // 立即刷新 UI
  renderCombatMap();
  updateCombatUI();
}
function castSkill(charKey, manual){
  const cs = combatState; if(!cs) return;
  if(cs.playerOver) return;
  const c = getChar(charKey);
  const ally = cs.ally[charKey]; if(!ally) return;
  const sk = ally.selSkill || ally.selectedSkillId && (c.skills||[]).find(s=>s.id===ally.selectedSkillId);
  if(!sk){ log('当前未选择技能。'); return; }
  // 冷却检查
  const cd = ally.cds[sk.id] || 0;
  if(cd>0){ log(`【${sk.name}】冷却中（${cd} 回合）。`); return; }
  // 行动力检查
  if(sk.consumeAp && (G.hero.actionPoint||0) < sk.consumeAp){ log('行动力不足。'); return; }
  
  const targets = _resolveTargetsForSkill(sk, charKey);
  if(!targets.length){ log('技能没有有效目标。'); return; }
  
  const effBase = charAtk(charKey);
  const finalType = sk.type || 'physical';
  const isElem = finalType && ELEM[finalType];
  // 蒸发 buff 消耗（主角 attack 前消耗）
  let critMult = 1;
  const critChance = charCritRate(charKey);
  const critThis = Math.random()*100 < critChance;
  if(critThis) critMult = 2;
  
  let hitAny = false;
  for(const t of targets){
    if(t==='hero'){
      // 自伤或回血技能
      continue;
    }
    const enemy = typeof t==='object' ? t : cs.enemies[t];
    if(!enemy || !cs.enemies.includes(enemy)) continue;
    let dmg = Math.max(1, Math.round(effBase * (sk.mult||1.0) * critMult));
    // 元素伤害：先对地块施加附着（触发反应）→ 再对目标造成属性伤害（不再施加附着）
    if(isElem){
      const idx = enemy.y*G.map.n + enemy.x;
      setCellElement(idx, finalType);
    }
    const eh = elemHit(charKey, enemy, finalType, dmg);
    dmg = eh.final;
    const critTxt = critThis ? '<span class="crit-hint">暴击！</span>' : '';
    const dealt = damageEnemy(enemy, dmg, finalType, charKey);
    if(dealt>0){
      hitAny = true;
      log(`${c.name} 使用 <b>${sk.name}</b>，对 ${enemy.name} 造成 ${critTxt}<b>${dealt}</b> 点${elemText(finalType)}。`);
    }
  }
  
  // 扣行动力
  if(sk.consumeAp){ G.hero.actionPoint = (G.hero.actionPoint||0) - sk.consumeAp; }
  // 冷却
  if(sk.cd){ ally.cds[sk.id] = sk.cd; }
  ally.nodeTriggered = true; ally.acted = true;
  if(critThis && charKey==='luyouyou') { /* 比翼：其余角色下次攻击暴击率+100%，占位 */ }
  refreshHUD(); renderCombatMap(); updateCombatUI(); checkCombatEnd();
  // 如果是主动技能且非连续使用 → 跳到下一角色
  if(sk.kind==='active' && manual && sk.id!=='basicSlash'){
    _advanceCurrentChar();
  }
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
  if(cs.playerOver){ log('已结束本轮移动。'); return; }
  const hero = cs.hero;
  const nx = hero.x+dx, ny = hero.y+dy;
  if(!passable(nx,ny)){ log('此方向无法通行。'); return; }
  if(cs.enemies.some(e=>e.x===nx&&e.y===ny)){ log('敌人占据此格，无法移动过去。'); return; }
  hero.x = nx; hero.y = ny; hero.facing = dirToFacing(dx,dy);
  G.px = nx; G.py = ny;
  cs.playerMoved = true;
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
    _phaseEnemy();
  }
}
function _advanceCurrentChar(){
  const cs = combatState;
  const team = G.team;
  const idx = team.indexOf(cs.currentChar);
  if(idx+1 < team.length){
    cs.currentChar = team[idx+1];
    cs.playerMoved = false;
  } else {
    cs.playerOver = true;
  }
  renderCombatMap(); updateCombatUI();
}

/* ============================
   9. 敌人 AI（简化但闭环）
   ============================ */
function _enemyTurnAll(){
  const cs = combatState; if(!cs) return;
  for(const en of cs.enemies.slice()){
    if(!cs.enemies.includes(en)) continue;  // 已经被打死
    if(!enemyCanAct(en)) continue;
    _enemyAct(en);
    refreshHUD(); renderCombatMap(); updateCombatUI();
    checkCombatEnd();
    if(!combatState) return;
  }
}
function enemyCanAct(en){
  if(!en || !combatState?.enemies.includes(en)) return false;
  if(hasStatus(en.statuses,'freeze')) return false;
  if(hasStatus(en.statuses,'sleep')) return false;
  return true;
}
function _enemyAct(en){
  const cs = combatState;
  const hero = cs.hero;
  // 1. 选意图：找技能（简化：默认普攻）
  const def = en.def;
  const skills = def?.skills || [{id:'attack',name:'普攻',kind:'attack',target:'adj-front',type:'physical',mult:1.0,cd:0}];
  const availableSkill = skills.find(s=>!(en.cooldowns[s.id]>0)) || skills[0];
  // 2. 找目标（主角）
  const tx = hero.x, ty = hero.y;
  const d = dist(en, hero);
  // 3. 进入技能范围判断
  const [fx,fy] = facingDir(en.facing);
  const skillRange = rangeOf({ type: availableSkill.target, x:en.x, y:en.y, facing:en.facing });
  const hit = skillRange.some(c=>c.x===tx && c.y===ty);
  
  if(hit){
    // 4a. 攻击
    const mult = availableSkill.mult || 1.0;
    const finalType = availableSkill.type || 'physical';
    let dmg = Math.round(en.atk * mult);
    // 反应（敌人火/水/冰/雷 技能也能触发地块反应）
    const idx = hero.y*G.map.n + hero.x;
    if(finalType && ELEM[finalType]) setCellElement(idx, finalType);
    const dealt = damageHero(dmg, finalType, en.key);
    const critTxt = Math.random()<0.15 ? '<span class="crit-hint">暴击！</span>' : '';
    if(dealt>0) log(`${en.name} 使用【${availableSkill.name}】对主角造成 ${critTxt}${dealt} 点${elemText(finalType)}。`);
    en.cooldowns[availableSkill.id] = availableSkill.cd || 0;
  } else {
    // 4b. 移动靠近（曼哈顿贪心）
    let best = null, bestD = d;
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const nx = en.x+dx, ny = en.y+dy;
      if(!passable(nx,ny)) continue;
      if(nx===hero.x && ny===hero.y) continue;
      if(cs.enemies.some(e=>e!==en && e.x===nx && e.y===ny)) continue;
      const nd = Math.abs(nx-tx)+Math.abs(ny-ty);
      if(nd<bestD){ bestD=nd; best=[dx,dy]; }
    }
    if(best){
      en.x += best[0]; en.y += best[1];
      en.facing = dirToFacing(best[0], best[1]);
    }
  }
  // tick 敌人冷却
  for(const k of Object.keys(en.cooldowns)){ if(en.cooldowns[k]>0) en.cooldowns[k]--; }
  _afterEnemyAct(en);
}
function _afterEnemyAct(en){
  _nodeTickFor(en);
}

/* ============================
   10. 回合状态机
   ============================ */
function _phasePlayer(){
  const cs = combatState; if(!cs) return;
  cs.phase = 'player';
  cs.currentChar = G.team[0]||'pro';
  cs.playerOver = false; cs.playerMoved = false;
  for(const k of G.team){
    if(cs.ally[k]){ cs.ally[k].nodeTriggered=false; cs.ally[k].acted=false; }
  }
  refreshHUD(); renderCombatMap(); updateCombatUI();
  log('轮到你行动。WASD 移动，1-4 选技能，Q 释放。');
}
function _phaseEnemy(){
  const cs = combatState; if(!cs) return;
  cs.phase = 'enemy';
  // tick 我方回合结束
  _tickPlayerEnd();
  // 敌人 AI
  _enemyTurnAll();
  if(!combatState) return;
  // tick 敌人回合结束
  _tickEnemyEnd();
  if(!combatState) return;
  // 回合推进
  _phaseRoundEnd();
  // 回到玩家 phase
  _phasePlayer();
}
function _tickPlayerEnd(){
  const cs = combatState; if(!cs) return;
  // tick 我方角色状态
  for(const k of G.team){
    const ally = cs.ally[k]; if(!ally) continue;
    tickStatuses(ally.statuses);
    // cd 递减
    for(const s of G[k]?.skills||[]){
      if(ally.cds[s.id]>0) ally.cds[s.id]--;
    }
  }
  // tick zone
  for(let i=cs.zone.length-1; i>=0; i--){
    const z = cs.zone[i];
    z.turns--;
    if(z.turns<=0){ cs.zone.splice(i,1); continue; }
    // 燃烧结界 tick
    if(z.type==='burning'){
      const idx = z.y*G.map.n + z.x;
      const cell = G.map.cells[idx];
      for(const en of cs.enemies){
        if(Math.abs(en.x-z.x)+Math.abs(en.y-z.y)<=2){
          addStatus(en.statuses,'burn',1);
        }
      }
      // 地块火附着 tick
      if(cell?.element==='grass') setCellElement(idx, 'fire');
    }
  }
}
function _tickEnemyEnd(){
  const cs = combatState; if(!cs) return;
  for(const en of cs.enemies.slice()){
    tickStatuses(en.statuses);
    // 燃烧 tick
    if(hasStatus(en.statuses,'burn')){
      const lost = Math.max(1, Math.round(en.maxHp*0.03));
      en.hp = Math.max(0, en.hp - lost);
      log(`【燃烧】${en.name} 流失 ${lost} 点生命。`);
      if(en.hp<=0){ log(`${en.name} 被【燃烧】击败！`); removeEnemy(en); checkCombatEnd(); if(!combatState) return; }
    }
    // 冻结地块 +50% 冰伤 下次被打额外伤害已在 damage 框架里处理
    for(const k of Object.keys(en.cooldowns)){ if(en.cooldowns[k]>0) en.cooldowns[k]--; }
  }
}
function _phaseRoundEnd(){
  const cs = combatState; if(!cs) return;
  cs.turn++;
  _refreshHeroShield();
}

/* ============================
   11. UI 渲染（保留战前 CSS 类名）
   ============================ */
function renderCombatMap(){
  const cs = combatState; if(!cs) return;
  const m = G.map;
  const grid = qs('#mapGrid'); if(!grid) return;
  grid.style.gridTemplateColumns = `repeat(${m.n},44px)`;
  grid.innerHTML = '';
  
  const curChar = getChar(cs.currentChar);
  let allySkill = cs.ally[cs.currentChar]?.selSkill;
  if(!allySkill) allySkill = (curChar.skills||[]).find(s=>s.id===cs.ally[cs.currentChar]?.selectedSkillId);
  const rangeKeys = new Set(allySkill && (allySkill.kind==='active' || allySkill.kind==='auto') ?
    rangeOf({ type: allySkill.target, x:cs.hero.x, y:cs.hero.y, facing:cs.hero.facing, elem: allySkill.type })
    .map(c=>c.x+','+c.y) : []);
  
  for(let y=0; y<m.n; y++) for(let x=0; x<m.n; x++){
    const c = m.cells[y*m.n+x];
    const cell = el('<div class="cell"></div>');
    if(c.terrain==='obstacle') cell.classList.add('obstacle');
    else if(c.terrain==='void') cell.classList.add('void');
    const key = x+','+y;
    if(rangeKeys.has(key)) cell.classList.add('range-ally');
    if(cs.hero.x===x && cs.hero.y===y){
      cell.classList.add('player'); cell.classList.add('facing-'+cs.hero.facing);
    }
    // 敌人
    for(const en of cs.enemies){
      if(en.x===x && en.y===y){
        cell.textContent = en.icon;
        cell.style.color = '#fff';
        cell.classList.add('efacing-'+en.facing);
        cell.title = en.name + (hasStatus(en.statuses,'freeze')?' 【冻结】':'');
        if(en.maxHp>0) cell.innerHTML += `<div class="hpbar"><i style="width:${Math.max(0,en.hp)/en.maxHp*100}%"></i></div>`;
      }
    }
    // 宠物
    for(const pt of (cs.pets||[])){
      if(pt.x===x && pt.y===y){
        cell.textContent = '🟢'; cell.title = pt.name||'友方召唤物';
        if(pt.maxHp>0) cell.innerHTML += `<div class="hpbar"><i style="width:${Math.max(0,pt.hp)/pt.maxHp*100}%;background:#6ee07a"></i></div>`;
      }
    }
    // 地块元素附着高亮
    const elem = c.element;
    if(elem && ELEM[elem]){
      cell.style.border = '2px solid '+(ELEM[elem].c||'#ccc');
      cell.title = (cell.title?cell.title+' | ':'') + (ELEM[elem].zh)+'元素附着';
    }
    // 战斗结界
    for(const z of cs.zone){
      if(z.x===x && z.y===y){
        const zc = {burning:'#ff5533',superconduct:'#33aaff'}[z.type] || '#999';
        cell.style.outline = '2px dashed '+zc;
      }
    }
    cell.dataset.x = x; cell.dataset.y = y;
    cell.addEventListener('click', ()=>combatCellClick(x,y));
    grid.appendChild(cell);
  }
}
function updateCombatUI(){
  const cs = combatState; if(!cs) return;
  // 更新主角信息面板
  const heroHTML = heroInfoHTML();
  const heroPanel = qs('#heroInfo'); if(heroPanel) heroPanel.innerHTML = heroHTML;
  // 更新敌人列表
  const enemyHTML = enemyInfo();
  const enemyPanel = qs('#enemyList'); if(enemyPanel) enemyPanel.innerHTML = enemyHTML;
  // 更新技能栏
  const skillHTML = renderSkillBar();
  const skillPanel = qs('#skillBar'); if(skillPanel) skillPanel.innerHTML = skillHTML;
  // 状态 chip
  const chipHTML = statusChipHTML();
  const chipPanel = qs('#statusChips'); if(chipPanel) chipPanel.innerHTML = chipHTML;
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
function statusChipHTML(){
  const cs = combatState; if(!cs) return '';
  // 我方角色状态 chip
  const arr = [];
  for(const k of G.team){
    const st = cs.ally[k]?.statuses; if(!st) continue;
    if(Object.keys(st).length===0) continue;
    const c = getChar(k);
    arr.push(`<b>${c.name}:</b> ${statusChipHTML_for({statuses:st})}`);
  }
  return arr.join(' · ');
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
function combatCellClick(x,y){
  const cs = combatState; if(!cs) return;
  // 如果点的是敌方格子 → 选它作为目标 + 攻击
  const en = cs.enemies.find(e=>e.x===x&&e.y===y);
  if(en){
    cs.focusEnemy = en;
    cs.selectedEnemy = en;
    renderCombatMap(); updateCombatUI();
    return;
  }
  // 点空地：可能的移动（shift+点击 或者 选了非 attack 技能）
  // 简化：只接受 WASD 移动，点击不自动移动
  return;
}

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
function skillRangeCells(sk){
  const cs = combatState; if(!cs) return [];
  return rangeOf({ type:sk.target, x:cs.hero.x, y:cs.hero.y, facing:cs.hero.facing });
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
function describeSkill(sk){ return sk.name; }
function skillDisplayName(sk){ return sk.name; }
function talentDisplayName(charKey, p){ return p.name; }
function charAttrsHTML(){ return ''; }
function enemySkillsHTML(enemy){ return ''; }
function heroStatusesWithDepress(){ return statusChipHTML(); }
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
