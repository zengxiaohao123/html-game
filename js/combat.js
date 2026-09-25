/* ============================================================
   js/combat.js —— 战斗系统核心（大重写版 v2）
   
   核心架构:
   ├─ 地块元素附着模型（map.cells[i].element —— 7 种均支持）
   ├─ 行动节点系统（每个单位独立 nodeTriggered 标记）
   ├─ 分层回合状态机
   │   回合开始 → 玩家操控 → 自动技能 → 我方召唤/中立 → 敌方回合 → 结算
   ├─ 元素反应引擎（10 种反应 + 上下文栈 + 连锁记录）
   ├─ 统一伤害/抗性/附着框架
   │   x元素伤害 = 先附着再伤害
   │   x属性伤害 = 只伤害不附着
   ├─ 连携技能 2s 窗口
   └─ 胜负判定（高于元素反应优先级）
   
   ⚠️ 实现口径完全按 data.js 里的用户硬编码定义，绝不加猜测层。
   所有内部函数以 _ 开头表示 private；对外 API 不改名（兼容 ui.js/main.js）。
   ============================================================ */
"use strict";

/* ============ 全局战斗状态 ============ */
/* combatState 在 main.js 里已声明为全局 let combatState=null;
   这里仅给结构注释，真正的结构在 initCombatState() 里创建。 */
/* combatState = {
   hero:     { x, y, facing, hp, maxHp, shield },
   enemies:  [{ key, def, name, icon, tier, x, y, facing, atk, maxHp, hp, defv, speed, res, statuses, cooldowns, nodeTriggered, acted }],
   ally:     { pro: { statuses, cds, used, nodeTriggered, acted, skillGroupIdx }, xiayang: {...}, luyouyou: {...} },
   pets:     [{ x, y, hp, atk, owner }],
   zone:     [{ id, type, x, y, remaining, casterKey }],  // 结界 (燃烧/感电/超导)
   realm:    [{ id, remaining, casterKey }],              // 境界 (全场唯一)
   counter:  { fireAbsorbed: 0, diffuseCount: 0, burnActive: [...] }, // 连携/计数
   field:    {},                                          // 旧版全场状态保留
   skillGroup:[{skill, roleKey, autoOnly}],               // 编队共享技能组
   queue:    { autoSkills:[], linkSkills:[], summons:[], neutrals:[], enemies:[] }, // 各阶段独立队列
   phase:    'start'|'player'|'residual'|'auto'|'summons'|'neutral'|'enemy'|'end',
   day, turn, entryCell, startSnapshot, defeated, focusEnemy, playerMoved, playerOver,
   linkTimer: null,                                       // 连携 2s 定时器
   lastLinkShown: null,                                   // 上一个提示的连携 id
   doubleMoveAvailable:false,                             // 风地块双动
 }; */

/* ============ 辅助工具 ============ */
function log(s){ if(!window.log) return; window.log(s); }
function prompt(s){ if(!window.prompt) return; window.prompt(s); }
function $(id){ return document.getElementById(id); }
function R(x){ return typeof x==='number' ? Math.round(x) : x; }
function dist(a,b){ return Math.abs(a.x-b.x)+Math.abs(a.y-b.y); }
function distCheb(a,b){ return Math.max(Math.abs(a.x-b.x), Math.abs(a.y-b.y)); }
function passable(x,y){
  if(!G||!G.map) return false;
  if(x<0||y<0||x>=G.map.n||y>=G.map.n) return false;
  const c=G.map.cells[y*G.map.n+x];
  if(!TERRAIN_DEFS[c.terrain]) return c.terrain==='ground';
  return !TERRAIN_DEFS[c.terrain].impassable;
}
function _getCell(x,y){ return G.map ? G.map.cells[y*G.map.n+x] : null; }

/* ============ 地块元素附着 API ============
   地块元素附着存在于 map.cells[i].element（独立于 terrain 和 content）。
   总是附着的地形：river(水)、grass(草)、ice(冰) —— 在地形刷新时自动设置。
   普通地块：setCellElement() 写入，clearCellElement() 清除。 */
function cellElementable(cell){
  const def = TERRAIN_DEFS[cell.terrain];
  return def ? def.elementable : false;
}
function setCellElement(x,y,elem, skipAlwaysCheck){
  /* 仅在战斗中生效 */
  if(!combatState) return;
  const cell = _getCell(x,y);
  if(!cell) return;
  if(!elem || !ELEM_LIST.includes(elem)) return;
  if(!cellElementable(cell)) return;  /* 山、外部地块不可附着 */
  /* 总是附着地形禁止新附着反应（但允许元素反应本身，详见 tryReactOnAttach） */
  cell.element = elem;
}
function clearCellElement(x,y, skipAlwaysRefresh){
  const cell = _getCell(x,y);
  if(!cell) return;
  cell.element = null;
  /* 总是附着地形：刷新回默认元素（除非 skipAlwaysRefresh=true） */
  if(!skipAlwaysRefresh){
    const def = TERRAIN_DEFS[cell.terrain];
    if(def && def.alwaysElement){
      cell.element = def.alwaysElement;
    }
  }
}
/* 总是附着地形的刷新（每个单位行动节点开始时调用） */
function refreshAlwaysElementTerrain(){
  for(let i=0;i<G.map.n*G.map.n;i++){
    const cell = G.map.cells[i];
    const def = TERRAIN_DEFS[cell.terrain];
    if(def && def.alwaysElement && cell.element !== def.alwaysElement){
      cell.element = def.alwaysElement;
    }
  }
}

/* ============ 元素反应引擎 ============
   
   当一个地块已有元素附着，再次被施加第二种元素附着时：
   1. 地块视为"瞬间"同时有两种元素存在（短暂瞬间，仅用于检测反应）
   2. 尝试匹配下面的反应规则
   3. 发生反应 → 结算反应效果 → 清空该地块的元素附着（然后总是附着地形立即刷新回自己的元素）
   4. 不发生反应（含同种元素、不可反应）→ 第二种附着取代第一种（同种元素：保持不变）
   5. 反应可连锁 → 先处理当前反应，记录后续触发点 → 全部处理完再恢复
   
   每种反应返回 { type, reaction, triggerKey }，其中 reaction 是：
   { key, triggerElem, existingElem, triggerer, cx, cy }
*/
const REACTION_PAIRS = [
  /* 蒸发：火+水 or 水+火，顺序有影响 */
  { key:'evaporation', pair:['fire','water'], orderMatters:true,
    apply: function(reaction){
      /* 蒸发只给触发者加 buff，不造成地块效果
         火+水 → 触发者获得 蒸发·水（下次水伤+50%）
         水+火 → 触发者获得 蒸发·火（下次火伤+25%） */
      const t = reaction.existingElem==='fire' ? 'evap_water' : 'evap_fire';
      const owner = reaction.triggerer;
      if(!owner || !owner.statuses) return;
      /* 叠加层数，最多2层 */
      const s = owner.statuses[t];
      if(!s){ addStatus(owner.statuses, t); owner.statuses[t].turns = null; owner.statuses[t].stacks = 1; }
      else { s.stacks = Math.min(2, (s.stacks||1)+1); }
      log(`【蒸发】${owner.name} 获得${ST[t].name}。`);
    }
  },
  /* 燃烧：火+草 → 生成燃烧结界 */
  { key:'burning', pair:['fire','grass'], orderMatters:false,
    apply: function(reaction){
      const cs = combatState;
      /* 该地块展开持续3回合的燃烧结界 */
      const zone = {
        id: 'burn_'+Date.now()+'_'+Math.random().toString(36).slice(2,6),
        type:'burning', x:reaction.cx, y:reaction.cy,
        turns:3, turnCounter:0, casterKey:reaction.triggererKey,
        /* 燃烧结界允许多个同名独立存在 */
      };
      cs.zones = cs.zones || [];
      cs.zones.push(zone);
      log(`【燃烧】${reaction.triggerer.name} 在地块(${reaction.cx+1},${reaction.cy+1})展开燃烧结界！`);
    }
  },
  /* 超载：火+雷 → 对周围5格与触发者敌对的单位造成触发者50%基础攻击力的火属性伤害 */
  { key:'overload', pair:['fire','thunder'], orderMatters:false,
    apply: function(reaction){
      const cs = combatState;
      const targets = rangeAdj5(reaction.cx, reaction.cy);
      let dmg = Math.max(1, Math.round(reaction.triggerer.atk * 0.5));
      for(const p of targets){
        /* 找该地块上与触发者敌对的单位 */
        const enemy = cs.enemies.find(e=>e.hp>0 && e.x===p.x && e.y===p.y);
        const heroHere = cs.hero && cs.hero.hp>0 && cs.hero.x===p.x && cs.hero.y===p.y;
        if(isEnemyTriggerer(reaction.triggererKey)){
          /* 触发者是敌方 → 打我方 */
          if(heroHere){ damageHero(dmg,'fire'); }
        } else {
          /* 触发者是我方 → 打敌方 */
          if(enemy){ damageEnemy(enemy, dmg, 'fire', 'reaction'); }
        }
      }
      log(`【超载】${reaction.triggerer.name} 在(${reaction.cx+1},${reaction.cy+1})造成 ${dmg} 点火属性伤害！`);
    }
  },
  /* 融化：火+冰 or 冰+火，顺序有影响 */
  { key:'melting', pair:['fire','ice'], orderMatters:true,
    apply: function(reaction){
      const owner = reaction.triggerer;
      const t = reaction.existingElem==='fire' ? 'melt_ice' : 'melt_fire';
      if(!owner || !owner.statuses) return;
      const s = owner.statuses[t];
      if(!s){ addStatus(owner.statuses, t); owner.statuses[t].turns = null; owner.statuses[t].stacks = 1; }
      else { s.stacks = Math.min(2, (s.stacks||1)+1); }
      log(`【融化】${owner.name} 获得${ST[t].name}。`);
    }
  },
  /* 扩散：风 + 火/水/雷/冰 四种组合 */
  { key:'diffuse', pair:['wind','fire'], apply:'diffuse', orderMatters:false },
  { key:'diffuse', pair:['wind','water'], apply:'diffuse', orderMatters:false },
  { key:'diffuse', pair:['wind','thunder'], apply:'diffuse', orderMatters:false },
  { key:'diffuse', pair:['wind','ice'], apply:'diffuse', orderMatters:false },
  /* 结晶：岩 + 火/水/雷/冰 四种组合 */
  { key:'crystallize', pair:['rock','fire'],  apply:'crystallize', orderMatters:false },
  { key:'crystallize', pair:['rock','water'], apply:'crystallize', orderMatters:false },
  { key:'crystallize', pair:['rock','thunder'], apply:'crystallize', orderMatters:false },
  { key:'crystallize', pair:['rock','ice'],  apply:'crystallize', orderMatters:false },
  /* 绽放：水+草 */
  { key:'bloom', pair:['water','grass'], orderMatters:false,
    apply: function(reaction){
      /* 在周围9格的非实体地块召唤1只属于触发者阵营的草史莱姆 */
      const targets = rangeAdj9(reaction.cx, reaction.cy);
      /* 按优先级：该地块本身 → 周围... */
      targets.sort((a,b)=> dist({x:reaction.cx,y:reaction.cy},a) - dist({x:reaction.cx,y:reaction.cy},b));
      let spawned = null;
      for(const p of targets){
        const cell = _getCell(p.x,p.y);
        if(!cell) continue;
        /* 非实体地块 = 不是 obstacle/void */
        const def = TERRAIN_DEFS[cell.terrain];
        if(!def || def.entity) continue;
        /* 不是已有实体 */
        const cs = combatState;
        const enemyHere = cs.enemies.find(e=>e.hp>0 && e.x===p.x && e.y===p.y);
        const heroHere = cs.hero && cs.hero.hp>0 && cs.hero.x===p.x && cs.hero.y===p.y;
        if(enemyHere || heroHere) continue;
        /* 召唤草史莱姆 */
        const atk = Math.round((reaction.triggerer.baseAtk||reaction.triggerer.atk||10) * 0.3);
        const pet = { key:'grassSlimeSummon', name:'草史莱姆', icon:'🟢',
          x:p.x, y:p.y, hp:Math.max(10, reaction.triggerer.maxHp? Math.round(reaction.triggerer.maxHp*0.1): 30),
          maxHp:30, atk:Math.max(5,atk), owner:reaction.triggererKey, ownerKey:reaction.triggererKey,
          statuses:{}, nodeTriggered:false, acted:false };
        cs.pets = cs.pets || [];
        cs.pets.push(pet);
        spawned = pet;
        break;
      }
      if(spawned){
        log(`【绽放】${reaction.triggerer.name} 在(${spawned.x+1},${spawned.y+1})召唤了草史莱姆！`);
      } else {
        log(`【绽放】${reaction.triggerer.name} 想召唤草史莱姆，但周围没有合适地块。`);
      }
    }
  },
  /* 感电：水+雷 → 展开感电结界 + 对范围内敌对单位造成25%攻击力雷属性伤害 */
  { key:'electrocute', pair:['water','thunder'], orderMatters:false,
    apply: function(reaction){
      const cs = combatState;
      const zone = {
        id:'elec_'+Date.now()+'_'+Math.random().toString(36).slice(2,6),
        type:'electrocute', x:reaction.cx, y:reaction.cy,
        turns:3, turnCounter:0, casterKey:reaction.triggererKey,
        /* 若所在地块后续为水附着 → 持续时间不减少（由 combat.js zone tick 处理） */
      };
      cs.zones = cs.zones || [];
      cs.zones.push(zone);
      /* 立即造成一次 25%攻击力 雷属性伤害到范围内敌对单位 */
      const targets = rangeAdj9(reaction.cx, reaction.cy);
      const dmg = Math.max(1, Math.round(reaction.triggerer.atk * 0.25));
      for(const p of targets){
        const enemy = cs.enemies.find(e=>e.hp>0 && e.x===p.x && e.y===p.y);
        const heroHere = cs.hero && cs.hero.hp>0 && cs.hero.x===p.x && cs.hero.y===p.y;
        if(isEnemyTriggerer(reaction.triggererKey)){
          if(heroHere) damageHero(dmg,'thunder');
        } else {
          if(enemy) damageEnemy(enemy, dmg, 'thunder', 'reaction');
        }
      }
      log(`【感电】${reaction.triggerer.name} 在(${reaction.cx+1},${reaction.cy+1})展开感电结界，造成 ${dmg} 点雷属性伤害！`);
    }
  },
  /* 冻结：水+冰 → 地块上的单位获得2回合冻结 */
  { key:'freeze', pair:['water','ice'], orderMatters:false,
    apply: function(reaction){
      const cs = combatState;
      /* 冻结地块上的单位 */
      const enemy = cs.enemies.find(e=>e.hp>0 && e.x===reaction.cx && e.y===reaction.cy);
      const heroHere = cs.hero && cs.hero.hp>0 && cs.hero.x===reaction.cx && cs.hero.y===reaction.cy;
      if(enemy){
        if(!enemy.statuses.freezed_imm){
          addStatus(enemy.statuses,'frozen',2);
          log(`【冻结】${enemy.name} 被冻结2回合！`);
        }
      }
      if(heroHere){
        if(!cs.ally.pro.statuses.freezed_imm){
          addStatus(cs.ally.pro.statuses,'frozen',2);
          log(`【冻结】主角被冻结2回合！`);
        }
      }
    }
  },
  /* 激化：草+雷 → 触发者所属阵营所有单位各+2层激化 */
  { key:'aggravate', pair:['grass','thunder'], orderMatters:false,
    apply: function(reaction){
      const cs = combatState;
      /* 我方 */
      if(!isEnemyTriggerer(reaction.triggererKey)){
        for(const k of G.team){
          const ally = cs.ally[k];
          if(!ally) continue;
          const s = ally.statuses.aggro;
          if(!s){ addStatus(ally.statuses,'aggro'); ally.statuses.aggro.turns = null; ally.statuses.aggro.stacks = 2; }
          else { s.stacks = Math.min(10, (s.stacks||0)+2); }
        }
      } else {
        /* 敌方阵营 */
        for(const e of cs.enemies){
          if(e.hp<=0) continue;
          const s = e.statuses.aggro;
          if(!s){ addStatus(e.statuses,'aggro'); e.statuses.aggro.turns = null; e.statuses.aggro.stacks = 2; }
          else { s.stacks = Math.min(10, (s.stacks||0)+2); }
        }
      }
      log(`【激化】${reaction.triggerer.name} 的阵营全员+2层激化！`);
    }
  },
  /* 超导：雷+冰 → 展开超导结界 */
  { key:'superconduct', pair:['thunder','ice'], orderMatters:false,
    apply: function(reaction){
      const cs = combatState;
      const zone = {
        id:'sc_'+Date.now()+'_'+Math.random().toString(36).slice(2,6),
        type:'superconduct', x:reaction.cx, y:reaction.cy,
        turns:3, turnCounter:0, casterKey:reaction.triggererKey,
      };
      cs.zones = cs.zones || [];
      cs.zones.push(zone);
      log(`【超导】${reaction.triggerer.name} 在(${reaction.cx+1},${reaction.cy+1})展开超导结界！`);
    }
  },
];
/* 快速索引：pair = [elemA, elemB] 排序后查找 */
function _pairKey(a,b){ return [a,b].sort().join('+'); }
const REACTION_INDEX = {};
(function buildIndex(){
  for(const r of REACTION_PAIRS){
    if(r.apply==='diffuse'){
      /* 扩散特殊处理：apply 字段是字符串 */
      REACTION_INDEX[_pairKey(r.pair[0],r.pair[1])] = { key:'diffuse', reaction:r };
    } else if(r.apply==='crystallize'){
      REACTION_INDEX[_pairKey(r.pair[0],r.pair[1])] = { key:'crystallize', reaction:r };
    } else {
      REACTION_INDEX[_pairKey(r.pair[0],r.pair[1])] = { key:r.key, reaction:r };
    }
  }
})();

/* ============ 单次反应触发 ============
   在"地块已有 existing 元素 → 施加 trigger 元素"时调用。
   返回 true 表示发生了反应，false 表示没有（后者 caller 再决定是取代还是忽略）。 */
function tryReactOnAttach(cx, cy, triggerElem, triggererKey){
  const cs = combatState;
  const cell = _getCell(cx,cy);
  if(!cell || !cell.element) return false;
  const existing = cell.element;
  if(existing === triggerElem){
    /* 同种元素：不反应也不叠加，保持不变 */
    return false;
  }
  /* 检查该地块是否禁止反应后新附着 */
  const def = TERRAIN_DEFS[cell.terrain];
  if(def && def.banNewElementReaction){
    /* 总是附着地形禁止第三种新附着 —— 但这时候是已有附着 + 第二种附着，
       我们仍然允许反应（因为反应规则说"任何时候允许元素反应"），
       反应结束后 banNewElementReaction 生效：会刷新回 alwaysElement */
  }
  const pairKey = _pairKey(existing, triggerElem);
  const rule = REACTION_INDEX[pairKey];
  if(!rule) return false; /* 不可反应 → caller 把 triggerElem 施加进去（取代） */
  
  /* === 发生反应 === */
  /* 1. 记录上下文（地块上瞬间同时有两种元素，只是概念意义，实际只有 existing） */
  const triggerer = _resolveTriggerer(triggererKey);
  const reaction = {
    key: rule.key, triggerElem, existingElem:existing,
    triggerer, triggererKey, cx, cy,
  };
  
  /* 2. 执行反应效果 */
  if(rule.key==='diffuse'){
    _doDiffuseReaction(reaction);
  } else if(rule.key==='crystallize'){
    _doCrystallizeReaction(reaction);
  } else if(typeof rule.reaction.apply==='function'){
    rule.reaction.apply(reaction);
  }
  
  /* 3. 清空地块元素附着 */
  clearCellElement(cx, cy); /* 会自动刷新总是附着地形 */
  
  return true;
}

/* ============ 扩散反应特殊处理 ============
   扩散会对周围9格造成触发者 30% 基础攻击力的 triggerElem 元素伤害。
   因为容易连锁，所以：先处理中心地块本身 → 顺时针从正上方开始处理外圈 → 记录连锁 → 全部外圈处理完后依次处理连锁。 */
function _doDiffuseReaction(reaction){
  const cs = combatState;
  const {cx, cy, triggerElem, triggerer, triggererKey} = reaction;
  const dmg = Math.max(1, Math.round((triggerer.atk||10) * 0.30));
  log(`【扩散】${triggerer.name} 释放 ${ELEM[triggerElem].zh} 扩散！对周围9格造成 ${dmg} 点${ELEM_ZH[triggerElem]}属性伤害。`);
  
  /* 记录连锁的反应点：{cx,cy, elem, triggererKey} */
  const chainQueue = [];
  
  /* 中心地块先处理（已经在 tryReactOnAttach 里触发了当前反应的施加附着阶段，
     所以扩散的中心地块就是触发地。现在对它造成伤害 + 对敌人/主角。
     同时对周围8格（顺时针顺序）也造成伤害 + 施加 triggerElem 附着 */
  
  /* 顺时针顺序的周围8格 —— 从正上方开始（基准 facing=up 的顺时针）
     正上(-1,0) → 右上(-1,1) → 右(0,1) → 右下(1,1) → 下(1,0) → 左下(1,-1) → 左(0,-1) → 左上(-1,-1) 
     (注意 dy=+1 是向下) */
  const clockwiseOuter = [
    {dx:0, dy:-1},  /* 上 */
    {dx:1, dy:-1},  /* 右上 */
    {dx:1, dy:0},   /* 右 */
    {dx:1, dy:1},   /* 右下 */
    {dx:0, dy:1},   /* 下 */
    {dx:-1, dy:1},  /* 左下 */
    {dx:-1, dy:0},  /* 左 */
    {dx:-1, dy:-1}, /* 左上 */
  ];
  
  /* 中心地块 */
  _applyDiffuseDamageAt(cx, cy, triggerElem, dmg, triggererKey, chainQueue, reaction);
  
  /* 外圈顺时针 */
  for(const o of clockwiseOuter){
    const nx = cx+o.dx, ny = cy+o.dy;
    if(!_inBounds(nx,ny)) continue;
    _applyDiffuseDamageAt(nx, ny, triggerElem, dmg, triggererKey, chainQueue, reaction);
  }
  
  /* 所有外圈处理完后，处理连锁 */
  for(const chain of chainQueue){
    tryReactOnAttach(chain.cx, chain.cy, chain.elem, chain.triggererKey);
  }
  
  /* 扩散计数 +1（陆悠悠连携·风暴眼用） */
  cs.counter = cs.counter || {};
  cs.counter.diffuseCount = (cs.counter.diffuseCount||0) + 1;
}
function _applyDiffuseDamageAt(x, y, elem, dmg, triggererKey, chainQueue, parentReaction){
  const cs = combatState;
  const cell = _getCell(x,y);
  if(!cell) return;
  /* 1. 先对范围内单位造成 triggerElem 属性伤害 */
  const enemy = cs.enemies.find(e=>e.hp>0 && e.x===x && e.y===y);
  const heroHere = cs.hero && cs.hero.hp>0 && cs.hero.x===x && cs.hero.y===y;
  if(isEnemyTriggerer(triggererKey)){
    if(heroHere) damageHero(dmg, elem);
  } else {
    if(enemy) damageEnemy(enemy, dmg, elem, 'diffuse');
  }
  /* 2. 对该地块施加 triggerElem 附着 → 尝试反应 */
  if(!cellElementable(cell)) return;
  const prev = cell.element;
  if(prev){
    /* 已有附着 → 尝试反应 */
    const ok = tryReactOnAttach(x, y, elem, triggererKey);
    /* 若发生反应，clearCellElement 已被调用；
       若未发生反应，下面 setCellElement 会取代 */
    if(!ok){
      setCellElement(x, y, elem);
    }
  } else {
    /* 无附着 → 直接施加 */
    setCellElement(x, y, elem);
  }
}

/* ============ 结晶反应 ============ */
function _doCrystallizeReaction(reaction){
  const cs = combatState;
  const triggerer = reaction.triggerer;
  let shieldAmt = Math.round((triggerer.maxHp||100) * 0.08);
  shieldAmt = Math.max(10, shieldAmt);
  /* 队友没有生命值，改为主角享受 */
  if(!triggerer.hp || triggerer.hp===undefined){
    cs.hero.shield = (cs.hero.shield||0) + shieldAmt;
    log(`【结晶】${triggerer.name} 无生命值，主角获得 ${shieldAmt} 点护盾！`);
  } else {
    /* 主角或敌方 */
    if(isEnemyTriggerer(reaction.triggererKey)){
      triggerer.shield = (triggerer.shield||0) + shieldAmt;
    } else {
      cs.hero.shield = (cs.hero.shield||0) + shieldAmt;
    }
    log(`【结晶】${triggerer.name} 获得 ${shieldAmt} 点护盾！`);
  }
}

/* ============ 反应引擎辅助 ============ */
function _resolveTriggerer(key){
  const cs = combatState;
  if(key==='pro' || key==='ally_pro' || key==='hero'){
    /* 主角 */
    return { name:'主角', key:'pro', x:cs.hero.x, y:cs.hero.y, atk:charAtk('pro'), baseAtk:PROTAGONIST.base.atk, maxHp:heroineMaxHp(), statuses:cs.ally.pro.statuses, shield:cs.hero.shield };
  }
  if(key==='enemy' || (cs.enemies && cs.enemies.some(e=>e.x===key?.x && e.y===key?.y))){
    /* 给定具体 enemy 对象 */
    if(typeof key === 'object') return key;
    return cs.enemies.find(e=>e.key===key) || cs.enemies[0] || { name:'?', key:'enemy', atk:10, maxHp:100, statuses:{} };
  }
  if(ALLIES[key]){
    /* 队友 */
    return { name:ALLIES[key].name, key, atk:charAtk(key), baseAtk:ALLIES[key].base.atk, maxHp:100,
             statuses:cs.ally[key]? cs.ally[key].statuses:{} };
  }
  /* 默认：主角 */
  return { name:'主角', key:'pro', atk:charAtk('pro'), maxHp:heroineMaxHp(), statuses:cs.ally.pro.statuses };
}
function isEnemyTriggerer(key){
  if(!combatState) return false;
  if(key==='pro') return false;
  if(ALLIES[key]) return false;
  if(typeof key === 'string' && combatState.enemies.some(e=>e.key===key)) return true;
  if(typeof key === 'object' && combatState.enemies.includes(key)) return true;
  return false;
}

/* ============ 状态操作 API ============ */
/* 兼容旧 addStatus/removeStatus —— 新版支持 stacks 字段、可无限持续 */
function addStatus(statuses, id, turns, layers){
  const def = ST[id];
  if(!def){ console.warn('addStatus: unknown id', id); return; }
  if(statuses[id] && id==='poison'){
    /* 中毒叠加层数 */
    statuses[id].layers = (statuses[id].layers||0) + (layers||1);
    return statuses[id];
  }
  /* 蒸发/融化/激化这类无限持续且可叠加 stacks 的状态：不替换，而是叠加层数 */
  if(['evap_water','evap_fire','melt_ice','melt_fire','aggro'].includes(id) && statuses[id]){
    /* 叠层数逻辑在反应 apply 函数里已经处理了，这里直接返回 */
    return statuses[id];
  }
  statuses[id] = {
    id, name: def.name, kind: def.kind, desc: def.desc,
    turns: turns != null ? turns : (def.turns != null ? def.turns : 1),
    layers: layers || (id==='poison' ? 0 : null),
    stacks: def.stacks != null ? def.stacks : null,
  };
  return statuses[id];
}
function hasStatus(statuses, id){ return !!statuses[id]; }
function removeStatus(statuses, id){ delete statuses[id]; }
function tickStatuses(statuses){
  for(const k in statuses){
    const s = statuses[k];
    if(s.turns == null) continue; /* null = 无限持续 */
    if(s.turns > 0) s.turns--;
    if(s.turns <= 0) delete statuses[k];
  }
}
function statusArr(statuses){ return Object.values(statuses||{}); }
/* ============ 状态操作到此结束 ============ */

/* ============ 核心战斗初始化 ============ */
function startCombat(cell){
  const key=cell.content.key;
  initCombatState({ enemyKey:key });
  clearLog(); clearStory();
  log('进入战斗。你得击败所有敌人。');
  enterCombatMode();
}
function initCombatState(o){
  /* 先清掉旧战斗状态 */
  combatState = null;
  /* 先把地图所有格子补上默认 terrain（确保 river/grass/ice 生效） */
  _ensureCombatTerrain();
  
  /* 地块元素附着全部清零（探索进入战斗前如果有，直接清空） */
  for(let i=0; i<G.map.n*G.map.n; i++){ G.map.cells[i].element = null; }
  /* 刷新总是附着地形 */
  refreshAlwaysElementTerrain();
  
  const ally = {};
  for(const k of G.team){
    const c = getChar(k);
    ally[k]={
      statuses:{}, cds:{}, skillUsed:false,   /* 本回合技能使用标记 */
      nodeTriggered:false, acted:false,
    };
  }
  combatState = {
    hero:{ x:G.px, y:G.py, facing:G.hero.facing||'up', hp:G.hero.hp, maxHp:heroineMaxHp(), shield:0 },
    enemies:[], pets:[], ally,
    zone:[], counter:{}, field:{},
    skillGroup: buildSkillGroup(),
    phase:'start',
    day:G.day, turn:1,
    entryCell:G.px+','+G.py, day:G.day,
    defeated:[], focusEnemy:null,
    playerMoved:false, playerOver:false,
    currentChar:G.team[0]||'pro',
    selectedEnemy:null, infoCell:null, enemyPage:0,
    /* 保留少量旧字段兼容 explore.js 的战斗入口 */
    bubbles:[],  /* 水史莱姆水泡 */
    pendingTarget:null,
    startSnapshot:{ heroHp:G.hero.hp, vehicles:JSON.parse(JSON.stringify(G.vehicles||[])), vehicleSel:G.vehicleSel!=null?G.vehicleSel:0, enemyKey:o.enemyKey },
  };
  
  /* 生成敌人 */
  const e = _spawnEnemy(o.enemyKey);
  combatState.enemies.push(e);
  _afterSpawnEnemy(e);
  
  /* 我方召唤物槽 */
  combatState.pets = combatState.pets || [];
  
  _refreshHeroShield();
}
/* 兼容旧函数名 */
const initCombatState_v1 = null;
/* _ensureCombatTerrain：确保 map.cells[i].terrain 是 valid 的（旧版是 void/obstacle/ground，需要升级） */
function _ensureCombatTerrain(){
  /* 暂不强制替换：旧版 void/obstacle/ground 可被 TERRAIN_DEFS 处理，
     river/grass/ice 这些新 terrain 在探索地图生成时会出现，探索阶段已经正确设置。
     这里只是检查并修复有问题的： */
  if(!G||!G.map) return;
  G.map.n = G.map.n || G.map.size || 4;
  for(let i=0; i<G.map.n*G.map.n; i++){
    const c = G.map.cells[i];
    if(!TERRAIN_DEFS[c.terrain]){
      /* 旧版 void/obstacle/ground 兼容 */
      if(c.terrain==='void') c.terrain='void';
      else if(c.terrain==='obstacle') c.terrain='obstacle';
      else c.terrain='ground';
    }
  }
}

/* ============ 敌人生成 / 天赋处理 ============ */
function _spawnEnemy(key){
  const def = ENEMIES[key];
  const b = _teamSizeBonus();
  let atk = Math.round(def.atk * b.atkMult), maxHp = Math.floor(def.maxHp * b.hpMult), defv = def.def||0, speed = def.speed||0;
  /* 新手之友 */
  if(def.passives && def.passives.find(p=>p.id==='newbie') && G.day<13){ maxHp = Math.max(1, maxHp-60); }
  /* 岩盾 */
  if(def.passives && def.passives.find(p=>p.id==='rockshield')){ maxHp = Math.floor(maxHp*0.9); defv += 10; }
  /* 中二病 come back */
  if(def.passives && def.passives.find(p=>p.id==='comeback')){
    const cnt = Math.min(5, (G.records?.chunibyoCount)||0);
    if(cnt){ atk += 15*cnt; maxHp += 40*cnt; speed += 5*cnt; }
  }
  /* 成长 / 成长+ */
  const growthP = def.passives && (def.passives.find(p=>p.id==='growth') || def.passives.find(p=>p.id==='growth2'));
  if(growthP){
    const isPro = !!def.passives.find(p=>p.id==='growth2');
    const days = Math.max(0,(G.day||1)-1);
    const cap = isPro?20:Infinity;
    const n = Math.min(cap, days);
    if(n>0){
      atk = Math.round(atk * (1 + ((isPro?0.08:0.05)*n)));
      maxHp = Math.floor(maxHp * (1 + ((isPro?0.10:0.05)*n)));
      speed += n;
    }
  }
  /* 稀有熊 hp 保持 */
  const hpSet = (def.passives?.some(p=>p.id==='rare') && G.records?.rareBearHp)
    ? Math.min(maxHp, Math.round(G.records.rareBearHp))
    : null;
  const pos = _randomEmptyCombatCell();
  return {
    key, def, name:def.name, icon:def.icon, tier:def.tier,
    x:pos.x, y:pos.y, facing:'up',
    atk, baseAtkAtSpawn:atk, hp: hpSet!=null? hpSet : maxHp, maxHp, defv, speed,
    res: def.res || {}, healthPenalty: def.healthPenalty||0,
    statuses:{}, cooldowns:{}, sustain:-1, attacks:0, chargingSkill:null,
    nodeTriggered:false, acted:false, shield:0,
  };
}
/* 旧版兼容 */
function spawnEnemy(key){ return _spawnEnemy(key); }
function _randomEmptyCombatCell(){
  if(!G.map) return {x:0,y:0};
  const cs = combatState;
  const n = G.map.n;
  const cand = [];
  for(let y=0; y<n; y++) for(let x=0; x<n; x++){
    /* 避开主角 */
    if(cs && cs.hero && cs.hero.x===x && cs.hero.y===y) continue;
    /* 避开已生成敌人 */
    if(cs && cs.enemies.some(en=>en.x===x && en.y===y)) continue;
    /* 避开不可进地块 */
    if(!passable(x,y)) continue;
    cand.push({x,y});
  }
  return cand.length ? cand[Math.floor(Math.random()*cand.length)] : {x:G.px,y:G.py};
}
function _afterSpawnEnemy(e){
  const cs = combatState;
  if(!cs) return;
  /* 史莱姆集群 */
  if(e.def?.passives?.some(p=>p.id==='swarm')){
    cs.enemies = [];
    const pool=['slime','fireSlime','waterSlime','thunderSlime','iceSlime','windSlime','rockSlime'];
    for(let i=0; i<3; i++){
      const k = pool[Math.floor(Math.random()*pool.length)];
      const sub = _spawnEnemy(k);
      sub.fromSwarm = true;
      cs.enemies.push(sub);
    }
    cs.defeated.push(e);
    log('史莱姆集群四散，冲出3只史莱姆！');
    return;
  }
  /* 熊冬眠 */
  if(e.def?.passives?.some(p=>p.id==='hiber')) addStatus(e.statuses,'sleep',3);
  /* 小小蛇恐吓 */
  if(e.def?.passives?.some(p=>p.id==='scare')){
    addStatus(cs.ally.pro.statuses,'bind',1);
    const p = _placeEnemyNearHero(e);
    if(p){ e.x=p.x; e.y=p.y; }
    log(`${e.name} 的恐吓让你被【束缚】，它瞬移到你身边！`);
  }
  /* 狗友 */
  if(e.def?.passives?.some(p=>p.id==='dogpal' || p.id==='dogpal2')){
    _spawnHoundPack(e);
  }
}
function _placeEnemyNearHero(enemy){
  const cs = combatState;
  if(!cs) return null;
  const cand=[[1,0],[-1,0],[0,1],[0,-1]].map(([a,b])=>({x:cs.hero.x+a,y:cs.hero.y+b}))
    .filter(p=>passable(p.x,p.y) && !(p.x===enemy.x&&p.y===enemy.y) && !cs.enemies.some(o=>o!==enemy&&o.x===p.x&&o.y===p.y));
  return cand.length ? cand[Math.floor(Math.random()*cand.length)] : null;
}
function _spawnHoundPack(e){
  const cs = combatState;
  if(!cs) return;
  let n=0;
  const isPro = e.def?.passives?.some(p=>p.id==='dogpal2');
  if(isPro){ n = Math.random()<0.80?1:0; }
  else { n = Math.random()<0.80? 1 : (Math.random()<0.95? 2 : 3); }
  for(let i=0; i<n && cs.enemies.length<8; i++){
    const subKey = isPro ? (Math.random()<0.80?'hound':'houndPro') : 'hound';
    const sub = _spawnEnemy(subKey);
    sub.fromPack = true;
    cs.enemies.push(sub);
    log(`${e.name} 的狗友招来了一只${sub.name}！`);
  }
}

/* ============ 技能组构建 ============ */
/* 编队所有角色的 auto/link 技能进入技能组，按角色排序、自动→连携→...
   槽位上限 10，初始 4 槽，每多 1 角色 +1 槽（主角自己算）。 */
function buildSkillGroup(){
  const cs = combatState;
  const chars = getTeamChars();
  const capacity = Math.min(10, 4 + chars.length);
  const group = [];
  for(const c of chars){
    /* 自动技能先加 */
    for(const sk of c.skills.filter(s=>s.kind==='auto')){
      if(group.length>=capacity) break;
      group.push({ skill:sk, roleKey:c.key, roleName:c.name, idx:group.length });
    }
    /* 连携技能再加 */
    for(const sk of c.skills.filter(s=>s.kind==='link')){
      if(group.length>=capacity) break;
      group.push({ skill:sk, roleKey:c.key, roleName:c.name, idx:group.length });
    }
  }
  return group;
}

/* ============ 团队加成 / 攻击等辅助 ============ */
function _teamSizeBonus(){
  const t = (G && G.team && G.team.length) || 3;
  return {
    atkMult: t>=3? 1.30 : (t===2? 1.15 : 1.00),
    hpMult:  t>=3? 1.40 : (t===2? 1.20 : 1.00),
  };
}
/* 主角最大生命（含天赋+队友） */
function heroineMaxHp(){
  /* 保留旧 heroDisplayMaxHp 函数名 */
  if(typeof window.heroDisplayMaxHp === 'function') return window.heroDisplayMaxHp();
  const c = PROTAGONIST;
  let hp = c.base.maxHp + (G.proLevels?.block ? G.proLevels.block*50 : 0);
  if(G.team?.includes('luyouyou')) hp += 100; /* 陆悠悠烹饪 */
  return hp;
}
/* 主角基础攻击 / 局内攻击 */
function charAtk(key){
  if(key==='pro'){
    let atk = PROTAGONIST.base.atk + (G.proLevels?.crit||1)*10 + (G.proLevels?.blood||1)*20 + (G.proLevels?.momentum||1)*30;
    if(G.team?.includes('xiayang')){ atk += 30 + ((G.bonds?.xiayang?.level||1)-1)*10; }
    /* 抑郁 */
    if(G.hero.depress) atk = 0;
    /* 明心浆 */
    if(G.hero.clearMindBuff?.day===G.day && G.hero.clearMindBuff.atkUp){ atk = Math.round(atk * (1 + G.hero.clearMindBuff.atkUp/100)); }
    return atk;
  }
  if(key==='xiayang'){
    const lv = (G.bonds?.xiayang?.level) || 1;
    let atk = 30 + lv*10;
    /* 主角的无所畏惧 buff —— 夏阳自己 */
    const xpass = XIAYANG.passives.find(p=>p.id==='fearless');
    if(xpass){ const scal = tierValue(xpass, lv); atk += (scal.selfAtk||0); }
    if(G.hero.depress) atk = 0;
    return atk;
  }
  if(key==='luyouyou'){
    const lv = (G.bonds?.luyouyou?.level) || 1;
    let atk = 35 + lv*10;
    const wp = LUYOOUYOU.passives.find(p=>p.id==='windSpirit');
    if(wp){ const scal = tierValue(wp, lv); atk += (scal.atk||0); }
    if(G.hero.depress) atk = 0;
    return atk;
  }
  return 10;
}
/* 主角总防御（局内） */
function totalHeroDefense(){
  let d = PROTAGONIST.base.def + (G.proLevels?.hold||1)*20;
  return d;
}
/* 主角暴击率 */
function charCritRate(key){
  if(key==='pro'){
    let c = (G.proLevels?.crit||1)*3;
    if(combatState?.ally?.pro?.statuses?.crit) c += 100;
    return c;
  }
  if(key==='luyouyou'){
    const lv = (G.bonds?.luyouyou?.level)||1;
    const wp = LUYOOUYOU.passives.find(p=>p.id==='windSpirit');
    if(!wp) return 0;
    const scal = tierValue(wp, lv);
    return scal.crit || 0;
  }
  return 0;
}
/* 闪避率 */
function heroDodgeRate(){
  if(!G.team?.includes('luyouyou')) return 0;
  const lv = (G.bonds?.luyouyou?.level)||1;
  const fl = LUYOOUYOU.passives.find(p=>p.id==='dance');
  if(!fl) return 0;
  const scal = tierValue(fl, lv);
  return scal.dodge || 0;
}

/* ============ 刷新主角护盾 ============
   新版规则：护盾在"主角的行动节点开始时"清除旧护盾 → 然后按防御值刷新新护盾。
   这里 _refreshHeroShield 只做防御值刷新；清除旧护盾由 _triggerUnitNode 处理。 */
function _refreshHeroShield(){
  if(!combatState) return;
  const def = totalHeroDefense();
  if(def>0) combatState.hero.shield = def;
}
/* 兼容旧函数名 */
const refreshHeroShield = _refreshHeroShield;

/* ============================================================
   第二部分：伤害 / 抗性 / 附着统一框架
   
   两个核心概念：
   - x元素伤害: 先对目标范围内所有地块施加该元素附着 → 每发生一次反应就处理 → 全部附着施加完
               → 对范围内所有可攻击单位造成该元素属性伤害（不再施加附着）
   - x属性伤害: 只造成伤害，不施加附着，也不会引起元素反应
   
   伤害公式（按顺序应用）：
   1. 基础伤害 = max(1, 攻击力 * 倍率)
   2. 蒸发/融化/激化/易伤等最终伤害加减 buff → 最终伤害调整
   3. 抗性 = max(-100, min(90, 基础抗性 + 额外抗性)) → 伤害 * (1 - 抗性/100)
      （超导结界 -40% 、冻结 +50% 、草元素地块等额外抗性在这里叠加）
   4. 主角专属：暴击(伤害×2)、格挡(归零)、坚守(回血)
   5. 主角护盾 / 敌方护盾（真实伤害/反伤可穿透，流失/控制不可）
   6. 最小 1 伤害
   7. 真实伤害跳过 2/3/4（直接到 5）
   8. 护盾吸收后剩余值 → 扣血
   
   反应优先级高于一切：只要有反应就暂停，反应处理完再继续伤害流程。
   胜负判定优先级高于反应：任何时候检测到胜负立即结束。
   
   ⚠️ 以上口径硬编码实现，不许改。
   ============================================================ */

/* ============ 辅助：冻结抗性加成 / 超导减抗性 ============
   返回一个"额外抗性偏移"（可以是负数） */
function _extraResistanceForTarget(target, elem){
  let offset = 0;
  /* 超导结界内：雷/冰/物理 -40% */
  const cs = combatState;
  if(cs && cs.zones){
    for(const z of cs.zones){
      if(z.type==='superconduct'){
        const cell = _getCell(z.x, z.y);
        /* 目标在该结界的 adj9 范围 */
        if(dist({x:z.x,y:z.y}, target) <= 1){
          if(elem==='thunder' || elem==='ice' || elem==='physical'){
            offset -= 40;
          }
        }
      }
      /* 感电结界：在水元素地块时持续时间不减少（这里不处理抗性） */
      /* 燃烧结界：元素地块上的燃烧翻倍（tick 时处理） */
    }
  }
  return offset;
}

/* ============ 主角被伤害 damageHero ============ */
function damageHero(dmgRaw, elem){
  const cs = combatState;
  if(!cs) return;
  const real = (elem==='real' || elem==='true');
  
  /* 胜负判定最高优先级 */
  if(cs.hero.hp <= 0) return;
  
  /* 1. 反应 buff：蒸发/融化影响下一次元素伤害 */
  if(!real){
    if(elem==='water' && cs.ally.pro.statuses.evap_water){
      /* 消耗1层蒸发·水：下一次水伤+50%（若多层，则只消耗1层） */
      const s = cs.ally.pro.statuses.evap_water;
      const bonus = Math.floor(dmgRaw * 0.5);
      dmgRaw += bonus;
      s.stacks -= 1;
      if(s.stacks<=0) delete cs.ally.pro.statuses.evap_water;
      log(`主角的【蒸发·水】消耗，水伤+50%。`);
    }
    if(elem==='fire' && cs.ally.pro.statuses.evap_fire){
      const s = cs.ally.pro.statuses.evap_fire;
      const bonus = Math.floor(dmgRaw * 0.25);
      dmgRaw += bonus;
      s.stacks -= 1;
      if(s.stacks<=0) delete cs.ally.pro.statuses.evap_fire;
      log(`主角的【蒸发·火】消耗，火伤+25%。`);
    }
    if(elem==='ice' && cs.ally.pro.statuses.melt_ice){
      const s = cs.ally.pro.statuses.melt_ice;
      const bonus = Math.floor(dmgRaw * 0.25);
      dmgRaw += bonus;
      s.stacks -= 1;
      if(s.stacks<=0) delete cs.ally.pro.statuses.melt_ice;
      log(`主角的【融化·冰】消耗，冰伤+25%。`);
    }
    if(elem==='fire' && cs.ally.pro.statuses.melt_fire){
      const s = cs.ally.pro.statuses.melt_fire;
      const bonus = Math.floor(dmgRaw * 0.5);
      dmgRaw += bonus;
      s.stacks -= 1;
      if(s.stacks<=0) delete cs.ally.pro.statuses.melt_fire;
      log(`主角的【融化·火】消耗，火伤+50%。`);
    }
    /* 激化 buff */
    if((elem==='grass' || elem==='thunder') && cs.ally.pro.statuses.aggro){
      const s = cs.ally.pro.statuses.aggro;
      dmgRaw = Math.round(dmgRaw * 1.1);
      s.stacks -= 1;
      if(s.stacks<=0) delete cs.ally.pro.statuses.aggro;
    }
  }
  
  /* 2. 主角专属：冻结 → 火/雷伤 +50% 且提前结束 */
  if(cs.ally.pro.statuses.frozen && (elem==='fire' || elem==='thunder')){
    if(!real){ dmgRaw = Math.round(dmgRaw * 1.5); }
    /* 提前结束冻结 */
    const remain = cs.ally.pro.statuses.frozen.turns || 2;
    removeStatus(cs.ally.pro.statuses, 'frozen');
    addStatus(cs.ally.pro.statuses, 'freezed_imm', 3);
    log(`冻结中的主角受到${ELEM_ZH[elem]||elem}伤，冻结提前结束！获得【免疫冻结】3回合。`);
  }
  
  /* 3. 真实伤害：跳过抗性/暴击/格挡 */
  if(!real){
    /* 明心浆减伤 */
    if(G.hero.clearMindBuff?.day===G.day && G.hero.clearMindBuff.dr){
      dmgRaw = Math.round(dmgRaw * (1 - G.hero.clearMindBuff.dr/100));
    }
    /* 减伤 buff dr -40% */
    if(cs.ally.pro.statuses.dr) dmgRaw = Math.round(dmgRaw * 0.6);
    /* 易伤 +35% */
    if(cs.ally.pro.statuses.vuln) dmgRaw = Math.round(dmgRaw * 1.35);
    /* 抗性限制 -100~+90 */
    let baseRes = (G.hero.res?.[elem] != null) ? G.hero.res[elem] : 0;
    let extra = _extraResistanceForTarget({x:cs.hero.x,y:cs.hero.y}, elem);
    let totalRes = Math.max(-100, Math.min(90, baseRes + extra));
    if(totalRes !== 0){
      dmgRaw = Math.round(dmgRaw * (1 - totalRes/100));
    }
    /* 陆悠悠闪避 */
    const lv = (G.bonds?.luyouyou?.level)||1;
    const fl = LUYOOUYOU.passives.find(p=>p.id==='dance');
    let dodgeRate = 0;
    if(fl && G.team.includes('luyouyou')){
      const scal = tierValue(fl, lv);
      dodgeRate = scal.dodge || 0;
    }
    if(dodgeRate > 0 && Math.random()*100 < dodgeRate){
      /* 闪避 */
      const healed = Math.min(heroineMaxHp(), G.hero.hp + (LUYOOUYOU.passives.find(p=>p.id==='dance') && tierValue(LUYOOUYOU.passives.find(p=>p.id==='dance'), lv).combat || 30));
      const got = healed - G.hero.hp;
      G.hero.hp = healed; cs.hero.hp = healed;
      log(`主角闪避了伤害！并回复 ${got} 点生命。`);
      checkCombatEnd();
      return;
    }
    /* 格挡 */
    const block = PROTAGONIST.passives.find(p=>p.id==='block');
    const blockLv = G.proLevels?.block || 1;
    const blockScal = tierValue(block, blockLv);
    if(blockScal.prob && Math.random()*100 < blockScal.prob){
      log('【格挡】触发，本次伤害降为0。');
      return;
    }
  }
  
  /* 4. 护盾（真实伤害也能穿透吗？旧代码能穿透真实伤害？新规格说真实伤害可以被护盾抵挡 —— "可以抵挡真实伤害"） */
  /* 新版规则：护盾抵挡一切伤害，包括真实伤害、反伤。 */
  let dmg = Math.max(0, Math.round(dmgRaw));
  if(dmg>0 && cs.hero.shield>0){
    const absorb = Math.min(cs.hero.shield, dmg);
    cs.hero.shield -= absorb;
    dmg -= absorb;
  }
  if(dmg>0){
    cs.hero.hp -= dmg;
    G.hero.hp = cs.hero.hp;
    log(`主角受到 ${dmg} 点${elemText(elem)}。`);
  }
  /* 坚守（真实伤害不触发） */
  if(!real && dmg>0){
    const hold = PROTAGONIST.passives.find(p=>p.id==='hold');
    const holdLv = G.proLevels?.hold || 1;
    const holdScal = tierValue(hold, holdLv);
    if(holdScal.prob && Math.random()*100 < holdScal.prob){
      const cap = heroineMaxHp();
      const got = Math.min(cap-G.hero.hp, Math.round(cap*0.12));
      if(got>0){ cs.hero.hp+=got; G.hero.hp=cs.hero.hp; log(`【坚守】回复 ${got} 点生命。`); }
    }
  }
  /* 涅槃（致命伤触发） */
  if(cs.hero.hp<=0){
    const x = G.bonds?.xiayang?.level || 1;
    if(G.team.includes('xiayang') && (G.rebirthUsedDay||0) !== (G.day||1)){
      const rebirth = XIAYANG.passives.find(p=>p.id==='rebirth');
      if(rebirth){
        G.rebirthUsedDay = G.day||1;
        cs.hero.hp = Math.max(1, Math.round(heroineMaxHp()*0.5));
        G.hero.hp = cs.hero.hp;
        for(const k of G.team){
          if(cs.ally[k]) addStatus(cs.ally[k].statuses,'atkUp',null);
        }
        log('【涅槃】触发：主角没有倒下！回复50%生命，全体我方攻击力+25%。');
      }
    } else {
      cs.hero.hp = 0;
      G.hero.hp = 0;
    }
  }
  checkCombatEnd();
}

/* ============ 敌人被伤害 damageEnemy ============ */
function damageEnemy(enemy, dmgRaw, elem, source){
  const cs = combatState;
  if(!cs || !enemy || enemy.hp<=0) return;
  const real = (elem==='real' || elem==='true');
  
  /* 胜负判定最高优先级 */
  if(cs.enemies.length===0) return;
  
  /* 反应 buff：主角/队友的蒸发/融化/激化（敌方自己没有这些状态，主角是触发者） */
  /* 蒸发/融化应用在主角阵营对敌方造成的伤害上 */
  if(!real){
    const pro = cs.ally.pro;
    if(elem==='water' && pro.statuses.evap_water){
      const s = pro.statuses.evap_water;
      dmgRaw += Math.floor(dmgRaw * 0.5); s.stacks -= 1;
      if(s.stacks<=0) delete pro.statuses.evap_water;
    }
    if(elem==='fire' && pro.statuses.evap_fire){
      const s = pro.statuses.evap_fire;
      dmgRaw += Math.floor(dmgRaw * 0.25); s.stacks -= 1;
      if(s.stacks<=0) delete pro.statuses.evap_fire;
    }
    if(elem==='ice' && pro.statuses.melt_ice){
      const s = pro.statuses.melt_ice;
      dmgRaw += Math.floor(dmgRaw * 0.25); s.stacks -= 1;
      if(s.stacks<=0) delete pro.statuses.melt_ice;
    }
    if(elem==='fire' && pro.statuses.melt_fire){
      const s = pro.statuses.melt_fire;
      dmgRaw += Math.floor(dmgRaw * 0.5); s.stacks -= 1;
      if(s.stacks<=0) delete pro.statuses.melt_fire;
    }
    /* 激化 buff 消耗（谁造成的伤害，消耗谁的激化层 —— 简化为消耗主角/当前角色的） */
    /* 此处暂略（角色技能未分角色归属） */
  }
  
  /* 冻结：冻结中的敌人被火/雷伤 → +50% 且提前结束 */
  if(enemy.statuses.frozen && (elem==='fire' || elem==='thunder')){
    if(!real){ dmgRaw = Math.round(dmgRaw * 1.5); }
    removeStatus(enemy.statuses, 'frozen');
    addStatus(enemy.statuses, 'freezed_imm', 3);
  }
  
  /* 元素亲和免疫（老代码兼容：史莱姆免疫对应元素伤害 + 总是附着） */
  if(!real){
    const passiveAffin = enemy.def?.passives?.find(p=>p.id==='affin_'+elem);
    if(passiveAffin || enemy.key==='fireSlime' && elem==='fire' || enemy.key==='waterSlime' && elem==='water' || enemy.key==='iceSlime' && elem==='ice' || enemy.key==='thunderSlime' && elem==='thunder' || enemy.key==='windSlime' && elem==='wind' || enemy.key==='rockSlime' && elem==='rock' || enemy.key==='slime' && elem==='grass'){
      log(`${enemy.name} 元素亲和，免疫${ELEM_ZH[elem]||elem}伤害！`);
      return;
    }
  }
  
  /* 抗性 */
  if(!real){
    if(enemy.statuses.vuln) dmgRaw = Math.round(dmgRaw * 1.35);
    let baseRes = (enemy.res && enemy.res[elem]) || 0;
    let extra = _extraResistanceForTarget(enemy, elem);
    let totalRes = Math.max(-100, Math.min(90, baseRes + extra));
    if(totalRes !== 0) dmgRaw = Math.round(dmgRaw * (1 - totalRes/100));
  }
  
  /* 护盾 */
  let dmg = Math.max(0, Math.round(dmgRaw));
  if(dmg>0 && enemy.shield>0){
    const absorb = Math.min(enemy.shield, dmg);
    enemy.shield -= absorb; dmg -= absorb;
  }
  if(dmg>0){
    enemy.hp -= dmg;
    log(`${enemy.name} 受到 ${dmg} 点${elemText(elem)}。`);
  }
  
  /* 古树反击 */
  if(enemy.def?.passives?.some(p=>p.id==='counter') && !real && dmg>0){
    damageHero(Math.max(1, Math.round(enemy.atk*0.4)), 'real');
  }
  /* 嗜血（主角） */
  if(G.team?.includes('pro') && PROTAGONIST.passives.find(p=>p.id==='blood')){
    const bLv = G.proLevels?.blood || 1;
    const bScal = tierValue(PROTAGONIST.passives.find(p=>p.id==='blood'), bLv);
    if(bScal.prob && bScal.prob>0 && Math.random()*100<bScal.prob){
      const cap = heroineMaxHp();
      const got = Math.min(cap-G.hero.hp, Math.round(dmg*0.5));
      if(got>0){ cs.hero.hp+=got; G.hero.hp=cs.hero.hp; log(`【嗜血】回复 ${got} 点生命。`); }
    }
  }
  /* 起势（主角） */
  if(PROTAGONIST.passives.find(p=>p.id==='momentum')){
    /* mom 加在局内攻击上 —— 简化：先忽略 */
  }
  /* 比翼 */
  if(enemy.hp>0){
    /* 暴击 buff 消耗 */
    if(cs.ally.pro.statuses.crit){
      removeStatus(cs.ally.pro.statuses, 'crit');
    }
  }
  if(enemy.hp<=0){
    enemy.hp=0;
    removeEnemy(enemy);
    /* 元素反应触发（风旋） */
    checkCombatEnd();
  }
}
function elemText(type){
  if(type==='physical') return '物理伤害';
  if(type==='real'||type==='true') return '真实伤害';
  if(ELEM[type]) return `<span class="${ELEM[type].c}">${ELEM[type].zh}元素伤害</span>`;
  return '伤害';
}

/* ============================================================
   第三部分：行动节点 + 技能施放 + 回合状态机 + 连携窗口
   
   行动节点（triggerNodeFor）：每个单位每回合触发1次。
   节点触发时做：
   1. 清除旧护盾（新版规则：护盾在"每个行动节点开始时清除旧护盾"）
   2. tick 所有持续效果（buff/debuff turns -1）
   3. 总是附着地形刷新（总是附着地形会在每次行动节点刷新）
   4. 结界持续时间 -1（挂在结界自己的 turnCounter 上）
   5. 强制滑动（冰面常规移动进入时）
   6. 风地块双动标记刷新
   
   回合状态机：
   start → player(玩家操控阶段) → residual(1s残存时间) → auto(自动技能)
         → summons(我方召唤物AI) → neutral(中立，暂空) → enemy(敌方回合)
         → end(结算) → 下一回合 start
   
   胜负判定 checkCombatEnd() —— 任何时候都可调用
   ============================================================ */

/* ============ 行动节点触发 ============ */
function triggerNodeFor(target){
  const cs = combatState;
  if(!cs || !target) return;
  if(target.nodeTriggered) return; /* 已经触发过了（同回合只触发1次） */
  target.nodeTriggered = true;
  
  /* 1. 清除旧护盾 */
  if(target.shield != null){
    target.shield = 0;
  }
  /* 2. 刷新总是附着地形 */
  refreshAlwaysElementTerrain();
  /* 3. tick 持续效果 */
  if(target.statuses) tickStatuses(target.statuses);
  /* 4. 按行动节点结算的状态（燃烧/中毒等） */
  if(target.statuses?.burn){
    const maxHp = target.key==='pro' ? heroineMaxHp() : (target.maxHp||100);
    let lost = Math.max(1, Math.round(maxHp * 0.03));
    /* 火元素地块翻倍 */
    const cell = target.key==='pro' ? _getCell(cs.hero.x, cs.hero.y) : _getCell(target.x, target.y);
    if(cell && cell.element==='fire') lost *= 2;
    if(target.key==='pro'){
      cs.hero.hp = Math.max(0, cs.hero.hp - lost);
      G.hero.hp = cs.hero.hp;
      log(`【燃烧】主角流失 ${lost} 点生命。`);
    } else {
      target.hp = Math.max(0, target.hp - lost);
      log(`【燃烧】${target.name} 流失 ${lost} 点生命。`);
      if(target.hp<=0 && cs.enemies.includes(target)){ removeEnemy(target); }
    }
  }
  if(target.statuses?.poison){
    const layers = target.statuses.poison.layers || 0;
    if(layers>0){
      if(target.key==='pro'){
        cs.hero.hp = Math.max(0, cs.hero.hp - layers);
        G.hero.hp = cs.hero.hp;
        log(`【中毒】主角流失 ${layers} 点生命。`);
      } else {
        target.hp = Math.max(0, target.hp - layers);
        log(`【中毒】${target.name} 流失 ${layers} 点生命。`);
      }
    }
  }
  /* 5. 主角护盾刷新（按防御值） */
  if(target.key==='pro'){
    _refreshHeroShield();
  }
  checkCombatEnd();
}

/* ============ 主角行动节点 ============ */
function _triggerHeroNode(){
  const cs = combatState;
  if(!cs) return;
  triggerNodeFor({...cs.hero, key:'pro', nodeTriggered: cs.ally.pro.nodeTriggered, statuses: cs.ally.pro.statuses});
  cs.ally.pro.nodeTriggered = true;
}

/* ============ 技能施放统一入口 ============
   skill: 技能定义对象
   caster: 施法者标识 'pro' | 'xiayang' | 'luyouyou' | enemy 对象
   options: { skipNodeTriggered, isAuto }
   
   实现口径（硬编码）：
   - type 有元素 + applyElem===true → 先对范围地块施加元素附着 → 每触发反应就处理 →
     全部附着施加完 → 对范围内可攻击单位造成 type 属性伤害（不再施加附着）
   - type==='physical' || 无 applyElem 标记 → 直接对范围内可攻击单位造成 physical 属性伤害
   - type==='real' → 直接造成真实伤害（跳过抗性/暴击/格挡）
   
   索敌目标规则（硬编码）：
   1. skill.elemRange 或 带 applyElem 的元素技能：默认行为 = 范围内所有地块都施加附着 +
      范围内所有可攻击单位造成伤害（不选具体阵营，默认"对该地块上的实体"造成伤害 = 对敌我方都可攻击）。
   2. skill.targetFaction 显式指定了阵营 → 严格按描述筛选，不给其他地块附着也不给其他单位伤害。
   3. skill.friendOrFoe=true（不分敌我） → 所有可攻击单位都打。
   4. 旧技能简化处理：默认只对敌方造成伤害（兼容旧代码行为）。
   
   现在先做最基础版本：按 skill.target 范围 → 找范围内有敌方的地块 → 造成伤害。
   后续技能文本里的"元素伤害"会自动触发地块附着。
*/
function castSkill(roleKey, isRetry){
  /* 对外 API：ui.js/main.js 里会调用 castSkill(key) 来施放主动技能 */
  const cs = combatState;
  if(!cs) return;
  
  /* 冻结：无法行动（行动节点照常触发，上面已 trigger） */
  if(cs.ally.pro.statuses.frozen){
    log('主角被冻结，无法行动！');
    return;
  }
  
  /* 找当前角色的"选中技能"：新版用 currentSkillIdx / skillGroup 索引 */
  /* 简化：暂时让 currentChar 角色的 defaultSkillIds 里用 cds 没冷却的第一个 */
  const char = getChar(cs.currentChar);
  if(!char) return;
  
  /* 主动技能：角色的 active 类型 */
  const available = char.skills.filter(s=>s.kind==='active');
  if(!available.length){
    /* 暂时没有主动技能（主角可能） —— 让自动系统接管 */
    return;
  }
  /* 暂取第一个可用 */
  const skill = available[0];
  _executeSkill(roleKey, skill);
  
  /* 标记该角色本轮已使用技能 */
  cs.ally[roleKey].skillUsed = true;
  cs.ally[roleKey].nodeTriggered = true; /* 行动节点已触发（技能前已触发） */
  
  /* 冷却 */
  const cd = skill.cd != null ? skill.cd : 1;
  cs.ally[roleKey].cds[skill.id] = cd;
  
  /* 触发战斗结束检测 */
  checkCombatEnd();
  
  /* 更新 UI */
  updateCombatUI();
}

/* 内部真正执行技能 */
function _executeSkill(casterKey, skill){
  const cs = combatState;
  if(!cs) return;
  const caster = casterKey==='pro'
    ? { x: cs.hero.x, y: cs.hero.y, facing: cs.hero.facing, key:'pro', atk: charAtk('pro') }
    : (ALLIES[casterKey] ? { x: cs.hero.x, y: cs.hero.y, facing: cs.hero.facing, key:casterKey, atk: charAtk(casterKey) } : null);
  if(!caster) return;
  
  const range = rangeOf(skill, caster.x, caster.y, caster.facing);
  const dmgMult = skill.mult || 1.0;
  const elem = skill.type;  /* physical/fire/water/... */
  const applyElem = skill.applyElem; /* 主动显式标记 "先施加元素附着" */
  
  let totalDmg = 0;
  /* 1. 如果是元素伤害（带 applyElem=true 或 type 不是 physical 且不是 real）：先对范围内所有地块施加该元素附着 */
  const isElemDamage = (applyElem || (elem && ELEM[elem] && elem!=='physical')) && elem!=='physical' && elem!=='real';
  if(isElemDamage){
    for(const p of range){
      /* 尝试反应 → 不反应 → 施加 */
      const cell = _getCell(p.x,p.y);
      if(!cell || !cellElementable(cell)) continue;
      if(cell.element && cell.element!==elem){
        const ok = tryReactOnAttach(p.x, p.y, elem, casterKey);
        if(!ok){
          /* 不可反应 → 附着取代 */
          setCellElement(p.x, p.y, elem);
        }
        /* 反应已处理，元素会被 clear 或保持，不用再 set */
      } else {
        /* 无附着或同种 → 同种不变（不反应不叠加），无附着就施加 */
        if(!cell.element){
          setCellElement(p.x, p.y, elem);
        }
      }
    }
  }
  
  /* 2. 对范围内可攻击的敌方单位造成伤害 */
  for(const p of range){
    const enemy = cs.enemies.find(e=>e.hp>0 && e.x===p.x && e.y===p.y);
    if(enemy){
      const dmgRaw = Math.max(1, Math.round(caster.atk * dmgMult));
      damageEnemy(enemy, dmgRaw, elem, 'skill:'+skill.id);
      totalDmg += dmgRaw;
    }
  }
  
  /* 主角天赋：战术布置 —— 只攻击1名敌人时设置重点目标 */
  if(casterKey==='pro' && totalDmg>0 && cs.enemies.filter(e=>e.hp>0 && e.x>=0).length<=1){
    const hit = cs.enemies.find(e=>e.hp>0 && e.x>=0);
    if(hit && !cs.field.alert){
      addStatus(cs.field, 'alert');
      cs.field.alert = { name: hit.name, id: hit.key };
    }
  }
  
  log(`${caster.name||getChar(casterKey).name} 使用【${skill.name}】。`);
}

/* ============ 逃跑公式 tryFlee ============ */
/* 新版规格：逃跑概率 = (主角速度 - 敌人速度*敌人剩余生命%) / 100
   若多个敌人 → 取 (当前该敌人速度*该敌人剩余生命%) 的最高值
   下限 0，上限 100%，四舍五入保留一位小数。 */
function _calcEscapeRate(){
  const cs = combatState;
  if(!cs || !cs.enemies.length) return 0;
  const proSpeed = G.hero.escapeSpeed || 100;
  let enemyHighest = 0;
  for(const e of cs.enemies){
    if(e.hp<=0) continue;
    const remainPct = e.maxHp>0 ? (e.hp/e.maxHp) : 1;
    const v = (e.speed||0) * remainPct;
    if(v > enemyHighest) enemyHighest = v;
  }
  let rate = (proSpeed - enemyHighest) / 100;
  if(rate < 0) rate = 0;
  if(rate > 1) rate = 1;
  return Math.round(rate * 1000) / 10; /* 一位小数 */
}
/* 兼容旧名 */
const calcEscapeRate = _calcEscapeRate;
function tryFlee(){
  const cs = combatState;
  if(!cs) return;
  /* 新版：逃跑是主角的行动，先触发行动节点 */
  _triggerHeroNode();
  const rate = _calcEscapeRate();
  log(`逃跑成功率约 ${rate}%。`);
  if(Math.random()*100 < rate){
    G.hero.escapeSpeed = (G.hero.escapeSpeed||100) + 1;
    endCombat(false, '你成功逃跑了！逃跑速度永久+1。');
  } else {
    log('逃跑失败！你失去了本回合的主角行动。');
    cs.ally.pro.skillUsed = true;
    cs.playerMoved = true;
    cs.playerOver = true;
    /* 队友仍照常释放自动技能 */
    _runAutoSkills();
    /* 进入敌方回合 */
    _endPlayerPhase();
  }
}

/* ============ 胜负判定 checkCombatEnd ============ */
/* 优先级：主角死亡 > 我方全员死亡 > 敌人全灭 */
function checkCombatEnd(){
  const cs = combatState;
  if(!cs) return;
  /* 主角死亡 */
  if(cs.hero.hp<=0){
    endCombatByDefeat();
    return;
  }
  /* 敌人全灭 */
  if(cs.enemies.every(e=>e.hp<=0)){
    endCombat(true, '战斗获得胜利！');
  }
}
function removeEnemy(enemy){
  const cs = combatState;
  if(!cs) return;
  /* 元素亲和总是附着 —— 清理 */
  /* 风旋（被击败时） */
  if(enemy.def?.passives?.some(p=>p.id==='windswirl')){
    const alive = cs.enemies.filter(e=>e!==enemy && e.hp>0);
    if(alive.length>0){
      if(dist(enemy, cs.hero)<=2){
        cs.hero.x = enemy.x; cs.hero.y = enemy.y;
        damageHero(Math.max(1, Math.round(enemy.atk*0.4)), 'wind');
      }
    }
  }
  cs.defeated.push(enemy);
  cs.enemies = cs.enemies.filter(e=>e!==enemy);
}

/* ============ 敌方 AI endPlayerPhase ============ */
/* 简化版：每个敌人依次行动 —— 触发节点 → 找主角位置 → 移动/攻击 */
function _enemyTurn(){
  const cs = combatState;
  if(!cs || !cs.enemies.length) return;
  cs.phase = 'enemy';
  for(const e of cs.enemies.slice()){
    if(e.hp<=0 || !cs.enemies.includes(e)) continue;
    /* 节点先触发 */
    if(!e.nodeTriggered){
      triggerNodeFor(e);
    }
    if(!cs || e.hp<=0) continue; /* 冻结/睡眠检查 —— 节点后检查 */
    if(e.statuses.frozen || e.statuses.sleep){
      /* 无法行动 */
      continue;
    }
    /* 简单 AI：找主角 → 曼哈顿距离 ≤1 就打，否则移动1格靠近 */
    const dx = cs.hero.x - e.x, dy = cs.hero.y - e.y;
    const adx = Math.abs(dx), ady = Math.abs(dy);
    /* 有技能优先用技能（简化：用 def.skills[0] attack 类） */
    const attackSkills = (e.def.skills||[]).filter(s=>s.kind==='attack' && !e.cooldowns?.[s.id]);
    const skill = attackSkills.find(s=>{
      /* 检查技能是否能打到主角 */
      const range = rangeOf({target:s.target||'front2'}, e.x, e.y, e.facing);
      return range.some(p=>p.x===cs.hero.x && p.y===cs.hero.y);
    });
    if(skill){
      /* 用技能攻击主角 */
      if(skill.type){
        /* 先尝试元素附着（如果技能是元素类型，且元素可附着） */
        if(ELEM[skill.type]){
          for(const p of rangeOf(skill, e.x, e.y, e.facing)){
            const cell = _getCell(p.x,p.y);
            if(!cell || !cellElementable(cell)) continue;
            if(cell.element && cell.element!==skill.type){
              const ok = tryReactOnAttach(p.x,p.y, skill.type, e);
              if(!ok) setCellElement(p.x,p.y,skill.type);
            } else if(!cell.element){
              setCellElement(p.x,p.y,skill.type);
            }
          }
        }
      }
      /* 伤害主角 */
      const mult = skill.mult || 1.0;
      /* 元素亲和免疫（主角）不 —— 现在只有敌人有亲和，主角是承受方 */
      const dmg = Math.max(1, Math.round(e.atk * mult));
      damageHero(dmg, skill.type || 'physical');
      /* 冷却 */
      if(skill.cd != null){ e.cooldowns = e.cooldowns || {}; e.cooldowns[skill.id] = skill.cd; }
    } else {
      /* 没有技能能命中 → 尝试移动 */
      if(!e.statuses.bind && !e.statuses.frozen){
        /* 移动1格靠近主角 */
        let moved = false;
        const candidates = [];
        if(adx>0 && passable(e.x + Math.sign(dx), e.y)) candidates.push({x:e.x+Math.sign(dx), y:e.y});
        if(ady>0 && passable(e.x, e.y + Math.sign(dy))) candidates.push({x:e.x, y:e.y+Math.sign(dy)});
        /* 避开其他敌人 */
        const pick = candidates.find(p=>!cs.enemies.some(o=>o!==e && o.x===p.x && o.y===p.y));
        if(pick){
          e.x = pick.x; e.y = pick.y;
          /* 朝向：dx>=dy 就朝 x 方向，否则 y 方向 */
          e.facing = (adx >= ady) ? (dx>0?'right':'left') : (dy>0?'down':'up');
          moved = true;
        }
        if(moved){
          /* 移动后检查距离，若 ≤1 普攻 */
          const ndx = cs.hero.x - e.x, ndy = cs.hero.y - e.y;
          if(Math.abs(ndx)+Math.abs(ndy)<=1){
            damageHero(Math.max(1, Math.round(e.atk)), 'physical');
          }
        } else {
          /* 无法移动但相邻 → 普攻（被束缚时也可以攻击） */
          if(adx+ady<=1){
            damageHero(Math.max(1, Math.round(e.atk)), 'physical');
          }
        }
      }
    }
    /* 冷却 -1 */
    if(e.cooldowns){
      for(const k in e.cooldowns){
        if(e.cooldowns[k] > 0) e.cooldowns[k]--;
      }
    }
    /* 强制终止检查 */
    if(!combatState || cs.hero.hp<=0) return;
  }
}

/* ============ 自动技能阶段 ============
   玩家操控阶段结束后，自动技能按技能组顺序逐个执行。 */
function _runAutoSkills(){
  const cs = combatState;
  if(!cs) return;
  cs.phase = 'auto';
  for(const groupSkill of cs.skillGroup){
    /* 只取 auto kind 的 */
    if(groupSkill.skill.kind !== 'auto') continue;
    const roleKey = groupSkill.roleKey;
    /* 冷却检查 */
    const cooldown = cs.ally[roleKey].cds[groupSkill.skill.id] || 0;
    if(cooldown > 0) continue;
    /* 硬控制检查 */
    if(cs.ally.pro.statuses.frozen) continue;
    /* 技能使用次数 */
    if(cs.ally[roleKey].skillUsed) continue;
    /* 执行 */
    _executeSkill(roleKey, groupSkill.skill);
    cs.ally[roleKey].skillUsed = true;
    const cd = groupSkill.skill.cd != null ? groupSkill.skill.cd : 1;
    cs.ally[roleKey].cds[groupSkill.skill.id] = cd;
    if(!combatState) return;
  }
}

/* ============ 回合结束结算 ============ */
function _endPlayerPhase(){
  const cs = combatState;
  if(!cs) return;
  /* 召唤物行动 */
  _actPets();
  /* 敌方回合 */
  _enemyTurn();
  if(!combatState) return;
  /* 回合 +1，清理所有标记 */
  cs.turn++;
  cs.phase = 'end';
  /* 结界 tick —— 持续时间 -1 */
  _tickZones();
  /* 冷却 -1 */
  for(const k of G.team){
    if(cs.ally[k]){
      for(const c in cs.ally[k].cds){
        if(cs.ally[k].cds[c]>0) cs.ally[k].cds[c]--;
      }
    }
  }
  cs.playerMoved = false;
  cs.playerOver = false;
  for(const k of G.team){
    if(cs.ally[k]){
      cs.ally[k].skillUsed = false;
      cs.ally[k].nodeTriggered = false;
    }
  }
  for(const e of cs.enemies){
    e.nodeTriggered = false;
    for(const c in (e.cooldowns||{})){
      if(e.cooldowns[c]>0) e.cooldowns[c]--;
    }
  }
  /* 下一回合开始 —— 只做状态重置，不触发节点（节点在各自行动前触发） */
  cs.phase = 'start';
  /* 更新 UI */
  updateCombatUI();
  renderCombatMap();
  refreshHUD();
  checkCombatEnd();
}
function _tickZones(){
  const cs = combatState;
  if(!cs || !cs.zones?.length) return;
  for(const z of cs.zones.slice()){
    z.turnCounter++;
    /* 感电：所在地块是水附着 → 不减少 */
    const cell = _getCell(z.x, z.y);
    const skipDecr = (z.type==='electrocute' && cell && cell.element==='water');
    if(!skipDecr && z.turnCounter >= z.turns){
      /* 到期消失 */
      if(z.type==='burning'){
        /* 燃烧结界消失时，清理范围内所有【燃烧】debuff？不，debuff 是独立计时的 */
      }
      if(z.type==='superconduct'){
        /* 超导结界消失时，移除范围内所有单位的超导状态 */
        for(const e of cs.enemies){
          if(hasStatus(e.statuses, 'supercond')) removeStatus(e.statuses, 'supercond');
        }
        if(cs.ally.pro.statuses.supercond) removeStatus(cs.ally.pro.statuses, 'supercond');
      }
      cs.zones = cs.zones.filter(x=>x!==z);
      continue;
    }
    /* 燃烧结界：自身行动节点时刻（= 创建时 turnCounter=0，每回合 +1）对周围4格草附着地块施加火附着
       简化：每有敌方行动时触发一次 */
    if(z.type==='burning' && z.turnCounter > 0){
      /* 对周围4格已受草元素附着的地块施加火附着（会触发反应） */
      const targets = rangeAdj4(z.x, z.y);
      for(const p of targets){
        const c = _getCell(p.x, p.y);
        if(c && c.element==='grass'){
          /* 施加火 → 尝试反应（草+火 = 燃烧反应 → 但这里是反应后的燃烧结界再施火... 规则："对周围4格已受草元素附着的地块施加火元素附着"
             —— 这里施加的是火，已有草 → 触发燃烧反应（生成新的燃烧结界），新的结界继续独立计数。 */
          tryReactOnAttach(p.x, p.y, 'fire', z.casterKey);
          /* 反应后 clearCellElement 会刷新回 alwaysElement（草地刷新成草） */
        }
      }
      /* 范围内单位（含地块上的）施加【燃烧】debuff 3回合 */
      const adj9 = rangeAdj9(z.x, z.y);
      for(const p of adj9){
        const enemy = cs.enemies.find(e=>e.hp>0 && e.x===p.x && e.y===p.y);
        if(enemy && !enemy.statuses.burn){
          addStatus(enemy.statuses, 'burn', 3);
        }
        if(cs.hero.x===p.x && cs.hero.y===p.y && !cs.ally.pro.statuses.burn){
          addStatus(cs.ally.pro.statuses, 'burn', 3);
        }
        /* 火/冰地块上燃烧结界立即消失 */
        if(p.x===z.x && p.y===z.y){
          const c = _getCell(p.x,p.y);
          if(c && (c.element==='water' || c.element==='ice')){
            cs.zones = cs.zones.filter(x=>x!==z);
            break;
          }
        }
      }
    }
    /* 超导结界：范围内的单位自动获得 supercond 状态（离开时 remove） */
    if(z.type==='superconduct'){
      const inZones = new Set();
      for(const zz of cs.zones.filter(x=>x.type==='superconduct')){
        for(const p of rangeAdj9(zz.x, zz.y)){
          inZones.add(`${p.x},${p.y}`);
        }
      }
      for(const e of cs.enemies){
        const k = `${e.x},${e.y}`;
        if(inZones.has(k)){
          if(!e.statuses.supercond){ addStatus(e.statuses,'supercond'); }
        } else {
          if(e.statuses.supercond) removeStatus(e.statuses,'supercond');
        }
      }
      const hk = `${cs.hero.x},${cs.hero.y}`;
      if(inZones.has(hk)){
        if(!cs.ally.pro.statuses.supercond) addStatus(cs.ally.pro.statuses,'supercond');
      } else {
        if(cs.ally.pro.statuses.supercond) removeStatus(cs.ally.pro.statuses,'supercond');
      }
    }
  }
}

/* ============ 召唤物行动 ============ */
function _actPets(){
  const cs = combatState;
  if(!cs || !cs.pets?.length) return;
  for(const pt of cs.pets.slice()){
    if(pt.hp<=0 || !cs.pets.includes(pt)) continue;
    /* 触发节点 */
    triggerNodeFor(pt);
    if(!pt.acted){
      /* 找最近敌人 → 相邻就打，否则不动 */
      let best = null, bd = Infinity;
      for(const e of cs.enemies){
        if(e.hp<=0) continue;
        const d = dist(pt,e);
        if(d<bd){ bd=d; best=e; }
      }
      if(best && bd<=1){
        damageEnemy(best, Math.max(1, Math.round(pt.atk)), 'physical', 'pet');
      }
      pt.acted = true;
    }
  }
}

/* ============ 战斗结束 ============ */
function endCombat(victory, resultTxt){
  const cs = combatState;
  if(!cs) return;
  const [ex,ey] = cs.entryCell.split(',').map(Number);
  G.px = ex; G.py = ey; G.hero.hp = Math.max(1, Math.round(cs.hero.hp||1));
  G.hero.facing = 'up';
  /* 把地块元素附着留存到探索 */
  /* 敌人实体标记为空地 */
  const entry = G.map.cells[ey*G.map.n+ex];
  if(entry?.content?.type==='battle') entry.content = {type:'empty'};
  combatState = null;
  switchMode('story');
  prompt(''); renderMap(); refreshHUD(); renderIconbar();
  const lines = [];
  if(victory){
    grantVictoryRewards(cs.enemies.concat(cs.defeated||[]), lines);
  }
  if(resultTxt) lines.push(resultTxt);
  if(!lines.length) lines.push(victory?'战斗获得胜利。':'战斗结束。');
  showCombatEndPopup(victory?'战斗胜利':'战斗结束', lines);
}
function endCombatByDefeat(){
  const cs = combatState;
  if(!cs) return;
  const enemy = cs.enemies[0];
  const pen = (enemy && enemy.healthPenalty)||0;
  G.hero.health = Math.max(0, G.hero.health - pen);
  G.hero.hp = 1;
  const [ex,ey] = cs.entryCell.split(',').map(Number);
  G.px = ex; G.py = ey;
  const entry = G.map.cells[ey*G.map.n+ex];
  if(entry?.content?.type==='battle') entry.content = {type:'empty'};
  combatState = null;
  switchMode('story');
  prompt(''); renderMap(); refreshHUD(); renderIconbar();
  showCombatEndPopup('战斗失败', [`战斗失败，健康值 -${pen}。`], G.hero.health<=0);
}
function showCombatEndPopup(title, lines, thenGameOver){
  /* 调用 ui.js openModal */
  if(!window.openModal) return;
  openModal(title, `<div style="min-width:250px"><div style="font-size:14px;line-height:1.7;margin:4px 0 12px">${lines.map(l=>`<div>${l}</div>`).join('')}</div><div style="text-align:center"><button class="mbtn" id="ceConfirm">确认</button></div></div>`, 'small', {noCloseX:true});
  const btn = document.getElementById('ceConfirm');
  if(btn) btn.onclick = ()=>{ closeModal(); clearLog(); for(const l of lines) log(l); refreshHUD(); if(thenGameOver) showGameOver(); };
}
function grantRewardItems(en,rw,parts){ if(rw.fruitByHp){ let got=0; const tr=rw.fruitByHp; for(let i=0;i<tr.length;i++){ if((en.hp||0) < tr[i]) got=i+1; } if(got>0){ G.inventory.fruit=(G.inventory.fruit||0)+got; parts.push(`果子×${got}`); } if((en.hp||0)<=0 && rw.bonusItems){ for(const k in rw.bonusItems){ G.inventory[k]=(G.inventory[k]||0)+rw.bonusItems[k]; parts.push(`${RES_ZH[k]}×${rw.bonusItems[k]}`); } } return; } if(rw.items){ for(const k in rw.items){ G.inventory[k]=(G.inventory[k]||0)+rw.items[k]; parts.push(`${RES_ZH[k]}×${rw.items[k]}`); } } if(rw.rate){ for(const k in rw.rate){ if(k!=='prob' && Math.random()<(rw.rate.prob||1)){ G.inventory[k]=(G.inventory[k]||0)+rw.rate[k]; parts.push(`${RES_ZH[k]}×${rw.rate[k]}`); } } } if(rw.coin5 && Math.random()<0.5){ G.inventory.coin+=5; parts.push('金币×5'); } }
function grantRewardAttr(en,rw,parts){ if(rw.fruitByHp && (en.hp||0)>0) return; const howMany = rw.doubleUp?2:1; const choices = rw.attrChoices!=null ? rw.attrChoices : (en.tier==='elite'?3:2); for(let i=0;i<howMany;i++){ const pick=Math.floor(Math.random()*choices); if(pick===0){ G.hero.atk+=1; parts.push('属性升级：攻击+1'); } else if(pick===1){ G.hero.maxHp+=5; G.hero.hp=(G.hero.hp||0)+5; parts.push('属性升级：最大生命+5'); } else { G.hero.def+=1; parts.push('属性升级：防御+1'); } } }
function grantVictoryRewards(enemies, outParts){ for(const en of (enemies||[])){ if(en.fromSwarm||en.fromPack) continue; const rw=en.def?.reward; if(!rw) continue; const parts=[]; grantRewardItems(en,rw,parts); grantRewardAttr(en,rw,parts); if(parts.length) outParts.push(parts.join('，')); } /* 好奇心 */ if(G.team?.includes('xiayang')){ const cur = XIAYANG.passives.find(p=>p.id==='curious'); if(cur){ const extra=[]; if(Math.random()<0.3){ for(const en of (enemies||[])){ if(en.fromSwarm||en.fromPack) continue; const rw=en.def?.reward; if(rw) grantRewardItems(en,rw,extra); } } if(Math.random()<0.5){ G.inventory.coin=(G.inventory.coin||0)+1; extra.push('金币×1'); } if(extra.length) outParts.push('【好奇心】额外获得：'+extra.join('，')); } } /* 幸运硬币 */ const luckyN = G.inventory?.luckyCoin || 0; if(luckyN>0 && Math.random()<0.02*luckyN){ const extra=[]; for(const en of (enemies||[])){ if(en.fromSwarm||en.fromPack) continue; const rw=en.def?.reward; if(rw) grantRewardItems(en,rw,extra); } if(extra.length) outParts.push('【幸运硬币】额外获得：'+extra.join('，')); } }

/* ============ UI 兼容层 —— 让 ui.js/main.js 的旧调用不崩 ============
   这些函数保持旧签名，内部调用新版逻辑或简单返回默认值。 */
function updateCombatUI(){
  if(!combatState) return;
  const cs = combatState;
  const chars = getTeamChars();
  /* 角色卡栏 */
  const allyBar = $('#allyBar');
  if(allyBar){
    allyBar.innerHTML = chars.map((c,i)=>`<div class="allyCard ${c.key===cs.currentChar?'active':''}" data-k="${c.key}"><div class="allyName">${c.name}</div><div class="allyElem">${c.element?ELEM[c.element].zh:'无属性'} · ${i+1}号位</div></div>`).join('');
  }
  /* 属性 */
  const attr = $('#charAttrs');
  if(attr && PROTAGONIST){
    attr.innerHTML = `<span class="attr"><b>攻击</b> ${R(charAtk('pro'))}</span><span class="attr"><b>生命</b> ${R(cs.hero.hp)}/${R(heroineMaxHp())}</span><span class="attr"><b>防御</b> ${R(totalHeroDefense())}</span><span class="attr"><b>逃跑速度</b> ${R(G.hero.escapeSpeed)}</span>`;
  }
  /* 状态栏 */
  const statusBar = $('#statusBar');
  if(statusBar){
    statusBar.innerHTML = `<div class="stbar">${statusArr(cs.ally.pro.statuses).map(s=>`<span class="stchip st-${s.kind}" data-st="${s.id}">${s.name}${s.turns!=null?' ·'+s.turns+'回合':''}</span>`).join('') || '<span class="stempty">无状态</span>'}</div>`;
  }
  /* 技能列表 —— 新版：按技能组 */
  const skillList = $('#skillList');
  if(skillList){
    const flee = cs.enemies[0];
    const fleeRate = flee ? _calcEscapeRate() : 0;
    /* 角色 active 技能 + 逃跑 */
    const curChar = getChar(cs.currentChar);
    const activeSkills = curChar.skills.filter(s=>s.kind==='active');
    /* 简化展示 */
    skillList.innerHTML = activeSkills.map((s,i)=>{
      const cd = cs.ally[curChar.key].cds[s.id] || 0;
      return `<div class="skillTag attack"><span class="skillNum">${i+1}</span><span class="cat attack">主动</span>${s.name}${cd>0?` <span class="nohint">冷却${cd}</span>`:''}${cs.ally[curChar.key].skillUsed?' <span class="usedMark">已用</span>':''}</div>`;
    }).join('') + `<div class="skillTag escape"><span class="skillNum">4</span>逃　跑　${fleeRate}%</div>`;
    skillList.querySelectorAll('.skillTag').forEach(b=>b.onclick=()=>{
      if(b.dataset.s==='flee' || b.classList.contains('escape')){ tryFlee(); return; }
      /* 取 active 技能 */
      const idx = [...skillList.children].indexOf(b);
      const actives = curChar.skills.filter(s=>s.kind==='active');
      if(actives[idx]){
        /* 先触发主角行动节点 */
        _triggerHeroNode();
        /* 执行 */
        _executeSkill(cs.currentChar, actives[idx]);
        cs.ally[cs.currentChar].skillUsed = true;
        const cd = actives[idx].cd != null ? actives[idx].cd : 1;
        cs.ally[cs.currentChar].cds[actives[idx].id] = cd;
        checkCombatEnd();
        /* 玩家操控阶段：技能用了但玩家还可以移动/跳过（新版规则：移动或跳过结束回合） */
        /* 简化：技能使用后直接给残存时间等待 */
      }
    });
  }
  /* 右侧信息区 */
  const info = $('#promptZone');
  if(info){
    info.innerHTML = `<b>${cs.hero.facing==='up'?'向上':cs.hero.facing==='down'?'向下':cs.hero.facing==='left'?'向左':'向右'}</b><br>回合 ${cs.turn} <br>技能组槽位：${cs.skillGroup.length}/${Math.min(10, 4+getTeamChars().length)}`;
  }
  renderCombatMap();
}

/* enterCombatMode / switchMode 等 —— 这些在 ui.js/main.js 里，不用定义
   但 ensureKeyFocus / clearLog / clearStory / openModal / closeModal / refreshHUD / renderCombatMap 都在别处 */

/* 让 ui.js 的旧 selectSkill / castSkill 等能被调用 */
window.selectSkill = function(ck, sid){
  /* 简化：直接 castSkill */
  castSkill(ck);
};
window.castSkill = castSkill;

/* 旧版 autoCastAll —— 简化为触发自动技能阶段 */
window.autoCastAll = function(){
  _runAutoSkills();
  _endPlayerPhase();
};

/* 旧版 endPlayerPhase —— 现在在 UI 回调里也会调用 */
window.endPlayerPhase = _endPlayerPhase;

/* 旧版 applyBurnTick / poisonHero / statusChipHTML / statusBarHTML / heroStatusesWithDepress 保留签名（空实现） */
window.statusChipHTML = s => `<span class="stchip st-${s.kind}">${s.name}</span>`;
window.statusBarHTML = statuses => `<div class="stbar">${statusArr(statuses).map(s=>window.statusChipHTML(s)).join('')}</div>`;

/* 敌人切换等 UI 兼容 */
window.switchEnemyPage = function(p){ if(combatState) combatState.enemyPage=p; updateCombatUI(); };
window.heroInfoHTML = function(){ return `主角 · 生命 ${combatState.hero.hp}/${heroineMaxHp()}`; };
window.enemyInfo = function(en){ return `${en.name} HP ${en.hp}/${en.maxHp}`; };
window.enemyIntent = function(){ return '意图：行动'; };

/* combatMove（ui.js/main.js 会调用） */
window.combatMove = function(dx,dy){
  const cs = combatState;
  if(!cs) return;
  const cell = _getCell(cs.hero.x+dx, cs.hero.y+dy);
  if(!cell) return;
  /* 不可进 */
  const def = TERRAIN_DEFS[cell.terrain];
  if(!def || def.impassable){
    /* 只转向 */
    cs.hero.facing = dx>0?'right':(dx<0?'left':(dy>0?'down':'up'));
    G.hero.facing = cs.hero.facing;
    updateCombatUI();
    return;
  }
  /* 触发主角行动节点 */
  _triggerHeroNode();
  /* 移动 */
  cs.hero.x += dx; cs.hero.y += dy;
  G.px = cs.hero.x; G.py = cs.hero.y;
  cs.hero.facing = dx>0?'right':(dx<0?'left':(dy>0?'down':'up'));
  G.hero.facing = cs.hero.facing;
  /* 冰面强制滑动 */
  const cell2 = _getCell(cs.hero.x, cs.hero.y);
  if(cell2?.terrain==='ice' && G.vehicleSel===0){ /* 徒步进入 */
    const ndx = cs.hero.x + dx, ndy = cs.hero.y + dy;
    if(passable(ndx, ndy)){
      cs.hero.x = ndx; cs.hero.y = ndy;
      G.px = ndx; G.py = ndy;
      log('冰面滑行！');
    }
  }
  /* 风地块双动标记 */
  if(cell.element==='wind' || cell2.element==='wind'){
    cs.doubleMoveAvailable = true;
    log('风元素地块！可以双动。');
  }
  /* 标记已移动 */
  cs.playerMoved = true;
  /* 执行自动技能阶段 */
  _runAutoSkills();
  _endPlayerPhase();
};

/* 兼容旧的 reenterCombat */
window.reenterCombat = function(snap){
  /* 简化：直接 initCombatState */
  if(!snap || !G.map){ switchMode('story'); return; }
  initCombatState({ enemyKey: snap.enemyKey });
  enterCombatMode();
};
/* enterCombatMode —— 在 ui.js 定义，这里做个 stub */
if(typeof window.enterCombatMode !== 'function'){
  window.enterCombatMode = function(){ if(typeof switchMode==='function') switchMode('combat'); refreshHUD(); renderCombatMap(); };
}
if(typeof window.enterCombatMode_v2 !== 'function'){ /* 占位 */ }

/* 当前主角选择技能（主菜单里用） */
let _curSelectedSkillIdx = 0;
window.selectCurrentChar = function(key){
  const cs = combatState; if(!cs) return;
  cs.currentChar = key;
  _curSelectedSkillIdx = 0;
  updateCombatUI();
};
