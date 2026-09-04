/* ============================================================
   js/craft.js —— 模块：合成系统
   非战斗时可打开；配方制（禁止自由合成）；每个配方独立「合成」按钮；
   可调节一次合成数量（滑块/加减）；点击配方中的资源/物品可预览说明；
   合成的物品直接加入背包。快捷键 E 打开。
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

/* 各配方当前待合成数量（渲染时按材料上限自动夹紧） */
let craftQty={};

/* 战斗时不可打开合成 */
function openCraft(){
  if(combatState){ log('战斗中无法合成。'); return; }
  if(G) renderCrafting();
}

/* 某个配方当前最多可合成的次数 */
function craftMax(r){
  let m=Infinity;
  for(const k in r.needs){ m=Math.min(m, Math.floor((G.inventory[k]||0)/r.needs[k])); }
  return isFinite(m)? Math.max(0,m) : 0;
}

function renderCrafting(){
  const list=CRAFT_RECIPES.map(r=>{
    const max=craftMax(r);
    let q=craftQty[r.id]||1; q=Math.max(1, Math.min(q, Math.max(1,max)));
    craftQty[r.id]=q;
    const needs=Object.entries(r.needs).map(([k,n])=>{
      const have=G.inventory[k]||0;
      const cls=have>=n?'craftlink':'craftlink noshort';
      return `<span class="${cls}" onclick="craftPreview(this,'${k}')">${itemName(k)} ×${n}</span>`;
    }).join('<span class="plus">&nbsp;＋&nbsp;</span>');
    const outCls='craftlink';
    const ctl = max<=0
      ? `<span class="nohint">（材料不足）</span>`
      : `<button class="mbtn small" onclick="craftStep('${r.id}',-1)">－</button>
         <input type="range" class="craftRange" min="0" max="${max}" value="${q}" oninput="craftSet('${r.id}',this.value)">
         <span class="craftQty">×${q}</span>
         <button class="mbtn small" onclick="craftStep('${r.id}',1)">＋</button>
         <button class="mbtn small craftDo" onclick="doCraft('${r.id}')">合成</button>`;
    return `<div class="recipe">
      <div class="recipeNeeds">${needs}<span class="recipeArrow">→</span><span class="${outCls}" onclick="craftPreview(this,'${r.out}')">${itemName(r.out)} ×${r.outN}</span></div>
      <div class="recipeCtl">${ctl}</div>
    </div>`;
  }).join('');
  openModal('合成',
    `<p class="mhint">选择配方并设定数量后点「合成」（每个配方独立按钮）。点击配方里的资源或物品可查看说明。</p>`+
    `<div class="craftList">${list}</div>`, 'full', {replace:true});
}

function craftStep(id,d){
  const r=CRAFT_RECIPES.find(x=>x.id===id); if(!r) return;
  const max=Math.max(1,craftMax(r));
  let q=(craftQty[id]||1)+d; q=Math.max(1, Math.min(q, max));
  craftQty[id]=q;
  renderCrafting();
}
function craftSet(id,v){ craftQty[id]=Math.max(1, (+v||1)); renderCrafting(); }

/* 点击预览：资源/物品说明（悬浮于元素附近） */
window.craftPreview=function(el,key){ openPopoverNear(el, `<b>${itemName(key)}</b><br>${itemDesc(key)||'（暂无说明）'}`); };

/* 执行合成：校验 → 扣除材料 → 产出 → 加入背包 */
function doCraft(id){
  const r=CRAFT_RECIPES.find(x=>x.id===id); if(!r) return;
  if(combatState){ log('战斗中无法合成。'); return; }
  let q=Math.max(1, craftQty[id]||1);
  for(const k in r.needs){ if((G.inventory[k]||0) < r.needs[k]*q){ log('材料不足，无法合成。'); return; } }
  for(const k in r.needs){ G.inventory[k]-=r.needs[k]*q; }
  G.inventory[r.out]=(G.inventory[r.out]||0)+r.outN*q;
  log(`合成了 <b>${itemName(r.out)} ×${r.outN*q}</b>。`);
  refreshHUD(); renderCrafting();
}

/* 快捷键 E：打开合成（战斗时无效） */
document.addEventListener('keydown', ev=>{
  if(ev.key.toLowerCase()==='e' && !ev.repeat){
    if($('#menuOverlay').classList.contains('show')) return;
    openCraft();
  }
});