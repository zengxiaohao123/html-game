/* ============================================================
   js/explore.js —— 探索模式（回字形地图）

   新机制：
   · 主角每次只能沿上下左右走 1 格（必须在回字圈上）
   · 每走 1 步固定消耗 1 点行动力（探索专用，战斗中不消耗）
   · 允许原地踏步（点击自己所在格 → 前往）：视为再次进入本地块，消耗 1 行动力
   · 点击地块 → 预览信息 → 点"前往"按钮触发移动
   · 遇到地块内容（battle/emergency/event/loot/reward/empty）→ 按规则处理
   · 队友永远与主角同位置（不视为独立实体）
   ============================================================ */
"use strict";

/** previewCell 由 main.js 声明，此处直接复用 */

/** 全局：点击地图某格 */
function onCellClick(x, y){
  if(combatState){ combatCellClick(x, y); return; }
  if(isInFlow()){ return; }   // 事件中不可移动
  if(mapDragMoved) return;

  const m = G.map;
  const c = cellAt(m, x, y);
  if(!c){ previewCell = null; goBtnDisabled(); prompt('位置不存在。'); return; }

  previewCell = { x, y };
  let info = `<b>位置 (${x+1}, ${y+1})</b><br>`;

  if(!c.passable){
    if(c.terrain === 'void') info += '不可通行（地图之外）。';
    else info += '无法通行。';
    prompt(info); goBtnDisabled(); return;
  }

  // 主角自己所在格的预览
  const isSelf = (x === G.px && y === G.py);
  const ct = c.content && c.content.type;

  if(isSelf){
    info += '你正站在这里。';
    if(ct === 'battle') info += `<br>此处有一场普通作战，原地踏步可再次触发。`;
    else if(ct === 'emergency') info += `<br>此处有一场紧急作战，原地踏步可再次触发。`;
    else if(ct === 'event' && !c.content.done) info += `<br>此处有事件，原地踏步可再次触发。`;
    else if(ct === 'loot' && !c.content.done) info += `<br>此处有战利品可拾取。`;
    else if(ct === 'reward') info += `<br>此处有一场 Boss 战。`;
    else info += `<br>原地踏步将再次搜索此地。`;
  } else {
    // 非本格：只允许上下左右的相邻格（回字形，只有一圈）
    const dx = Math.abs(x - G.px), dy = Math.abs(y - G.py);
    const adj = (dx + dy === 1);
    if(!adj){
      info += '太远了。你每次只能走相邻一格（上下左右）。';
      prompt(info); goBtnDisabled(); return;
    }
    if(ct === 'battle') info += '前方有一场普通作战。移动过去将进入战斗。';
    else if(ct === 'emergency') info += '前方有一场紧急作战！';
    else if(ct === 'event' && !c.content.done) info += '前方有事件发生。';
    else if(ct === 'event') info += '这里的事件已处理过。';
    else if(ct === 'loot' && !c.content.done) info += '前方有战利品可拾取。';
    else if(ct === 'loot') info += '这里的战利品已被取走，如今是空地。';
    else if(ct === 'reward') info += '前方有一场 Boss 战！';
    else info += '空地。';
  }

  info += `<br>行动力消耗：<b>1</b>`;
  prompt(info);

  // 前往按钮
  if((G.hero.actionPoint || 0) >= 1){
    const go = qs('#goBtn');
    go.style.display = 'block'; go.disabled = false;
    go.classList.remove('disabled');
    go.textContent = `前往 · 消耗 1 行动力`;
    go.onclick = () => { go.style.display = 'none'; stepToCell(x, y); };
  } else {
    goBtnDisabled();
  }
}

function goBtnDisabled(){
  const go = qs('#goBtn');
  go.style.display = 'block'; go.disabled = true;
  go.classList.add('disabled'); go.textContent = '无法前往';
  go.onclick = null;
}

/**
 * 核心：执行一步移动（或原地踏步）
 * @param {number} x
 * @param {number} y
 */
function stepToCell(x, y){
  if(combatState) return;
  if(isInFlow()) return;
  if((G.hero.actionPoint || 0) < 1){ log('行动力不足。'); return; }

  const m = G.map;
  const target = cellAt(m, x, y);
  if(!target || !target.passable){ log('无法到达。'); renderMap(); return; }

  const ox = G.px, oy = G.py;
  const dx = x - ox, dy = y - oy;
  const adj = (Math.abs(dx) + Math.abs(dy) === 1);
  const self = (x === ox && y === oy);

  if(!adj && !self){
    log('每次只能走相邻一格或原地踏步。');
    return;
  }

  // === 消耗 ===
  G.hero.actionPoint -= 1;
  G.hero.facing = dirToFacing(dx, dy);

  // === 位移（原地踏步坐标不变）===
  if(!self){ G.px = x; G.py = y; }

  // === 队友位置绑定（队友永远跟主角）===
  // （队友没有独立坐标系统，这是"永远绑定主角"的语义化表达）

  renderMap();
  refreshHUD();

  // === 触发地块内容 ===
  triggerCellContent(target, self);

  // === 主角方的特殊天赋（蹁跹、枯木新枝等）===
  triggerExplorePassives();

  if(!combatState){ refreshHUD(); renderMap(); }
  if(typeof window.triggerMainStorySeg === 'function') window.triggerMainStorySeg();
}

/** 触发地块内容（进入本格时执行）*/
function triggerCellContent(target, isSelfStep){
  const ct = target.content && target.content.type;

  switch(ct){
    case 'battle':
      log('遭遇敌人！进入战斗。');
      startCombat(target, { enemyPool: 'normal' });
      break;
    case 'emergency':
      log('紧急作战！');
      startCombat(target, { enemyPool: 'emergency' });
      break;
    case 'reward':
      log('遭遇 Boss！');
      startCombat(target, { enemyPool: 'boss' });
      break;
    case 'loot':
      if(!target.content.done){ openLoot(target); }
      else { log('这里的东西已被取走。'); }
      break;
    case 'event':
      if(!target.content.done){ startEvent(target.x, target.y); }
      else { log('这里没有什么特别的。'); }
      break;
    case 'empty':
    default:
      const got = searchEmpty();
      if(got) log(`在空地搜到 <b>${got}</b>。`);
      else log('空地空空如也，一无所获。');
      break;
  }
}

/** 主角方移动后的天赋效果 */
function triggerExplorePassives(){
  // 夏阳·蹁跹：探索时每次移动后为主角回复 N 点生命
  if(G.team && G.team.indexOf('luyouyou') >= 0){
    const yo = typeof getChar === 'function' ? getChar('luyouyou') : null;
    const dance = yo && yo.passives && yo.passives.find(p => p.id === 'dance');
    if(dance && typeof tierValue === 'function'){
      const lv = typeof entryLevel === 'function' ? entryLevel('luyouyou', dance) : 1;
      const hv = tierValue(dance, lv, 'move') || 0;
      if(hv > 0 && typeof heroDisplayMaxHp === 'function'){
        const cap = heroDisplayMaxHp();
        const nx = Math.min(cap, G.hero.hp + hv);
        if(nx > G.hero.hp){ const got = nx - G.hero.hp; G.hero.hp = nx; log(`【蹁跹】移动后回复 ${got} 点生命。`); }
      }
    }
  }
  // 枯木新枝：每次移动回 12 生命（可叠加）
  const deadwoodN = (G.inventory.deadwoodSprout || 0);
  if(deadwoodN > 0 && typeof heroDisplayMaxHp === 'function'){
    const cap = heroDisplayMaxHp();
    const got = 12 * deadwoodN;
    const nx = Math.min(cap, G.hero.hp + got);
    if(nx > G.hero.hp){ const real = nx - G.hero.hp; G.hero.hp = nx; log(`【枯木新枝】回复 ${real} 点生命。`); }
  }
}

/** WASD 方向 → facing */
function dirToFacing(dx, dy){
  if(dx > 0) return 'right';
  if(dx < 0) return 'left';
  if(dy > 0) return 'down';
  return 'up';
}

/** 空地搜索 */
function searchEmpty(){
  const pool = G.region === 'wild' ? NATURAL_RESOURCES.slice() : CITY_RESOURCES.slice();
  const items = {};
  let found = false;
  for(let i = 0; i < 3; i++){
    if(Math.random() < 0.5){
      const kind = pool[Math.floor(Math.random() * pool.length)];
      items[kind] = (items[kind] || 0) + 2;
      found = true;
    } else { break; }
  }
  const keys = Object.keys(items);
  if(keys.length){
    for(const k of keys){ G.inventory[k] = (G.inventory[k] || 0) + items[k]; }
    return keys.map(k => `${RES_ZH[k]}×${items[k]}`).join('，');
  }
  // 愧怍补偿
  const kuiZuoN = (G.inventory.kuiZuo || 0);
  if(kuiZuoN > 0){
    const report = [];
    for(let i = 0; i < kuiZuoN; i++){
      const r = Math.random();
      if(r < 0.5){ continue; }
      const kind = pool[Math.floor(Math.random() * pool.length)];
      if(r < 0.75){ G.inventory[kind] = (G.inventory[kind] || 0) + 1; report.push(`${RES_ZH[kind]}×1`); }
      else        { G.inventory[kind] = (G.inventory[kind] || 0) + 2; report.push(`${RES_ZH[kind]}×2`); }
    }
    if(report.length){
      log('【《愧怍》补偿】你从空地翻出了一些东西：' + report.join('，') + '。');
      return '(《愧怍》)';
    }
  }
  return null;
}

function gainRandomResource(n){
  const pool = G.region === 'wild' ? NATURAL_RESOURCES.slice() : CITY_RESOURCES.slice();
  const k = pool[Math.floor(Math.random() * pool.length)];
  G.inventory[k] = (G.inventory[k] || 0) + n;
  return `${RES_ZH[k]}×${n}`;
}

/** 拾取战利品 */
function openLoot(target){
  target.content.done = true;
  target.content.type = 'empty';
  const r = Math.random(); let txt = '';
  if(r < 0.40){ txt = gainRandomResource(2); }
  else if(r < 0.90){ txt = gainRandomResource(4); }
  else if(r < 0.97){ const g = 4 + Math.floor(Math.random() * 7); G.inventory.coin += g; txt = `金币×${g}`; }
  else if(r < 0.997){ const k = Math.random() < 0.5 ? 'club' : 'cloth'; grantPermanentItem(k); txt = itemName(k) + '×1'; }
  else { const k = Math.random() < 0.5 ? 'dagger' : 'leather'; grantPermanentItem(k); txt = itemName(k) + '×1'; }
  log(`拾取战利品：<b>${txt}</b>。`);
  refreshHUD(); renderMap();
}

/** 辅助：主角点击自己所在格就是原地踏步 */
function isSelfStepTarget(x, y){ return (x === G.px && y === G.py); }

window.onCellClick = onCellClick;
window.stepToCell = stepToCell;
window.triggerCellContent = triggerCellContent;
window.isSelfStepTarget = isSelfStepTarget;
window.searchEmpty = searchEmpty;
