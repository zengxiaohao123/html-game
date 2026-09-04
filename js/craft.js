/* ============================================================
   js/craft.js —— 模块：合成系统
   非战斗时可打开；左右两列布局；配方制（禁止自由合成）；
   每个配方独立「合成」按钮；可调节一次合成数量（滑块/加减）；
   点击配方中任何资源/物品可预览说明（data-key 交由 ui.js 委托弹窗）。
   快捷键 E 打开。
   ============================================================ */
"use strict";

/* 制作配方：
   needs=基础耗材；scale=每合成1个后各耗材的额外递增（仅永久物品有，可无限合成；
   即使一次合成多个也按逐个递增计该笔总消耗）；max=全局至多可合成数（篝火=1）。
   熟肉为非永久消耗品，无递增、无上限。 */
const CRAFT_RECIPES = [
  {id:'cookedMeat', out:'cookedMeat', outN:1, needs:{wood:1, rawMeat:1}},
  {id:'campfire',   out:'campfire',   outN:1, needs:{wood:4}, max:1},
  {id:'club',       out:'club',       outN:1, needs:{wood:6},   scale:{wood:2}},
  {id:'cloth',      out:'cloth',      outN:1, needs:{flax:8},   scale:{flax:2}},
  {id:'tent',       out:'tent',       outN:1, needs:{wood:4, flax:6}, scale:{wood:1, flax:1}},
  {id:'trap',       out:'trap',       outN:1, needs:{wood:4},   scale:{wood:2}},
  {id:'quilt',      out:'quilt',      outN:1, needs:{flax:6},   scale:{flax:2}},
  {id:'ironSword',  out:'ironSword',  outN:1, needs:{iron:10},  scale:{iron:2}},
  {id:'armor',      out:'armor',      outN:1, needs:{iron:14},  scale:{iron:3}},
];

/* 各配方当前待合成数量 */
let craftQty={};

function openCraft(){
  if(combatState){ log('战斗中无法使用该功能。'); return; }
  if(G) renderCrafting();
}

/* 合成下一个1件的单项耗材（当前已拥有 out 数量 c） */
function recipeNextNeed(r){
  const c=G.inventory[r.out]||0;
  const need={};
  for(const k in r.needs){ need[k]=r.needs[k] + ((r.scale&&r.scale[k])? r.scale[k]*c : 0); }
  return need;
}

/* 一次合成 q 件的总耗材：第 i 件（在已合成 c 件之后）耗 base + scale*(c+i) */
function recipeNeedTotal(r, q, c){
  const need={};
  for(const k in r.needs){
    let total=0;
    for(let i=0;i<q;i++){ total += r.needs[k] + ((r.scale&&r.scale[k])? r.scale[k]*(c+i) : 0); }
    need[k]=total;
  }
  return need;
}

/* 当前最多还能合成几件（若 fill 传 true，则返回恰好耗尽材料件数的上限） */
function craftMax(r){
  const c=G.inventory[r.out]||0;
  if(r.max && c>=r.max) return 0;            // 已到全局上限
  const qCap = r.max? (r.max-c) : 99;        // 件数上限（篝火=1，其余至多99）
  let q=1;
  for(;q<=qCap;q++){
    const need=recipeNeedTotal(r,q,c);
    for(const k in need){ if((G.inventory[k]||0) < need[k]) return q-1; }
  }
  return qCap;
}

/* 渲染单个配方卡片 */
function craftRecipeHTML(r){
  const max=Math.max(0,craftMax(r));
  let q=craftQty[r.id]||1; q=Math.max(1, Math.min(q, Math.max(1,max)));
  craftQty[r.id]=q;
  const next=recipeNextNeed(r);
  const needs=Object.entries(next).map(([k,n])=>{
    const have=G.inventory[k]||0;
    const deficient=have<n;
    return `<span class="craftlink ${deficient?'noshort':''}" data-key="${k}">${itemName(k)} ×${n}</span>${deficient?`&nbsp;<span class="noshort">(缺${n-have})</span>`:''}`;
  }).join('<span class="plus">＋</span>');
  const note=(r.scale?`<div class="rnote">每合成一个：${Object.entries(r.scale).map(([k,v])=>`${itemName(k)}+${v}`).join('，')}</div>`:'')
    +(r.max?`<div class="rnote">全局至多${r.max}个</div>`:'');
  const reachedLimit = r.max && (G.inventory[r.out]||0)>=r.max;
  const ctl = max<=0
    ? `<span class="nohint">${reachedLimit?`已达上限（至多${r.max}个）`:'材料不足'}</span>`
    : `<div class="rcCtl">
        <button class="mbtn tiny" onclick="craftStep('${r.id}',-1)">−</button>
        <input type="range" class="craftRange" min="0" max="${max}" value="${q}" oninput="craftSet('${r.id}',this.value)">
        <span class="craftQty">×${q}</span>
        <button class="mbtn tiny" onclick="craftStep('${r.id}',1)">＋</button>
        <button class="mbtn tiny craftDo" onclick="doCraft('${r.id}')">合成</button>
      </div>`;
  return `<div class="recipe">
    <div class="rcNeeds">${needs} <span class="recipeArrow">→</span> <span class="craftlink" data-key="${r.out}">${itemName(r.out)} ×${r.outN}</span></div>
    ${note}
    ${ctl}
  </div>`;
}

function renderCrafting(){
  const list=CRAFT_RECIPES.map(r=>craftRecipeHTML(r)).join('');
  openModal('合成',
    `<p class="mhint">点击配方中的资源或物品可查看说明。每个配方独立「合成」按钮。</p><div class="cwrapper craft">${list}</div>`,
    'full', {replace:true});
}

function craftStep(id,d){
  const r=CRAFT_RECIPES.find(x=>x.id===id); if(!r) return;
  const max=Math.max(1,craftMax(r));
  let q=(craftQty[id]||1)+d; q=Math.max(1, Math.min(q, max));
  craftQty[id]=q; renderCrafting();
}
function craftSet(id,v){ craftQty[id]=Math.max(1, (+v||1)); renderCrafting(); }

function doCraft(id){
  const r=CRAFT_RECIPES.find(x=>x.id===id); if(!r) return;
  if(combatState){ log('战斗中无法使用该功能。'); return; }
  const c=G.inventory[r.out]||0;
  const max=craftMax(r);
  let q=Math.max(1, craftQty[id]||1);
  q=Math.min(q, max, r.max? r.max-c : 99);
  if(q<=0){ log('已达到该物品的可合成数量上限。'); return; }
  const need=recipeNeedTotal(r,q,c);
  for(const k in need){ if((G.inventory[k]||0) < need[k]){ log('材料不足，无法合成。'); return; } }
  for(const k in need){ G.inventory[k]-=need[k]; }
  if(ITEMS[r.out] && ITEMS[r.out].permanent){
    // 永久物品：逐件生效（每件递增耗材、效果叠加、不可消耗）
    for(let i=0;i<q;i++) grantPermanentItem(r.out);
  } else {
    G.inventory[r.out]=(G.inventory[r.out]||0)+r.outN*q;
  }
  craftQty[id]=Math.max(1, craftMax(r)) || 1;
  log(`合成了 <b>${itemName(r.out)} ×${r.outN*q}</b>。`);
  refreshHUD(); renderCrafting();
}

document.addEventListener('keydown', ev=>{
  if(ev.key.toLowerCase()==='e' && !ev.repeat){
    if($('#menuOverlay').classList.contains('show')) return;
    openCraft();
  }
});
