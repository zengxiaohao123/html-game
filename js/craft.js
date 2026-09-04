/* ============================================================
   js/craft.js —— 模块：合成系统
   非战斗时可打开；左右两列布局；配方制（禁止自由合成）；
   每个配方独立「合成」按钮；可调节一次合成数量（滑块/加减）；
   点击配方中任何资源/物品可预览说明（data-key 交由 ui.js 委托弹窗）。
   快捷键 E 打开。
   ============================================================ */
"use strict";

/* 制作配方：needs={资源:所需数量}，out=产出物 key，outN=单次产出个数 */
const CRAFT_RECIPES = [
  {id:'bandage',  out:'bandage',     outN:1, needs:{flax:2}},
  {id:'jerky',    out:'jerky',       outN:1, needs:{rawMeat:2}},
  {id:'herbpoul', out:'herbpoultice',outN:1, needs:{fruit:1, emptyBottle:1}},
  {id:'campkit',  out:'campkit',     outN:1, needs:{wood:3}},
  {id:'jerrycan', out:'jerrycan',    outN:1, needs:{wood:2, fruit:1, flax:1}},
];

/* 各配方当前待合成数量 */
let craftQty={};

function openCraft(){
  if(combatState){ log('战斗中无法使用该功能。'); return; }
  if(G) renderCrafting();
}

function craftMax(r){
  let m=Infinity;
  for(const k in r.needs){ m=Math.min(m, Math.floor((G.inventory[k]||0)/r.needs[k])); }
  return isFinite(m)? Math.max(0,m) : 0;
}

/* 渲染单个配方卡片 */
function craftRecipeHTML(r){
  const max=craftMax(r);
  let q=craftQty[r.id]||1; q=Math.max(1, Math.min(q, Math.max(1,max)));
  craftQty[r.id]=q;
  const needs=Object.entries(r.needs).map(([k,n])=>{
    const have=G.inventory[k]||0;
    const cls=have>=n?'craftlink':'craftlink noshort';
    const short=have>=n?'':`&nbsp;<span class=\"noshort\">(缺${n-have})</span>`;
    return `<span class="${cls}" data-key="${k}">${itemName(k)} ×${n}</span>${short}`;
  }).join('<span class="plus">＋</span>');
  const ctl = max<=0
    ? `<span class="nohint">材料不足</span>`
    : `<div class="rcCtl">
        <button class="mbtn tiny" onclick="craftStep('${r.id}',-1)">−</button>
        <input type="range" class="craftRange" min="0" max="${max}" value="${q}" oninput="craftSet('${r.id}',this.value)">
        <span class="craftQty">×${q}</span>
        <button class="mbtn tiny" onclick="craftStep('${r.id}',1)">＋</button>
        <button class="mbtn tiny craftDo" onclick="doCraft('${r.id}')">合成</button>
      </div>`;
  return `<div class="recipe">
    <div class="rcNeeds">${needs} <span class="recipeArrow">→</span> <span class="craftlink" data-key="${r.out}">${itemName(r.out)} ×${r.outN}</span></div>
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
  let q=Math.max(1, craftQty[id]||1);
  for(const k in r.needs){ if((G.inventory[k]||0) < r.needs[k]*q){ log('材料不足，无法合成。'); return; } }
  for(const k in r.needs){ G.inventory[k]-=r.needs[k]*q; }
  G.inventory[r.out]=(G.inventory[r.out]||0)+r.outN*q;
  log(`合成了 <b>${itemName(r.out)} ×${r.outN*q}</b>。`);
  refreshHUD(); renderCrafting();
}

document.addEventListener('keydown', ev=>{
  if(ev.key.toLowerCase()==='e' && !ev.repeat){
    if($('#menuOverlay').classList.contains('show')) return;
    openCraft();
  }
});