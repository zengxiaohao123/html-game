/* ============================================================
   js/ui.js —— 模块：界面与UI
   DOM 便捷取元素、模式切换、HUD/图标行/地图渲染、
   日志/剧情/提示、面板弹窗、角色/背包/编队/任务/商店页。
   ============================================================ */
"use strict";

/* 取元素：接受带 # 前缀的 id（等价于 querySelector） */
const $=id=>document.querySelector(id);
/* 从 HTML 片段创建元素 */
function el(html){const d=document.createElement('div'); d.innerHTML=html; return d.firstElementChild;}

/* 切换底部剧情/战斗技能归属模式（不同区并存） */
function switchMode(m){
  gameMode=m;
  $('#bottom').classList.toggle('mode-story', m==='story');
  $('#bottom').classList.toggle('mode-combat', m==='combat');
  $('#rightTitle').textContent = m==='combat' ? '插曲' : '事件 / 选择';
  if(m==='story') $('#goBtn').style.display='none';
}

/* 刷新顶部状态栏（HUD） */
function refreshHUD(){
  if(!G) return;
  const h=G.hero;
  const hpCls=h.hp< h.maxHp*0.3?'hpfill low':'hpfill';
  $('#hud').innerHTML=
    `<span class="stat">健康 <b>${h.health}</b></span>`+
    `<span class="stat">天数 <b>${G.day}</b></span>`+
    `<span class="stat">区域 <b>${G.region==='wild'?'野外':'城市'}</b></span>`+
    `<span class="stat">攻击 <b>${h.atk}</b></span>`+
    `<span class="stat">防御 <b>${h.def}</b></span>`+
    `<span class="stat">生命 <b class="${hpCls}">${h.hp}/${h.maxHp}</b></span>`+
    `<span class="stat">金币 <b>${G.inventory.coin}</b></span>`+
    `<span class="stat">行动力 <b>${h.actionPoint}/${h.apCap}</b></span>`;
}

/* 刷新功能图标行（任务/编队/角色/背包/睡觉/设置/商店） */
function renderIconbar(){
  if(!G) return;
  const show=[[ '任务',openTasks],['编队',openFormation],['角色',openCharacters],
    ['背包',openInventory],['睡觉',sleep],['设置',openSettings],['商店',openShop]];
  $('#iconbar').innerHTML=show.map(([t,f],i)=>`<button class="icobtn${t==='睡觉'?' sleep':''}" data-i="${i}">${t}</button>`).join('');
  $('#iconbar').querySelectorAll('.icobtn').forEach(b=>b.onclick=()=>show[+b.dataset.i][1]());
  $('#iconbar').querySelectorAll('.icobtn')[6].classList.toggle('hidden', G.day<3);
}

/* 行动记录（左侧）追加一行 */
function log(msg){
  const d=el(`<div class="logline">${msg}</div>`);
  $('#logBody').appendChild(d);
  $('#logBody').scrollTop=$('#logBody').scrollHeight;
}

/* 剧情区（中下）追加一段 */
function story(html){$('#storyBody').insertAdjacentHTML('beforeend',`<div>${html}</div>`); $('#storyBody').scrollTop=$('#storyBody').scrollHeight;}
/* 右侧提示/选择区 */
function prompt(msg){$('#promptZone').innerHTML=msg;}

/* 元素着色（技能名等正文里的元素词改色） */
function e(txt){
  if(typeof txt!=='string') return txt;
  const map={fire:'火',water:'水',grass:'草',thunder:'雷',ice:'冰',wind:'风',rock:'岩'};
  for(const k in map){
    const re=new RegExp(map[k]+'(元素|附着|伤害|系)?','g');
    txt=txt.replace(re, (m)=>`<span class="${ELEM[k].c}">${m}</span>`);
  }
  return txt;
}

/* 渲染探索地图 */
function renderMap(){
  const m=G.map; const grid=$('#mapGrid');
  grid.style.gridTemplateColumns=`repeat(${m.n},44px)`;
  grid.innerHTML='';
  for(let y=0;y<m.n;y++){
    for(let x=0;x<m.n;x++){
      const c=m.cells[y*m.n+x];
      const cell=el('<div class="cell"></div>');
      if(c.terrain==='obstacle'){cell.classList.add('obstacle');}
      if(c.content && c.content.type) renderCellContent(cell,c);
      if(G.px===x&&G.py===y){cell.classList.add('player'); cell.classList.add('facing-'+G.hero.facing);}
      cell.dataset.x=x; cell.dataset.y=y;
      cell.addEventListener('click',()=>onCellClick(x,y));
      grid.appendChild(cell);
    }
  }
}

/* 渲染单格内容（敌人图标/宝箱/事件） */
function renderCellContent(cell,c){
  if(c.content.type==='enemy'){
    const eDef=ENEMIES[c.content.key];
    cell.textContent=eDef.icon;
    cell.style.color=eDef.color;
    cell.title=eDef.name;
    cell.innerHTML+=`<div class="hpbar"><i style="width:${Math.max(5,c.content.hp||eDef.hp)/eDef.hp*100}%"></i></div>`;
    if(c.content.aura) cell.innerHTML+=`<div class="aura-tag">${ELEM[c.content.aura].zh}</div>`;
  } else if(c.content.type==='loot' && !c.content.done){
    cell.textContent='📦'; cell.title='宝箱';
  } else if(c.content.type==='event' && !c.content.done){
    cell.textContent='❓'; cell.title='事件';
  }
}

/* —— 面板弹窗 —— */
function openSettings(){ openModal('设置', `
  <button class="mbtn" onclick="saveMenuOpen()">存档</button>
  <button class="mbtn" onclick="openReadSave()">读档</button>
  <button class="mbtn" onclick="closeModal();backToMenu()">返回主界面（不存档）</button>`, 'small'); }
function saveMenuOpen(){ openModal('选择存档位', buildSaveSlotHTML('save'), 'small'); }
function openReadSave(){ openReadSaveMenu(); }
function openModal(title,html,size){
  $('#modalTitle').textContent=title;
  const modal=$('#modalOverlay').querySelector('.modal');
  modal.className='modal'+(size==='small'?' small':(size==='wide'?' wide':''));
  $('#modalBody').innerHTML=html;
  $('#modalOverlay').classList.add('show');
}
function closeModal(){ $('#modalOverlay').classList.remove('show'); }
function alertDialog(title,msg){
  openModal(title, `<p>${msg}</p>`, 'small');
}
function openSaveMenu(){ openModal('选择存档位', buildSaveSlotHTML('save'), 'small'); }
function buildSaveSlotHTML(action){
  const saves=loadSaves();
  return savesSlotsHTML(action,saves);
}
function savesSlotsHTML(action,saves){
  let h='';
  for(let i=0;i<MAX_SAVES;i++){
    const s=saves[i];
    h+=`<button class="mbtn" onclick="${action==='save'?`doSave(${i})`:`doLoad(${i})`}">`+
       `存档位 ${i+1}${s?` — 第 ${s.day} 天 · 健康${s.hero.health} · ${new Date(s._ts).toLocaleString()}`:'（空）'}`+
      `</button>`;
  }
  return h;
}
window.doSave=function(i){ saveGame(i); log(`已保存到存档位 ${i+1}。`); closeModal(); };
window.doLoad=function(i){ if(loadGame(i)){ loadIntoWorld(); } else{ alert('该存档位为空。'); } };
function openReadSaveMenu(){ openModal('读取存档', buildSaveSlotHTML('load'), 'small'); }

/* —— 各功能页 —— */
function openInventory(){
  const inv=G.inventory;
  const rows=Object.entries(inv).map(([k,v])=>`<div class="resRow">${RES_ZH[k]||k}：<b>${v}</b></div>`).join('');
  openModal('背包', `<p>你随身携带的物品：</p>${rows}`);
}
function openCharacters(){
  const h=G.hero;
  openModal('角色 · 主角',
    `<div class="statGrid">
       <span>攻击 <b>${h.atk}</b></span><span>最大生命 <b>${h.maxHp}</b></span>
       <span>防御 <b>${h.def}</b></span><span>逃跑速度 <b>${h.escapeSpeed}</b></span>
       <span>健康 <b>${h.health}</b></span><span>行动力上限 <b>${h.apCap}</b></span>
     </div>
     <div><b>天赋</b>：</div>
     ${PROTAGONIST.passives.map(p=>`<div style="font-size:13px;color:var(--txt-dim);margin:3px 0">· ${p.name}：${p.desc}</div>`).join('')}
     <div style="margin-top:10px"><b>技能</b>（战斗中可带 3 个）：</div>
     ${PROTAGONIST.skills.map(s=>`<div style="font-size:13px;color:var(--txt-dim);margin:3px 0">· ${s.name}${PROTAGONIST.selectedSkillIds.includes(s.id)?' <span style="color:var(--gold)">[携带]</span>':''}：${e(s.desc)}</div>`).join('')}`);
}
function openFormation(){
  openModal('编队', `<p>当前队伍（主角一人）。后续可换入队友并调整站位。</p>
    <div style="font-size:14px;margin-top:8px">· 一号位：主角</div>
    <p style="color:var(--txt-dim);margin-top:8px">队友（许泠朦 / 夏阳 / 陆悠悠 / 叶唯安等）在后续版本加入。</p>`);
}
function openTasks(){
  openModal('任务', `<p>任务记录：</p>
    <p>· 存活下去（进行中）</p>
    <p>· 探索第 ${G.day} 天的新地图（进行中）</p>`);
}
function openShop(){
  openModal('商店', `<p>商店商品与定价仍在设计中（待定）。</p>`);
}