/* ============================================================
   js/ui.js —— 模块：界面与UI
   ============================================================ */
"use strict";
const $=id=>document.querySelector(id);
function el(html){const d=document.createElement('div'); d.innerHTML=html; return d.firstElementChild;}
function switchMode(m){ gameMode=m; $('#bottom').classList.toggle('mode-story', m==='story'); $('#bottom').classList.toggle('mode-combat', m==='combat'); $('#rightTitle').textContent='信息'; if(m==='story') $('#goBtn').style.display='none'; }
function clearLog(){ $('#logBody').innerHTML=''; }
function clearStory(){ storyClear(); }
/* ---- 打字机剧情引擎 ----
   规则：storyPush 追加一段并开始打字。段打字完成后触发 storyOnDone（不自动连打）。
   点击剧情区：打字中→storySkipToEnd 立即显示整段；已打完→storyAdvance 推进到下一段
   （若有多段则打下一段；若已是最后一段则交由调用方 storyOnEnd 处理，如清空剧情区）。
   注：段间推进依赖外部调用 storyAdvance，引擎不自动连打，以支持“段间点击推进”。 */
let storyQueue=[];
let storyTimer=null;
let storyTyping=false;
let storyIdx=0;
let storyCurrent=null;
let storyOnDone=null;   // 当前段打完后的回调（用于事件：非末段时留待点击，末段时显示选项）
let storyOnEnd=null;    // 全部段都打完后的回调（结果最后一段点击清空等）
function storyClear(){ storyQueue=[]; if(storyTimer){clearInterval(storyTimer);storyTimer=null;} storyTyping=false; storyCurrent=null; storyOnDone=null; storyOnEnd=null; $('#storyBody').innerHTML=''; }
function storyPush(html, onDone, onEnd){
  const clean=String(html).trim();
  const paras=clean.split(/(?=<\/?p>|<br\s*\/?>)/).filter(s=>s&&s.trim());
  const merged=[];
  for(let i=0;i<paras.length;i++){
    let seg=paras[i];
    if(/^<p[^>]*>/.test(seg) && !/<\/p>$/.test(seg) && i+1<paras.length){ seg += paras[i+1]; i++; }
    if(seg&&seg.trim()) merged.push(seg);
  }
  const list=merged.length?merged:[clean];
  for(const p of list){ if(p&&p.trim()) storyQueue.push(p); }
  if(onDone) storyOnDone=onDone;
  if(onEnd) storyOnEnd=onEnd;
  storyRunNext();
}
function storyRunNext(){
  if(storyTyping||storyTimer) return;
  if(!storyQueue.length){ const e=storyOnEnd; storyOnEnd=null; if(e) e(); return; }
  storyCurrent=storyQueue.shift();
  storyTyping=true; storyIdx=0;
  const plain=storyCurrent.replace(/<[^>]+>/g,'');
  const box=$('#storyBody');
  const para=document.createElement('div'); para.className='story-para';
  box.appendChild(para);
  storyTimer=setInterval(()=>{
    storyIdx=Math.min(storyIdx+1, plain.length);
    para.innerHTML=escapeHtml(plain.slice(0,storyIdx)) + (storyIdx<plain.length?'<span class="story-caret"></span>':'');
    box.scrollTop=box.scrollHeight;
    if(storyIdx>=plain.length){
      if(storyTimer){clearInterval(storyTimer);storyTimer=null;}
      storyTyping=false;
      para.innerHTML=storyCurrent;
      box.scrollTop=box.scrollHeight;
      storyCurrent=null;
      const d=storyOnDone; storyOnDone=null;
      if(d) d();   // 段打完回调（不再自动连打）
    }
  }, 1000/30);
}
function storySkipToEnd(){ // 点击时打字中：立即显示本段全部文字（不推进）
  if(!storyTyping) return false;
  const box=$('#storyBody'); const para=box.lastElementChild;
  if(para&&para.classList.contains('story-para')&&storyCurrent){
    para.innerHTML=storyCurrent;
    if(storyTimer){clearInterval(storyTimer);storyTimer=null;}
    storyTyping=false; storyCurrent=null;
    box.scrollTop=box.scrollHeight;
    const d=storyOnDone; storyOnDone=null;
    if(d) d();
    return true;
  }
  return false;
}
function storyAdvance(){ // 已打完且有待打段落时：推进到下一段
  if(storyTyping) return;
  if(storyQueue.length){ storyRunNext(); return true; }
  return false;
}
function storyIsTyping(){ return storyTyping; }
function storyHasMore(){ return storyQueue.length>0; }
function escapeHtml(t){ return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function story(html){ storyPush(html); }
function itemDetailHTML(key){
  let body='';
  if(FOOD[key] || key==='cookedMeat'){
    let add = FOOD[key]&&FOOD[key].healthChance ? '，有20%概率健康+1' : '';
    body = `回复 <span class="lvlup">${foodHeal(key)}</span> 点生命${add}（已计入篝火、烹饪天赋加成）。`;
  } else if(key==='clearMind'){
    body = `心理压力<span style="color:#d9534f">+4</span>，立即回满生命值与行动力并解除 ${termHTML('depress','抑郁')} 状态，本日内主角攻击力+25%、受到的伤害-25%。`;
  } else if(ITEMS[key] && ITEMS[key].permanent && (ITEMS[key].desc||'').indexOf('天赋')>=0){
    const map={club:'crit',cloth:'block',dagger:'blood',leather:'hold',ironSword:'momentum'};
    if(map[key]){ const tid=map[key]; const tname=(PROTAGONIST.passives.find(p=>p.id===tid)||{}).name || tid; const lv=(G&&G.proLevels&&G.proLevels[tid])||1; body=`使主角【天赋·${tname}】升为 <span class="lvlup">${lv+1}</span> 级（当前 ${lv} 级）。`; }
    else body = ITEMS[key].desc || '';
  } else if(key==='armor'){ const lv=(G&&G.proLevels&&G.proLevels.block)||1; body=`使【格挡】升为 <span class="lvlup">${lv+2}</span> 级、【坚守】升为 <span class="lvlup">${((G&&G.proLevels&&G.proLevels.hold)||1)+1}</span> 级。`; }
  else { body = itemDesc(key)||'（暂无说明）'; }
  /* === lore 蓝色文学描述 === */
  const lore = (ITEMS[key] && ITEMS[key].lore) || '';
  return lore ? `${body}<div class="item-lore">${lore}</div>` : body;
}
function itemUsable(k){ if(FOOD[k] || k==='clearMind') return !!FOOD[k] || k==='clearMind'; return false; }
function refreshHUD(){ if(!G) return;
  /* === 首次获得 hook 兜底检查 === */
  G.records=G.records||{};
  if(!G.records.fruitFirstOwned && (G.inventory.fruit||0)>0) G.records.fruitFirstOwned=true;
  if(!G.records.cookedMeatFirstOwned && (G.inventory.cookedMeat||0)>0) G.records.cookedMeatFirstOwned=true;
  if(!G.records.nonWalkVehicleOwned){ if((G.vehicles||[]).some(v=>v.key&&!['walk','dash'].includes(v.key))){ G.records.nonWalkVehicleOwned=true; } }
  /* === HUD === */
  const h=G.hero; const mHp=heroDisplayMaxHp(); const hpCls=h.hp< mHp*0.3?'hpfill low':'hpfill';
  const depress = h.depress ? `<span class="stat depress-stat">${termHTML('depress','抑郁')}</span>` : '';
  const psy = Math.max(-100, Math.min(100, (h.psyStress||0)));
  $('#hud').innerHTML=`<span class="stat">健康 <b>${h.health}</b></span>`+`<span class="stat">天数 <b>${G.day}</b></span>`+`<span class="stat">区域 <b>${G.region==='wild'?'野外':'城市'}</b></span>`+`<span class="stat">攻击 <b>${heroDisplayAtk()}</b></span>`+`<span class="stat">防御 <b>${heroDisplayDef()}</b></span>`+`<span class="stat">生命 <b class="${hpCls}">${h.hp}/${mHp}</b></span>`+`<span class="stat">金币 <b>${G.inventory.coin}</b></span>`+`<span class="stat">行动力 <b>${h.actionPoint}/${h.apCap}</b></span>`+`<span class="stat">心理压力 <b>${psy}</b></span>`+depress;
}
function renderIconbar(){ if(!G) return; const show=[[ '任务',openTasks],['编队',openFormation],['角色',openCharacters],['背包',openInventory],['睡觉',sleep],['设置',openSettings],['商店',openShop],['合成',openCraft],['载具',openVehicles]]; const blocked = (combatState||eventState) ? new Set(['编队','睡觉','商店','合成']) : new Set(); $('#iconbar').innerHTML=show.map(([t,f],i)=>`<button class="icobtn${t==='睡觉'?' sleep':''}${blocked.has(t)?' dis':''}" data-i="${i}">${t}</button>`).join(''); $('#iconbar').querySelectorAll('.icobtn').forEach(b=>b.onclick=()=>show[+b.dataset.i][1]()); }
function log(msg){ const d=el(`<div class="logline">${msg}</div>`); const body=$('#logBody'); body.appendChild(d); body.scrollTop=body.scrollHeight; /* 行动记录区无上限，仅战斗开始/结束/睡觉时清除 */ }
function story(html){$('#storyBody').insertAdjacentHTML('beforeend',`<div>${html}</div>`); $('#storyBody').scrollTop=$('#storyBody').scrollHeight;}
function prompt(msg){$('#promptZone').innerHTML=msg;}
function terms(txt){ if(typeof txt!=='string') return txt; return txt.replace(/【([^】]+)】/g, (m,zh)=> TERM_KEYS[zh]? termHTML(TERM_KEYS[zh], zh) : `<b>${m}</b>`); }
function renderMap(){ const m=G.map; const grid=$('#mapGrid'); grid.style.gridTemplateColumns=`repeat(${m.n},44px)`; grid.innerHTML=''; for(let y=0;y<m.n;y++){ for(let x=0;x<m.n;x++){ const c=m.cells[y*m.n+x]; const cell=el('<div class="cell"></div>'); if(c.terrain==='obstacle'){cell.classList.add('obstacle');} else if(c.terrain==='void'){cell.classList.add('void');} if(c.terrain!=='void' && c.content && c.content.type) renderCellContent(cell,c); if(G.px===x&&G.py===y){cell.classList.add('player'); cell.classList.add('facing-'+G.hero.facing);} cell.dataset.x=x; cell.dataset.y=y; cell.addEventListener('click',()=>onCellClick(x,y)); grid.appendChild(cell); } } }
function renderCellContent(cell,c){ if(c.content.type==='battle' && !c.content.done){ if(c.content.rare && (G.inventory.roadmap||0)>0){ cell.textContent='🐻'; cell.title='稀有动物'; cell.style.color='#ffd700'; } else if(c.content.sub==='hard'){ cell.textContent='⚠️'; cell.title='紧急作战'; cell.style.color='#ff6b6b'; } else if(c.content.sub==='boss'){ cell.textContent='💀'; cell.title='boss战'; } else { cell.textContent='⚔'; cell.title='作战'; } return; } else if(c.content.type==='loot' && !c.content.done){ cell.textContent='🎁'; cell.title='战利品'; } else if(c.content.type==='event' && !c.content.done){ cell.textContent='❓'; cell.title='事件'; } }
function openSettings(){ const lbl = combatState? '存档（回本次战斗开始时）' : (eventState? '存档（回本次事件开始时）' : '存档'); openModal('设置', `<div style="display:flex;flex-direction:column;gap:14px"><button class="mbtn big" onclick="saveMenuOpen()">${lbl}</button><button class="mbtn big" onclick="openReadSave()">读档</button><button class="mbtn big" onclick="closeModal();backToMenu()">返回主界面（不存档）</button></div>`, 'small'); const sm=$('#modalOverlay .modal'); if(sm) sm.classList.add('settingz'); }
function saveMenuOpen(){ openModal('选择存档位', buildSaveSlotHTML('save'), 'small'); }
function openReadSave(){ openReadSaveMenu(); }
function alertDialog(title,msg){ openModal(title, `<p>${msg}</p>`, 'small'); }
function openSaveMenu(){ openModal('选择存档位', buildSaveSlotHTML('save'), 'small'); }
function buildSaveSlotHTML(action){ return savesSlotsHTML(action, loadSaves()); }
function savesSlotsHTML(action,saves){ let h=''; for(let i=0;i<MAX_SAVES;i++){ const s=saves[i]; h+=`<button class="mbtn" onclick="${action==='save'?`doSave(${i})`:`doLoad(${i})`}">`+`存档位 ${i+1}${s?` — 第 ${s.day} 天 · 健康${s.hero.health} · ${new Date(s._ts).toLocaleString()}`:'（空）'}`+`</button>`; } return h; }
window.doSave=function(i){ saveGame(i); log(`已保存到存档位 ${i+1}。`); closeModal(); };
window.doLoad=function(i){ if(loadGame(i)){ loadIntoWorld(); } else{ alert('该存档位为空。'); } };
function openReadSaveMenu(){ openModal('读取存档', buildSaveSlotHTML('load'), 'small'); }
let invMsg='';
let invTab='consumable';
let invSelKey=null;
const INV_CATS=[{id:'consumable',label:'消耗品'},{id:'permanent',label:'永久物品'},{id:'misc',label:'杂物'},{id:'quest',label:'任务道具'}];
function invClassify(key){
  /* 杂物：新功能物品归类 */
  if(['kuiZuo','deadwoodSprout','windChime','luckyCoin'].includes(key)) return 'misc';
  if(ITEMS[key] && ITEMS[key].permanent){
    /* 永久物品：原有（club/cloth/quilt/tent/campfire/trap/leather/ironSword/armor/roadmap/goodCard/caiyunPendant/dagger）+ broom/clearMind永久也归 permanent */
    return 'permanent';
  }
  /* 使用消耗/资源 */
  if(RES_ZH[key] && key!=='amethyst') return 'consumable';
  if(ITEMS[key]) return ITEMS[key].vehicle ? 'misc' : 'consumable';
  return 'consumable';
}
function openInventory(){
  if(G){ invMsg=''; invTab='consumable'; invSelKey=null; renderInventory(); }
}
function renderInventory(){
  const allKeys=Object.keys(G.inventory).filter(k=>k!=='coin' && (G.inventory[k]||0)>0);
  const byCat={consumable:[], permanent:[], misc:[], quest:[]};
  for(const k of allKeys){ const c=invClassify(k); if(byCat[c]) byCat[c].push(k); }
  const currentKeys = byCat[invTab]||[];
  /* 选中检查 */
  if(!currentKeys.includes(invSelKey)) invSelKey = currentKeys[0] || null;
  /* 左侧网格 */
  const tiles = currentKeys.map(k=>{
    const n=G.inventory[k];
    const sel=(k===invSelKey)?' on':'';
    return `<div class="itile inv-cell${sel}" data-k="${k}"><div class="iname craftlink" data-key="${k}">${itemName(k)}</div><div class="icount">×${n}</div></div>`;
  }).join('');
  /* 右侧描述栏 */
  let rightHTML='';
  if(invSelKey){
    const k=invSelKey; const n=G.inventory[k];
    const useBtn = (!combatState && !eventState && itemUsable(k)) ? `<button class="mbtn tiny invUse" onclick="useInvItem('${k}')">使用</button>` : '';
    rightHTML = `<div class="inv-detail-right">
      <div class="dr-name">${itemName(k)} ×${n} ${useBtn}</div>
      <div class="dr-desc">${terms(itemDetailHTML(k))}</div>
    </div>`;
  } else {
    rightHTML = `<div class="inv-detail-right"><div class="dr-empty">请点击左侧物品查看描述</div></div>`;
  }
  const tabBtns=INV_CATS.map(t=>`<button class="inv-tab ${invTab===t.id?'on':''}" data-id="${t.id}">${t.label}${byCat[t.id]&&byCat[t.id].length?` (${byCat[t.id].length})`:''}</button>`).join('');
  openModal('背包',
    `<div class="invbar"><span class="invtitle">随身物品</span><span class="invcoin">金币 <b>${G.inventory.coin}</b></span></div>`+
    `<div class="inv-tabs">${tabBtns}</div>`+
    (invMsg?`<div class="shopmsg">${invMsg}</div>`:'')+
    `<div class="inv-layout"><div class="inv-grid-left"><div class="vgrid inv">${tiles||'<span class="stempty">此类下没有物品</span>'}</div></div>${rightHTML}</div>`, 'full', {replace:true});
  $('#modalBody').querySelectorAll('.inv-tab').forEach(b=>b.onclick=()=>{ invTab=b.dataset.id; invSelKey=null; renderInventory(); });
  /* 点击物品选中/取消 */
  $('#modalBody').querySelectorAll('.inv-cell').forEach(t=>{
    t.onclick=ev=>{
      if(ev.target.classList.contains('craftlink')){ if(window.openItemHelp) openItemHelp(t.dataset.k); return; }
      if(invSelKey===t.dataset.k) invSelKey=null; else invSelKey=t.dataset.k;
      renderInventory();
    };
  });
}
window.useInvItem=function(k){ if(combatState||eventState){ invMsg='事件中无法使用背包物品。'; renderInventory(); return; } const n=G.inventory[k]||0; if(n<=0){ renderInventory(); return; }
  /* === 明心浆 === */
  if(k==='clearMind'){
    G.inventory[k]-=1;
    G.hero.psyStress = Math.max(-100, Math.min(100, (G.hero.psyStress||0)+4));
    G.hero.hp = heroDisplayMaxHp();
    G.hero.actionPoint = G.hero.apCap;
    if(G.hero.depress){ G.hero.depress=false; log(`使用了 <b>${itemName(k)}</b>，解除了${termHTML('depress','抑郁')}状态！`); }
    /* 当日 buff */
    G.hero.clearMindBuff = { day:G.day, atkUp:25, dr:25 };
    log(`使用了 <b>${itemName(k)}</b>：生命值与行动力回满，心理压力+4。本日内主角攻击力+25%、受到的伤害-25%。`);
    refreshHUD(); renderInventory(); return;
  }
  /* === 食物 === */
  if(!FOOD[k]){ renderInventory(); return; }
  G.inventory[k]-=1;
  const heal=foodHeal(k); const before=G.hero.hp;
  if(heal && G.hero.hp<heroineMaxHp()){ G.hero.hp=Math.min(heroineMaxHp(), G.hero.hp+heal); }
  log(`使用了 <b>${itemName(k)}</b>，回复 ${G.hero.hp-before} 点生命。`);
  if(k==='fruit' && FOOD[k].healthChance && Math.random()<FOOD[k].healthChance){ G.hero.health+=1; log('果子蕴含生机，你的<b>健康</b>+1。'); }
  /* === 启程任务挂钩：果腹 / 大口吃肉 === */
  if(k==='fruit'){ G.records.qFruitCount = (G.records.qFruitCount||0)+1; }
  if(k==='cookedMeat'){ G.records.qMeatCount = (G.records.qMeatCount||0)+1; }
  refreshHUD(); renderInventory();
};
let modalStack=[];
function openModal(title,html,size,opt){ const ov=$('#modalOverlay'); if(ov.classList.contains('show') && !(opt&&opt.replace)){ const m=ov.querySelector('.modal'); const sz=m.classList.contains('small')?'small':m.classList.contains('wide')?'wide':m.classList.contains('full')?'full':''; modalStack.push({title:$('#modalTitle').textContent, html:$('#modalBody').innerHTML, size:sz}); } const br=ov.querySelector('.btn-row'); if(br){ br.style.display=''; } $('#modalTitle').textContent=title; const modal=ov.querySelector('.modal'); modal.className='modal'+(size==='small'?' small':(size==='wide'?' wide':(size==='full'?' full':''))); $('#modalBody').innerHTML=html; const mx=document.getElementById('modalX'); if(mx) mx.style.display=(opt&&opt.noCloseX)?'none':'block'; ov.classList.add('show'); }
function closeModal(){
  // 问题2：离开角色页面时，自动重置选中主角 + 技能展示（不清除其他界面文本）
  try{ if($('#modalTitle') && $('#modalTitle').textContent==='角色'){ charPageKey='pro'; charPageTab='skills'; } }catch(e){}
  $('#modalOverlay').classList.remove('show'); modalStack.length=0;
}
function onModalX(){ if(swapOpen){ applySwap(); } closeModal(); }
function modalBack(){ if(modalStack.length){ const p=modalStack.pop(); $('#modalOverlay').classList.remove('show'); openModal(p.title,p.html,p.size); return true; } closeModal(); return false; }
let charPageKey='pro'; let charPageTab='skills';
function openCharacters(){ renderCharacters(); }
function renderCharacters(){
  const keys=['pro',...Object.keys(ALLIES)];
  const tabs=keys.map(k=>`<button class="ctab ${k===charPageKey?'on':''}" data-k="${k}">${getChar(k).name}</button>`).join('');
  openModal('角色',
    `<div class="ctabs">${tabs}</div>`+
    `<div id="charLayout">${charPageLayout(charPageKey)}</div>`,
    'full', {replace:true});
  $('#modalBody').querySelectorAll('.ctab').forEach(b=>b.onclick=()=>{ charPageKey=b.dataset.k; renderCharacters(); });
  // 任务7：事件/战斗中禁用 carry & interact 按钮
  if(combatState || eventState){
    document.querySelectorAll('#charLayout .csidebtn[data-tab="carry"], #charLayout .csidebtn[data-tab="interact"]').forEach(b=>{
      b.classList.add('dis'); b.disabled=true; b.title='事件/战斗中不可使用';
    });
  }
  interactInit();
}
/* 任务5+6+7：角色页面布局 —— 顶部角色按钮行居中；右侧1/5常驻侧栏；左侧内容区 */
function charPageLayout(key){
  const c=getChar(key);
  const isPro = key==='pro';
  const b = isPro? null : getBond(key);
  const canCarryInteract = !(combatState||eventState);
  const sideTabs = [
    {tab:'skills',  label:'技能展示',   enabled:true},
    {tab:'carry',   label:'调整技能',   enabled:canCarryInteract && !isPro},   // 任务5改名+任务7禁用
    {tab:'interact',label:'交互',       enabled:canCarryInteract && !isPro},   // 任务7禁用
    {tab:'bond',    label:'羁绊等级效果', enabled:!isPro},
    {tab:'story',   label:'故事',       enabled:true},
  ];
  const sideBtns = sideTabs.map(t=>`<button class="csidebtn ${charPageTab===t.tab?'on':''}${t.enabled?'':' dis'}" data-tab="${t.tab}" ${t.enabled?`onclick="setCharPageTab('${t.tab}')"`:'disabled'}>${t.label}</button>`).join('');
  const subMap={skills:charSkillsTab, carry:charCarryTab, interact:charInteractTab, bond:charBondTab, story:charStoryTab};
  const body = (subMap[charPageTab]||charSkillsTab)(key, c);
  return `
  <div class="char-layout">
    <div class="char-main">
      <div class="charPageSub">${body}</div>
    </div>
    <div class="char-side">
      <div class="csname">${c.name}</div>
      ${!isPro ? `<div class="csbond">羁绊 <b>${b.level}</b> 级<br>好感度 <b>${b.affinity}</b></div>` : `<div class="csbond" style="color:var(--txt-dim)">主角 · 无羁绊</div>`}
      <div class="csbtns">${sideBtns}</div>
    </div>
  </div>`;
}
window.setCharPageTab=function(id){ if(!['skills','carry','interact','bond','story'].includes(id)) return; if((combatState||eventState) && (id==='carry'||id==='interact')) return; charPageTab=id; renderCharacters(); };
function charSkillsTab(key,c){ c=c||getChar(key);
  const attrs= key==='pro'
    ? `<span>攻击 ${R(charAtk('pro'))}</span><span>最大生命 ${R(heroDisplayMaxHp())}</span><span>防御 ${R(heroDisplayDef())}</span><span>逃跑速度 ${R(G.hero.escapeSpeed)}</span><span>健康 ${R(G.hero.health)}</span><span>行动力上限 ${R(G.hero.apCap)}</span>`
    : `<span>攻击 ${R(charAtk(key))}</span><span>属性 ${c.element?ELEM[c.element].zh:'无'}</span>`;
  const talents=c.passives.map(p=>{ const name=p.scal? talentDisplayName(key,p):p.name; const desc=p.scal? lvDescText(p,entryLevel(key,p)) : terms(p.desc); return `<div class="charTalent"><span class="cat talent">天赋</span>${name}：${desc}</div>`; }).join('');
  const skills=c.skills.map(s=>`<div class="charSkill"><span class="cat ${s.kind==='attack'?'attack':'support'}">${s.kind==='attack'?'攻击':'辅助'}</span>${skillDisplayName(key,s)}${c.selectedSkillIds.includes(s.id)?' <span class="carry">[携带]</span>':''}：${describeSkill(key,s)}</div>`).join('');
  return `<div class="statGrid char-attrs">${attrs}</div><div class="sec"><b>天赋</b></div>${talents}<div class="sec"><b>技能</b>（战斗中可携带至多3个）</div>${skills}`;
}
function charCarryTab(key,c){ c=c||getChar(key); let sel=skillPickSel[key]; if(!sel) sel=getChar(key).selectedSkillIds.slice(); const rows=c.skills.map(s=>{ const on=sel.includes(s.id); return `<div class="skillpick ${on?'sel':''}" onclick="toggleCarryPick('${key}','${s.id}')">${on?'☑':'☐'} <b>${skillDisplayName(key,s)}</b>：${describeSkill(key,s)}</div>`; }).join(''); return `<p style="font-size:14px;margin-bottom:8px">至多选择 3 个技能（当前 ${sel.length}/3，天赋不计）。</p>${rows}<div class="btn-row" style="margin-top:10px"><button class="mbtn small" onclick="saveCarry('${key}')">保存</button></div>`; }
window.toggleCarryPick=function(key,id){ if(!skillPickSel[key]) skillPickSel[key]=getChar(key).selectedSkillIds.slice(); const sel=skillPickSel[key]; const i=sel.indexOf(id); if(i>=0) sel.splice(i,1); else { if(sel.length>=3){ alert('至多携带 3 个技能。'); return; } sel.push(id); } renderCharacters(); };
window.saveCarry=function(key){ if(skillPickSel[key]){ getChar(key).selectedSkillIds=skillPickSel[key].slice(); skillPickSel[key]=null; log(`已保存 ${getChar(key).name} 的携带技能。`); } renderCharacters(); };
function charInteractTab(key,c){ c=c||getChar(key); if(key==='pro') return '<p>你们是……同一个人，情谊无需经营。</p>'; return `<div class="interact-wrap" id="interactWrap"><div class="interact-placeholder">加载互动界面…</div></div>`; }
/* ---- 交互界面（左列可选项 / 右对话区，打字机出字） ---- */
const INTER_MAX=40;
let interHist={}, interTyping={}, interTick={};
let giftOpenKey=null, giftSelItem=null, giftJustOpened=false;
const GIFT_EXCLUDE=['coin','campfire','club','cloth','tent','trap','quilt','dagger','leather','ironSword','armor','goodCard',
  /* === 新物品 === */ 'broom','clearMind','luckyCoin','deadwoodSprout','kuiZuo','windChime','roadmap'];
function interactInit(){ const wrap=$('#interactWrap'); if(!wrap) return; if(charPageTab!=='interact') return; giftOpenKey=null; giftSelItem=null; giftJustOpened=false; renderInteractBody(charPageKey); }
function interactButtons(key){ if(key==='xiayang'){ return [['chat','聊天（成功率 50%）'],['feed','投喂'],['gift','送礼']]; } if(key==='luyouyou'){ const st=lyChatState(); return [['chat',`聊天（成功率 ${Math.round(st.cur)}%）`],['gift','送礼']]; } return []; }
function renderInteractBody(key){
  const wrap=$('#interactWrap'); if(!wrap) return; const c=getChar(key);
  const btns=interactButtons(key).map(([id,label])=>`<button class="csub ilbtn" data-act="${id}">${label}</button><br>`).join('');
  const hints = key==='xiayang'? '<div class="interact-hint">聊天消耗 1 行动力；投喂每天仅第一次提升好感度；每 3 天可送礼 1 次。</div>' : '<div class="interact-hint">聊天消耗 1 行动力（每日成功率随机）；每 3 天可送礼 1 次。</div>';
  let html=`<div class="interact-box"><div class="interact-left"><div class="interact-left-head">${c.name}</div>${btns}${hints}</div><div class="interact-right"><div class="interact-dlg" id="interactDlg_${key}"></div><div class="interact-opt" id="interactOpt_${key}"></div></div></div>`;
  // 仅当送礼面板打开且 DOM 里还没时才注入（避免每次 render 都闪）
  if(giftOpenKey===key && !$('#giftOverlay')) html = `<div class="gift-overlay" id="giftOverlay">${renderGiftGrid(key)}</div>` + html;
  wrap.innerHTML=html;
  const dlg=$('#interactDlg_'+key);
  (interHist[key]||[]).forEach(m=>{ const d=document.createElement('div'); d.className='iline'; d.innerHTML=m; dlg.appendChild(d); });
  dlg.scrollTop=dlg.scrollHeight;
  wrap.querySelectorAll('.ilbtn').forEach(b=>b.onclick=()=>interactAction(key,b.dataset.act));
  // 送礼面板的点击事件（如果当前打开）
  if(giftOpenKey===key){ decorateGiftCells(); }
  if(interTyping[key]!=null) startInterType(key,interTyping[key]);
}
function interactAction(key,act){ if(act==='chat') interactChat(key); else if(act==='feed') interactFeed(key); else if(act==='gift') openGift(key); }
/* 打字机：把一段文本打进右侧对话区 */
function startInterType(key,html){ const dlg=$('#interactDlg_'+key); if(!dlg) return; if(interTick['t'+key]) clearInterval(interTick['t'+key]); const plain=html.replace(/<[^>]+>/g,''); const node=document.createElement('div'); node.className='iline typing'; dlg.appendChild(node); dlg.scrollTop=dlg.scrollHeight; let i=0; interTick['t'+key]=setInterval(()=>{ i=Math.min(i+1,plain.length); node.innerHTML=escapeHtml(plain.slice(0,i))+(i<plain.length?'<span class="story-caret"></span>':''); dlg.scrollTop=dlg.scrollHeight; if(i>=plain.length){ clearInterval(interTick['t'+key]); interTick['t'+key]=null; node.innerHTML=html; node.classList.remove('typing'); interTyping[key]=null; interHist[key]=interHist[key]||[]; interHist[key].push(html);
      // 聊天历史上限：按字符总长度删最早消息，**同时同步删 DOM 节点**（否则对话框会一直累积变滚动区）
      const MAX_TOTAL_LEN = 3000;
      let totalLen = interHist[key].join('').length;
      while(totalLen>MAX_TOTAL_LEN && interHist[key].length>1){
        const old = interHist[key].shift(); totalLen -= old.length;
        // 同步删除对话 DOM 里最早的 .iline（跳过 typing 状态的那个，那个就是当前 node，我们从最前删）
        const firstLine = dlg.querySelector('.iline:not(.typing)');
        if(firstLine && firstLine!==node){ if(firstLine.parentNode){ firstLine.parentNode.removeChild(firstLine); } }
      }
    } },1000/40); }
/* 问题1：若上一段未打完，立即把它显示完全（保留），再在下一行开始新的文本 */
function interactSay(key,html){ const dlg=$('#interactDlg_'+key); if(dlg){
    const node=dlg.querySelector('.iline.typing'); if(node){ node.innerHTML=interTyping[key]||''; node.classList.remove('typing'); }
  }
  if(interTick['t'+key]){ clearInterval(interTick['t'+key]); interTick['t'+key]=null; }
  interTyping[key]=html; startInterType(key,html);
  // 问题3：陆悠悠聊天成功率——每次交互完后刷新按钮上显示的整数成功率（直接改 DOM 文字，避免整页重绘）
  const ilbtns = document.querySelectorAll('.ilbtn');
  if(key==='luyouyou'){ try{
    const st=lyChatState();
    const pct=Math.max(0,Math.min(100,Math.round(st.cur)));
    ilbtns.forEach(b=>{ if(b.dataset.act==='chat') b.textContent=`聊天（成功率 ${pct}%）`; });
  }catch(e){} }
}
/* 对话中途选项（沿用事件选项区 UI，置于对话区下侧） */
function interactOption(key,opts){ const box=$('#interactOpt_'+key); if(!box) return; box.innerHTML=opts.map((o,i)=>`<div class="ev-opt" data-i="${i}"><div class="ev-opt-name">${o.name}</div>${o.desc?`<div class="ev-opt-desc">${o.desc}</div>`:''}</div>`).join(''); box.querySelectorAll('.ev-opt').forEach(b=>b.onclick=()=>{ const i=+b.dataset.i; const fn=opts[i]&&opts[i].onPick; box.innerHTML=''; if(fn) fn(); }); }
/* 聊天 */
function lyChatState(){ G.records=G.records||{}; if(!G.records.lychat) G.records.lychat={day:0,base:0,cur:0}; const s=G.records.lychat; const day=G.day||1; if(s.day!==day){ s.day=day; s.base=Math.round(Math.random()*80-20); s.cur=s.base; } return s; }
function interactChat(key){ const c=getChar(key); if((G.hero.actionPoint||0)<1){ interactSay(key,`你的行动力不足，无法与 ${c.name} 聊天。（聊天需消耗 1 行动力）`); return; } G.hero.actionPoint-=1; refreshHUD(); if(key==='xiayang'){ if(Math.random()<0.5){ gainAffinity(key,1); interactSay(key,`${c.name}：你讲了个烤熊掌的笑话，夏阳先是愣了一下，随后笑出了声。……你俩相谈甚欢。<span class="lvlup">好感度+1</span>（消耗 1 行动力）`); } else { interactSay(key,`你聊起路上的见闻，夏阳却只是「嗯嗯」地点着头，明显兴致缺缺。<span class="lvlup">好感度+0</span>（消耗 1 行动力）`); } } else if(key==='luyouyou'){ const st=lyChatState(); const curInt=Math.round(st.cur); const ok = curInt>=0 && Math.random()*100<curInt; if(ok){ const add=Math.round(2+Math.random()*2); st.cur = Math.max(0, Math.min(100, curInt+add)); gainAffinity(key,1); interactSay(key,`${c.name}：哈哈，你说话真有意思，我很受用。<span class="lvlup">好感度+1</span>（本日聊天成功率 +${add}%，消耗 1 行动力）`); } else { const sub=Math.round(2+Math.random()*2); st.cur = Math.max(0, Math.min(100, curInt-sub)); interactSay(key,`${c.name}：嗯……这句就没那么有趣了。我再看下路线。<span class="lvlup">好感度+0</span>（本日聊天成功率 -${sub}%，消耗 1 行动力）`); } } }
/* 投喂（仅夏阳）：自动消耗回复量最少的食物 */
function interactFeed(key){ if(key!=='xiayang') return; const c=getChar(key); const foods=Object.keys(FOOD).filter(k=>(G.inventory[k]||0)>0); if(!foods.length){ interactSay(key,`你翻遍了背包，也没有任何可以投喂的食物。`); return; } let chosen=null,ch=null; for(const f of foods){ const h=foodHeal(f); if(chosen===null||h<ch){ chosen=f; ch=h; } } G.inventory[chosen]--; G.records=G.records||{}; if(!G.records.feedDay) G.records.feedDay={}; const day=G.day||1; const first = G.records.feedDay[key]!==day; if(first){ G.records.feedDay[key]=day; gainAffinity(key,1); } refreshHUD(); interactSay(key,first? `${c.name}：你投喂了 ${itemName(chosen)}。夏阳眼睛一亮，几口就吃完了。<span class="lvlup">好感度+1</span>` : `${c.name}：你投喂了 ${itemName(chosen)}，但夏阳已经吃饱了，摆摆手。<span class="lvlup">好感度+0</span>（每天仅第一次投喂提升好感度）`); }
/* 送礼 */
function giftCooldownLeft(key){ G.records=G.records||{}; const gd=(G.records.giftDay||{})[key]; if(gd==null) return 0; const d=(G.day||1)-gd; return Math.max(0,3-d); }
function giftableItems(){ return Object.keys(G.inventory).filter(k=>(G.inventory[k]||0)>0 && !GIFT_EXCLUDE.includes(k)); }
function renderGiftGrid(key){ const cd=giftCooldownLeft(key); const can = cd<=0; const items=giftableItems(); const cells=items.map(it=>`<div class="gift-cell ${giftSelItem===it?'sel':''}" data-k="${it}"><div class="gift-cname">${itemName(it)}</div><div class="gift-count">×${G.inventory[it]}</div></div>`).join('') || '<span class="nohint">背包里没有可送的物品。</span>'; const cdTxt = can? '' : `<div class="gift-cd">${getChar(key).name} 还有 <b>${cd}</b> 天才能再次送礼。</div>`; return `<div class="gift-head">选择礼物（每 3 天可送礼 1 次，不可赠送永久道具）${cdTxt}</div><div class="gift-grid">${cells}</div><div class="gift-foot"><button class="mbtn small" onclick="confirmGift()" ${can?'':'disabled'}>确认送出</button><button class="mbtn small" onclick="closeGift()">取消</button></div>`; }
function openGift(key){ giftOpenKey=key; giftSelItem=null; giftJustOpened=true; renderInteractBody(key); decorateGiftCells(); }
/* 问题1修复：礼物点击不再重绘整个面板，只切换 class；避免每点一次就闪 */
function decorateGiftCells(){ const box=$('#giftOverlay'); if(!box) return; if(giftCooldownLeft(giftOpenKey)>0) return; box.querySelectorAll('.gift-cell').forEach(c=>{ c.onclick=()=>{ const k=c.dataset.k; const wasSel = c.classList.contains('sel'); box.querySelectorAll('.gift-cell.sel').forEach(x=>x.classList.remove('sel')); if(!wasSel){ c.classList.add('sel'); giftSelItem=k; } else { giftSelItem=null; } }; }); }
/* 问题1修复：确认送出后先 remove gift overlay DOM，再 interactSay，避免对话被重绘清掉 */
function confirmGift(){ const key=giftOpenKey; if(!key||!giftSelItem) return; if(giftCooldownLeft(key)>0) return; const it=giftSelItem; const lv=itemLoveLevel(key,it); const L=(ITEM_LOVE[key]||{}); let delta=0, talk=''; if(lv===0){ /* === giftValue 物品（如 amethyst）优先使用 giftValue === */ const gv = (ITEMS[it]&&ITEMS[it].giftValue) || 0; if(gv>0){ delta=gv; talk='（物品自带赠礼价值）'; } else { delta=-1; talk=GIFT_TALK[key].lv0; } } else if(lv===1){ delta=1; talk=GIFT_TALK[key].lv1; } else if(lv===2){ delta=L.two[it]; talk=GIFT_TALK[key].lv2; } else { delta=(L.three[it]||0)+5; talk=(GIFT_TALK[key]['lv3_'+it])||''; } G.inventory[it]--; G.records=G.records||{}; if(!G.records.giftDay) G.records.giftDay={}; G.records.giftDay[key]=G.day||1;
  // 先移除 DOM 里的送礼面板（避免重绘交互区时把刚要写入的对话清掉）
  const overlay=document.getElementById('giftOverlay'); if(overlay && overlay.parentNode){ overlay.parentNode.removeChild(overlay); }
  giftOpenKey=null; giftSelItem=null;
  if(delta!==0) gainAffinity(key,delta); refreshHUD(); interactSay(key, `${talk} <span class="lvlup">好感度${delta>0?'+'+delta:delta}</span>`); }
/* 问题1修复：关闭送礼面板也先移除 DOM，避免重绘清掉对话 */
function closeGift(){ if(giftOpenKey==null) return; const overlay=document.getElementById('giftOverlay'); if(overlay && overlay.parentNode){ overlay.parentNode.removeChild(overlay); } giftOpenKey=null; giftSelItem=null; }
function charBondTab(key,c){ c=c||getChar(key); if(key==='pro') return '<p>主角没有羁绊等级。</p>'; const bt=(BOND_TEXT[key])||{}; let rows=''; for(let lv=0; lv<=10; lv++){ const note=bt[lv]||''; const cur=getBond(key).level===lv? '（当前）':''; rows+=`<div class="bondrow ${getBond(key).level===lv?'cur':''}"><span class="bondlv">羁绊 ${lv} 级${cur}</span><span class="bondnote">${note}</span></div>`; } return `<div class="bondrows">${rows}</div><p style="margin-top:10px;font-size:13px;color:#9aa0ac">基础效果：羁绊每升 1 级，攻击力 +10；标注有等级的技能的等级对应提升。好感度每累计 10 点提升 1 级，羁绊等级只升不降。当前好感度 <b class="lvlup">${getBond(key).affinity}</b>（上限 999，下限 -999）。</p>`; }
function charStoryTab(key,c){ c=c||getChar(key); if(key==='pro') return '<p>属于你的故事，才刚刚开始……</p>'; return `<p>关于 <b>${c.name}</b> 的故事，正在撰写中，敬请期待。</p>`; }
let skillPickSel={};
function openFormation(){ if(combatState||eventState){ log('事件中无法使用该功能。'); return; } renderFormation(); }
function eligibleSwapChars(){ const keys=['pro']; for(const k in ALLIES){ if(bondLevel(k)>=1) keys.push(k); } return keys; }
let swapOpen=false, swapJustOpened=false; let swapTeam=[];
function openSwap(){ swapTeam=G.team.slice(); swapOpen=true; swapJustOpened=true; renderFormation(); }
function toggleSwapChar(k){ const idx=swapTeam.indexOf(k); if(idx>=0){ swapTeam.splice(idx,1); } else { if(swapTeam.length>=3){ log('队伍最多 3 人。'); return; } if(!eligibleSwapChars().includes(k)){ log('该角色羁绊等级不足，暂不可加入编队。'); return; } swapTeam.push(k); } renderFormation(); }
function applySwap(){ if(!swapTeam.includes('pro') || swapTeam.length<1){ swapOpen=false; swapJustOpened=false; renderFormation(); log('新的队伍不合规则（必须包含主角且至少 1 人），本次换人未生效。'); return; } G.team=swapTeam.slice(); swapOpen=false; swapJustOpened=false; renderFormation(); }
function renderSwapPanel(){ const cells=eligibleSwapChars().map(k=>{ const c=getChar(k); const idx=swapTeam.indexOf(k); const inTeam=idx>=0; const sub=k==='pro'? '' : `<div class="selem">${c.element?ELEM[c.element].zh:'无'}</div><div class="sbond">羁绊 ${bondLevel(k)}</div>`; const badge=inTeam?`<div class="snum">${idx+1}</div>`:''; return `<div class="schar ${inTeam?'in':''}" onclick="toggleSwapChar('${k}')">${badge}<div class="sname">${c.name}</div>${sub}</div>`; }).join(''); return `<div class="swap-overlay"><div class="swap-head">选择上场的同伴（点击切换，主角可暂离队，退出时若不合规则则还原）</div><div class="swap-grid">${cells}</div><div class="swap-foot"><button class="mbtn small" onclick="applySwap()">确认</button></div></div>`; }
function renderFormation(){ const slots=['1','2','3']; const teamView = swapOpen? swapTeam : G.team; const cols=slots.map((label,i)=>{ const k=teamView[i]; if(!k) return `<div class="fcol"><div class="fcol-head">${label}号位</div><div class="fcol-empty">空缺</div><button class="mbtn small" onclick="openSwap()">替换</button></div>`; const c=getChar(k); const ele=k==='pro'?'无属性':ELEM[c.element].zh; const skills=c.skills.filter(s=>c.selectedSkillIds.includes(s.id)).map(s=>`<span class="fskill ${s.kind==='attack'?'attack':'support'}">${s.kind==='attack'?'攻击':'辅助'}·${s.name}</span>`).join(''); const tals=c.passives.map((p,ti)=>`<span class="talentTag" data-k="${k}" data-i="${ti}"><span class="cat talent">天赋</span>${p.name}</span>`).join(''); return `<div class="fcol"><div class="fcol-head">${label}号位</div><div class="fcol-name">${c.name}</div><div class="fcol-ele">${ele}</div><div class="fcol-skills">${skills||'<span class="nohint">未携带技能</span>'}</div><div class="fcol-talents">${tals}</div><button class="mbtn small" onclick="openSwap()">替换</button></div>`; }).join(''); openModal('编队', `<div class="form-head"><span class="form-title">当前编队</span><button class="mbtn small" onclick="openSwap()">快捷编队</button></div><div class="form-wrap"><div class="form-cols">${cols}</div></div>${swapOpen?renderSwapPanel():''}`, 'full', {replace:true}); }
let taskSel='m1';
function afterQuestProgress(){} /* 进度变化钩子：发放改为在任务界面手动领取（claimTask）。 */
function grantTaskReward(rw){ if(rw.key){ const n=rw.n||1; G.inventory[rw.key]=(G.inventory[rw.key]||0)+n; return `${rw.text||itemName(rw.key)}×${n}`; } if(rw.simple){ let m=rw.simple.match(/^金币\+(\d+)$/); if(m){ G.inventory.coin=(G.inventory.coin||0)+ +m[1]; return `金币+${+m[1]}`; } m=rw.simple.match(/^主角防御力\+(\d+)$/); if(m){ G.hero.def=(G.hero.def||0)+ +m[1]; return `主角防御力+${+m[1]}`; } return rw.simple; } return ''; }
window.claimTask=function(id){ const t=TASKS.find(x=>x.id===id); if(!t) return; if(!taskDone(t)){ log('该任务的完成条件尚未达成。'); openTasks(); return; } if(taskDoneMarked(t)){ log('该任务的奖励已领取过。'); openTasks(); return; } G.records=G.records||{}; if(!G.records.questDone||typeof G.records.questDone!=='object') G.records.questDone={}; const parts=[]; for(const rw of (t.rewards||[])){ const s=grantTaskReward(rw); if(s) parts.push(s); } G.records.questDone[t.id]=true; refreshHUD(); if(parts.length){ log(`已手动领取「${t.name}」奖励：${parts.join('、')}。`); } openTasks(); };
function taskGoalText(t,g){ const p=taskProgress(t); if(t.id==='m1'){ if(g.indexOf('健康')>=0) return `${g}（当前 ${G.hero.health}）`; return `${g}（进行中）`; } if(p!=null) return `${g}（${p}/${t.last}）`; return g; }
function renderTasksHTML(){
  const sel = TASKS.find(t=>t.id===taskSel && taskVisible(t)) || TASKS.find(taskVisible) || TASKS[0];
  const doList=cat=>TASKS.filter(t=>t.cat===cat && taskVisible(t)).map(t=>{
    const done=taskDone(t), marked=taskDoneMarked(t);
    const stateTxt = done ? (marked?'已完成':'待领取') : '进行中';
    return `<div class="task-item task-${t.cat} ${t.id===sel.id?'on':''}" onclick="selectTask('${t.id}')"><span class="task-item-name">${t.name}</span><span class="task-item-state ${done?'done':''}">${stateTxt}</span></div>`;
  }).join('');
  const goals=(sel.goals||[]).map(g=>`<div class="task-goal">◆ ${taskGoalText(sel,g)}</div>`).join('');
  const done=taskDone(sel), marked=taskDoneMarked(sel);
  let claimHtml='';
  if(done && !marked){ claimHtml=`<div class="task-claim"><button class="mbtn small" onclick="claimTask('${sel.id}')">领取奖励</button></div>`; }
  else if(done && marked){ claimHtml=`<div class="task-claim done">奖励已领取</div>`; }
  const rewardBlock = (sel.rewards&&sel.rewards.length)? `<div class="task-divider"></div><div class="task-reward"><span class="task-reward-label">任务奖励</span>：<span class="task-reward-list">${sel.rewards.map(taskRewardHTML).join('、')}</span></div>${claimHtml}` : claimHtml;
  return `<div class="task-wrap">
      <div class="task-left">
        <div class="task-cat-title main">主线任务</div>
        ${doList('main')}
        <div class="task-cat-title side">支线任务</div>
        ${doList('side')}
      </div>
      <div class="task-right">
        <div class="task-title task-${sel.cat}">${sel.name}</div>
        <div class="task-goals-box">${goals}</div>
        ${rewardBlock}
      </div>
    </div>`;
}
function openTasks(){ openModal('任务', renderTasksHTML(), 'full', {replace:true}); }
window.selectTask=function(id){ if(id!==taskSel && TASKS.some(t=>t.id===id)){ taskSel=id; openTasks(); } };
let shopQty={}; let shopMsg='';
function openShop(){ if(combatState||eventState){ log('事件中无法使用该功能。'); return; } if(G){ shopMsg=''; renderShop(); } }
function shopSellPrice(it){ return Math.floor(it.buy*0.5); }
function renderShop(){ const list=SHOP_ITEMS.map(it=>{ const have=G.inventory[it.key]||0; const buyPrice=itemBuyPrice(it.key); const buyMax=Math.floor((G.inventory.coin||0)/Math.max(1,buyPrice)); const sellMax = it.sellable? have : 0; const maxN=Math.max(buyMax,sellMax,1); let q=Math.max(1, shopQty[it.key]||1); q=Math.min(q, maxN); shopQty[it.key]=q; const buy=buyPrice; const sell=shopSellPrice(it); const sellBtn = it.sellable ? `<button class="mbtn tiny" onclick="shopTrade('${it.key}','sell')">卖出</button>` : `<span class="nohint">不可出售</span>`; const growNote = it.priceGrow? `<span class="rnote">每获得1个，此物价+${it.priceGrow}</span>` : ''; return `<div class="sitem"><div class="shead"><span class="craftlink" data-key="${it.key}">${itemName(it.key)}</span><span class="sprice">${it.sellable?`买入 <b>${buy}</b> · 卖出 <b>${sell}</b> 金币`:`买入 <b>${buy}</b> 金币（不可出售）`}</span></div><div class="sown">持有 <b>${have}</b> · 金币 <b>${G.inventory.coin}</b></div>${growNote}<div class="rcCtl"><span class="craftQty">×${q}</span><input type="range" class="craftRange" min="1" max="${maxN}" value="${q}" oninput="shopSet('${it.key}',this.value)"><button class="mbtn tiny craftDo" onclick="shopTrade('${it.key}','buy')">购买</button>${sellBtn}</div></div>`; }).join(''); openModal('商店', `<p class="mhint">点击物品可查看说明。购买与卖出共用同一滑块设定数量；卖出价为买入价的一半。</p><div class="shopmsg ${shopMsg?'show':''}">${shopMsg}</div><div class="cwrapper">${list}</div>`, 'full', {replace:true}); }
window.shopSet=function(key,v){ shopQty[key]=Math.max(1,(+v||1)); shopMsg=''; renderShop(); };
window.shopTrade=function(key,act){ const it=SHOP_ITEMS.find(x=>x.key===key); if(!it) return; if(combatState){ log('战斗中无法访问商店。'); return; } const q=Math.max(1,shopQty[key]||1); if(act==='buy'){ const price=itemBuyPrice(key); const cost=price*q; if(G.inventory.coin<cost){ shopMsg='金币不足，无法完成该笔购买。'; refreshHUD(); renderShop(); return; } G.inventory.coin-=cost; if(it.permanent){ for(let i=0;i<q;i++) grantPermanentItem(key); } else { G.inventory[key]=(G.inventory[key]||0)+q; } shopMsg=`已购买 <b>${itemName(key)} ×${q}</b>，花费 <b>${cost}</b> 金币。`; } else { if(!it.sellable){ shopMsg='该物品不可出售。'; refreshHUD(); renderShop(); return; } const sell=shopSellPrice(it), gain=sell*q; if((G.inventory[key]||0)<q){ shopMsg='你要卖出的数量超出当前持有。'; refreshHUD(); renderShop(); return; } G.inventory[key]-=q; G.inventory.coin+=gain; shopMsg=`已卖出 <b>${itemName(key)} ×${q}</b>，获得 <b>${gain}</b> 金币。`; } log(shopMsg.replace(/<[^>]+>/g,'')); refreshHUD(); renderShop(); };
let mapDragMoved=false;
(function initMapViewport(){ const vp=$('#mapViewport'); const grid=$('#mapGrid'); let scale=1; vp.addEventListener('wheel', e=>{ e.preventDefault(); scale=Math.min(2, Math.max(0.5, scale + (e.deltaY>0?-0.12:0.12))); grid.style.transform=`scale(${scale})`; }, {passive:false}); let down=false,sx=0,sy=0,sl=0,st=0; vp.addEventListener('mousedown',e=>{ down=true; mapDragMoved=false; sx=e.clientX; sy=e.clientY; sl=vp.scrollLeft; st=vp.scrollTop; vp.classList.add('dragging'); }); document.addEventListener('mousemove',e=>{ if(down){ const dx=e.clientX-sx, dy=e.clientY-sy; if(Math.abs(dx)>5||Math.abs(dy)>5) mapDragMoved=true; vp.scrollLeft=sl-dx; vp.scrollTop=st-dy; } }); document.addEventListener('mouseup',()=>{ down=false; vp.classList.remove('dragging'); }); })();
function openPopoverNear(el, html){ const tip=$('#popover'); tip.innerHTML=html; tip.style.display='block'; tip.style.visibility='hidden'; const r=el.getBoundingClientRect(); const w=tip.offsetWidth||260, h=tip.offsetHeight||60; tip.style.visibility='visible'; let x=r.left; if(x+w>window.innerWidth-8) x=Math.max(8, window.innerWidth-8-w); let y=r.bottom+6; if(y+h>window.innerHeight-8) y=Math.max(8, r.top-h-6); tip.style.left=x+'px'; tip.style.top=y+'px'; }
document.addEventListener('click',ev=>{ if(giftOpenKey){ if(giftJustOpened){ giftJustOpened=false; } else if(!ev.target.closest('#giftOverlay')){ closeGift(); return; } } if(swapOpen){ if(swapJustOpened){ swapJustOpened=false; } else if(!ev.target.closest('.swap-overlay')){ applySwap(); } } clickActionOnly(ev); });
function clickActionOnly(ev){ const st=ev.target.closest('.stchip'); if(st){ const rounds=st.textContent.match(/·(\d+)回合/); openPopoverNear(st, `<b>${st.dataset.name}</b>${rounds?`（${rounds[1]}回合）`:''}<br>${st.dataset.desc||''}`); return; } const tg=ev.target.closest('.talentTag'); if(tg){ const owner=tg.dataset.k; const c=getChar(owner); const t=c.passives[+tg.dataset.i]; if(t){ const name=t.scal? talentDisplayName(owner,t) : t.name; const desc=t.scal? lvDescText(t, entryLevel(owner,t)) : t.desc; openPopoverNear(tg, `<b>${name}</b><br>${desc}`); } return; } const cl=ev.target.closest('.craftlink'); if(cl){ const key=cl.dataset.key; openPopoverNear(cl, `<b>${itemName(key)}</b><br>${itemDetailHTML(key)}`); return; } $('#popover').style.display='none'; }
document.addEventListener('keydown', ev=>{ if(ev.key!=='Escape') return; ev.preventDefault(); if($('#menuOverlay').classList.contains('show') || $('#gameoverOverlay').classList.contains('show')) return; if($('#modalOverlay').classList.contains('show')){ if(giftOpenKey){ closeGift(); return; } if(swapOpen){ applySwap(); return; } modalBack(); return; } if(G) openSettings(); });