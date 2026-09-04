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
  $('#rightTitle').textContent = '信息';
  if(m==='story') $('#goBtn').style.display='none';
}

/* 清空行动记录 / 剧情区 */
function clearLog(){ $('#logBody').innerHTML=''; }
function clearStory(){ $('#storyBody').innerHTML=''; }

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

/* 刷新功能图标行（任务/编队/角色/背包/睡觉/设置/商店/合成/载具） */
function renderIconbar(){
  if(!G) return;
  const show=[[ '任务',openTasks],['编队',openFormation],['角色',openCharacters],
    ['背包',openInventory],['睡觉',sleep],['设置',openSettings],['商店',openShop],['合成',openCraft],['载具',openVehicles]];
  $('#iconbar').innerHTML=show.map(([t,f],i)=>`<button class="icobtn${t==='睡觉'?' sleep':''}" data-i="${i}">${t}</button>`).join('');
  $('#iconbar').querySelectorAll('.icobtn').forEach(b=>b.onclick=()=>show[+b.dataset.i][1]());
  // 商店在游戏前期隐藏（按中文名定位，避免数字下标错位）
  const shopIdx=show.findIndex(s=>s[0]==='商店');
  $('#iconbar').querySelectorAll('.icobtn')[shopIdx].classList.toggle('hidden', G.day<3);
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

/* 词条：把已知【词条】转为下划线可悬浮弹窗，未知的加粗 */
function terms(txt){
  if(typeof txt!=='string') return txt;
  return txt.replace(/【([^】]+)】/g, (m,zh)=> TERM_KEYS[zh]? termHTML(TERM_KEYS[zh], zh) : `<b>${m}</b>`);
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
      else if(c.terrain==='void'){cell.classList.add('void');}
      if(c.terrain!=='void' && c.content && c.content.type) renderCellContent(cell,c);
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
  } else if(c.content.type==='loot' && !c.content.done){
    cell.textContent='📦'; cell.title='宝箱';
  } else if(c.content.type==='event' && !c.content.done){
    cell.textContent='❓'; cell.title='事件';
  }
}

/* —— 面板弹窗 —— */
function openSettings(){ openModal('设置', `
  <div style="display:flex;gap:14px;flex-wrap:wrap">
    <button class="mbtn small" onclick="saveMenuOpen()">存档</button>
    <button class="mbtn small" onclick="openReadSave()">读档</button>
    <button class="mbtn small" onclick="closeModal();backToMenu()">返回主界面（不存档）</button>
  </div>`, 'full'); }
function saveMenuOpen(){ openModal('选择存档位', buildSaveSlotHTML('save'), 'small'); }
function openReadSave(){ openReadSaveMenu(); }
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

/* —— 各功能页（大面板，占据整个屏幕） —— */
function openInventory(){
  const inv=G.inventory;
  const rows=Object.entries(inv).map(([k,v])=>`<div class="resRow">${itemName(k)}：<b>${v}</b></div>`).join('');
  openModal('背包', `<p style="font-size:15px">你随身携带的物品：</p><div style="display:flex;flex-wrap:wrap;gap:14px;margin-top:10px">${rows}</div>`);
}

/* —— 弹窗层级栈：记录已打开的前一层，供 ESC 退回一层 —— */
let modalStack=[];
function openModal(title,html,size,opt){
  const ov=$('#modalOverlay');
  // 已有弹窗且非「原地刷新」（replace，用于合成/载具数值反复变化）：先把当前层压栈，便于 ESC 后退
  if(ov.classList.contains('show') && !(opt&&opt.replace)){
    const m=ov.querySelector('.modal');
    const sz=m.classList.contains('small')?'small':m.classList.contains('wide')?'wide':m.classList.contains('full')?'full':'';
    modalStack.push({title:$('#modalTitle').textContent, html:$('#modalBody').innerHTML, size:sz});
  }
  $('#modalTitle').textContent=title;
  const modal=ov.querySelector('.modal');
  modal.className='modal'+(size==='small'?' small':(size==='wide'?' wide':(size==='full'?' full':'')));
  $('#modalBody').innerHTML=html;
  ov.classList.add('show');
}
function closeModal(){ $('#modalOverlay').classList.remove('show'); modalStack.length=0; }
/* ESC 退回一层；若无更后一层则完全关闭 */
function modalBack(){
  if(modalStack.length){ const p=modalStack.pop(); $('#modalOverlay').classList.remove('show'); openModal(p.title,p.html,p.size); return true; }
  closeModal(); return false;
}

/* —— 角色页：每角色一页，点击名字切换（切换时立即高亮被选按钮） —— */
let charPageKey='pro';
function openCharacters(){ renderCharacters(); }
function renderCharacters(){
  const keys=['pro',...Object.keys(ALLIES)];
  const tabs=keys.map(k=>`<button class="ctab ${k===charPageKey?'on':''}" data-k="${k}">${getChar(k).name}</button>`).join('');
  openModal('角色', `<div class="ctabs">${tabs}</div><div id="charPageBody">${charPageBody(charPageKey)}</div>`, 'full');
  $('#modalBody').querySelectorAll('.ctab').forEach(b=>b.onclick=()=>{ charPageKey=b.dataset.k; renderCharacters(); });
}
function charPageBody(key){
  const c=getChar(key);
  const bondHTML = key==='pro'
    ? '' // 主角无羁绊等级
    : `<span>羁绊等级 <b>${G.bonds&&G.bonds[key]?G.bonds[key].level:1}</b></span>`;
  const attrs = key==='pro'
    ? `<span>攻击 <b>${G.hero.atk}</b></span><span>最大生命 <b>${G.hero.maxHp}</b></span><span>防御 <b>${G.hero.def}</b></span><span>逃跑速度 <b>${G.hero.escapeSpeed}</b></span><span>健康 <b>${G.hero.health}</b></span><span>行动力上限 <b>${G.hero.apCap}</b></span>`
    : `<span>攻击 <b>${c.atk}</b></span><span>属性 <b>${c.element?ELEM[c.element].zh:'无'}</b></span>${bondHTML}`;
  const talents=c.passives.map(p=>{
    const name=p.scal? talentDisplayName(key,p) : p.name;
    const desc=p.scal? lvDescText(p, entryLevel(key,p)) : terms(p.desc);
    return `<div class="charTalent">· ${name}：${desc}</div>`;
  }).join('');
  const skills=c.skills.map(s=>`<div class="charSkill">· ${skillDisplayName(key,s)}${c.selectedSkillIds.includes(s.id)?' <span class="carry">[携带]</span>':''}：${describeSkill(key,s)}</div>`).join('');
  return `<div class="charHead">${c.name}${c.element?`（<span class="${ELEM[c.element].c}">${ELEM[c.element].zh}</span>）`:''}</div>
    <div class="statGrid">${attrs}</div>
    <div class="sec"><b>天赋</b></div>${talents}
    <div class="sec"><b>技能</b>（战斗中可携带至多3个）</div>${skills}
    <div style="margin-top:14px"><button class="mbtn" onclick="openSkillManager('${key}')">调整携带技能</button></div>`;
}

/* —— 携带技能管理：至多3个，天赋不算 —— */
let skillPickSel={};
function openSkillManager(key){
  skillPickSel[key]=getChar(key).selectedSkillIds.slice();
  renderSkillManager(key);
}
function renderSkillManager(key){
  const c=getChar(key); const sel=skillPickSel[key];
  const skills=c.skills.map(s=>{ const on=sel.includes(s.id);
    return `<div class="skillpick ${on?'sel':''}" onclick="toggleSkillPick('${key}','${s.id}')">${on?'☑':'☐'} <b>${skillDisplayName(key,s)}</b>：${describeSkill(key,s)}</div>`;
  }).join('');
  openModal(`调整携带技能 · ${c.name}`,
    `<p style="font-size:14px;margin-bottom:8px">至多选择 3 个技能（当前 ${sel.length}/3，天赋不计）。</p>${skills}
     <div class="btn-row" style="margin-top:10px">
       <button class="mbtn small" onclick="saveSkillManager('${key}')">保存</button>
       <button class="mbtn small" onclick="openCharacters()">取消</button>
     </div>`);
}
window.toggleSkillPick=function(key,id){
  const sel=skillPickSel[key]; const i=sel.indexOf(id);
  if(i>=0) sel.splice(i,1);
  else { if(sel.length>=3){ alert('至多携带 3 个技能。'); return; } sel.push(id); }
  renderSkillManager(key);
};
window.saveSkillManager=function(key){
  getChar(key).selectedSkillIds=skillPickSel[key].slice();
  closeModal();
  openCharacters();
};

/* —— 编队：调换一二三号位 —— */
function openFormation(){ renderFormation(); }
function renderFormation(){
  const team=G.team.slice();
  const rows=team.map((k,i)=>{
    const bond = k!=='pro' ? ` <span class="fbond">羁绊 ${G.bonds&&G.bonds[k]?G.bonds[k].level:1} 级</span>` : '';
    return `
    <div class="frow">
      <span class="fpos">${i+1}号位</span>
      <span class="fname">${getChar(k).name}${bond}</span>
      ${i>0?`<button class="mbtn small" onclick="moveSlot(${i},-1)">上移</button>`:''}
      ${i<team.length-1?`<button class="mbtn small" onclick="moveSlot(${i},1)">下移</button>`:''}
    </div>`;
  }).join('');
  openModal('编队', `<p style="font-size:15px">调换队伍一二三号位（影响战斗自动释放顺序）。</p>${rows}`, 'full');
}
window.moveSlot=function(i,dir){
  const t=G.team.slice(); const j=i+dir;
  if(j<0||j>=t.length) return;
  const tmp=t[i]; t[i]=t[j]; t[j]=tmp;
  G.team=t;
  renderFormation();
};

function openTasks(){
  openModal('任务', `<p style="font-size:15px">任务记录：</p>
    <p style="font-size:15px;margin:8px 0">· 存活下去（进行中）</p>
    <p style="font-size:15px;margin:8px 0">· 探索第 ${G.day} 天的新地图（进行中）</p>`);
}
function openShop(){
  openModal('商店', `<p style="font-size:15px">商店商品与定价仍在设计中（待定）。</p>`);
}

/* —— 地图视口：滚轮缩放 + 拖拽平移（仅视觉，不影响内容） —— */
let mapDragMoved=false; // 拖拽后抑制误触发的点击
(function initMapViewport(){
  const vp=$('#mapViewport'); const grid=$('#mapGrid');
  let scale=1;
  vp.addEventListener('wheel', e=>{
    e.preventDefault();
    scale=Math.min(2, Math.max(0.5, scale + (e.deltaY>0?-0.12:0.12)));
    grid.style.transform=`scale(${scale})`;
  }, {passive:false});
  let down=false,sx=0,sy=0,sl=0,st=0;
  vp.addEventListener('mousedown',e=>{
    down=true; mapDragMoved=false; sx=e.clientX; sy=e.clientY; sl=vp.scrollLeft; st=vp.scrollTop;
    vp.classList.add('dragging');
  });
  document.addEventListener('mousemove',e=>{
    if(down){
      const dx=e.clientX-sx, dy=e.clientY-sy;
      if(Math.abs(dx)>5||Math.abs(dy)>5) mapDragMoved=true;
      vp.scrollLeft=sl-dx; vp.scrollTop=st-dy;
    }
  });
  document.addEventListener('mouseup',()=>{ down=false; vp.classList.remove('dragging'); });
})();

/* 点击状态芯片/天赋标签 → 在附近弹窗查看详情；点击其余处关闭弹窗。
   弹窗默认在元素下方，若超出屏幕底部则翻转到上方，避免被遮挡。 */
function openPopoverNear(el, html){
  const tip=$('#popover');
  tip.innerHTML=html;
  tip.style.display='block';
  tip.style.visibility='hidden'; // 先隐藏以测量尺寸
  const r=el.getBoundingClientRect();
  const w=tip.offsetWidth||260, h=tip.offsetHeight||60;
  tip.style.visibility='visible';
  let x=r.left;
  if(x+w>window.innerWidth-8) x=Math.max(8, window.innerWidth-8-w);
  let y=r.bottom+6;
  if(y+h>window.innerHeight-8) y=Math.max(8, r.top-h-6);
  tip.style.left=x+'px'; tip.style.top=y+'px';
}
document.addEventListener('click',ev=>{
  const st=ev.target.closest('.stchip');
  if(st){
    const rounds=st.textContent.match(/·(\d+)回合/);
    openPopoverNear(st, `<b>${st.dataset.name}</b>${rounds?`（${rounds[1]}回合）`:''}<br>${st.dataset.desc||''}`);
    return;
  }
  const tg=ev.target.closest('.talentTag');
  if(tg){
    const owner=tg.dataset.k; const c=getChar(owner); const t=c.passives[+tg.dataset.i];
    if(t){
      const name=t.scal? talentDisplayName(owner,t) : t.name;
      const desc=t.scal? lvDescText(t, entryLevel(owner,t)) : t.desc;
      openPopoverNear(tg, `<b>${name}</b><br>${desc}`);
    }
    return;
  }
  $('#popover').style.display='none';
});

/* —— ESC 退回一层界面 —— */
/* 主界面/游戏结束界面：无效果；有弹窗：退回一层；主要游玩页：打开设置。
   不影响行动记录区、地图本身、角色技能区、选项信息区。 */
document.addEventListener('keydown', ev=>{
  if(ev.key!=='Escape') return;
  ev.preventDefault();
  if($('#menuOverlay').classList.contains('show') || $('#gameoverOverlay').classList.contains('show')) return;
  if($('#modalOverlay').classList.contains('show')){ modalBack(); return; }
  if(G) openSettings();
});