/* ============================================================
   js/map.js —— 模块：地图与探索（地图生成）
   每日随机地图：边长随天数渐进（并加大每日随机波动）、保底连通。
   内部每个有效格子独立按概率分配内容：
     空地30% / 事件25% / 战斗30% / 奖励10% / 山5%（山=障碍，不可通行）。
   有效地图为内区 n×n，其外再包一圈「地图外」(void) 边框。
   ============================================================ */
"use strict";

function mapSizeForDay(day){
  const ref=[[1,4],[20,6],[50,8],[100,9],[150,12]];
  let n=4;
  for(const [d,s] of ref){ if(day>=d) n=s; }
  const jitter=Math.round((Math.random()-0.5)*4);
  return Math.max(4, n+jitter);
}

function generateMap(day){
  const inner=mapSizeForDay(day);
  const n=inner+2; const off=1;
  const cells=[];
  for(let i=0;i<n*n;i++) cells.push({terrain:'void', content:'empty', idx:i});
  for(let y=0;y<inner;y++)for(let x=0;x<inner;x++){ const ci=(y+off)*n+(x+off); cells[ci]=rollCell(day); cells[ci].idx=ci;
    if(cells[ci].content&&cells[ci].content.type==='battle' && isRareEnemy(cells[ci].content.key)){ cells[ci].content.rare=true; }
  }
  ensureConnectivity(cells,n);
  let start=null; const allGround=[];
  for(let y=off;y<off+inner;y++)for(let x=off;x<off+inner;x++){ if(cells[y*n+x].terrain==='ground') allGround.push({x,y}); }
  if(allGround.length){ start=allGround[Math.floor(Math.random()*allGround.length)]; cells[start.y*n+start.x]={terrain:'ground', content:{type:'empty'}, idx:start.y*n+start.x}; }
  else start={x:off,y:off};
  return {n, cells, px:start.x, py:start.y};
}

function rollCell(day){
  const r=Math.random();
  if(r<0.05) return {terrain:'obstacle', content:'empty'};
  if(r<0.35){ const ev=rollCombatEvent(day); return {terrain:'ground', content:{type:'battle', sub:ev.sub, key:ev.key, done:false}}; }
  if(r<0.45) return {terrain:'ground', content:{type:'loot', done:false}};
  if(r<0.70) return {terrain:'ground', content:{type:'event', done:false}};
  return {terrain:'ground', content:{type:'empty'}};
}

function ensureConnectivity(cells,n){
  const idx=(x,y)=>y*n+x; const inb=(x,y)=>x>=0&&y>=0&&x<n&&y<n;
  const ground=[]; for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(cells[idx(x,y)].terrain==='ground')ground.push([x,y]);
  const visited=new Map(); const stack=[ground[0]];
  if(ground[0]) visited.set(ground[0][0]+','+ground[0][1],1);
  const fwd=[[1,0],[-1,0],[0,1],[0,-1]];
  while(stack.length){ const [cx,cy]=stack.pop(); for(const [dx,dy] of fwd){ const nx=cx+dx,ny=cy+dy; if(!inb(nx,ny))continue; const cell=cells[idx(nx,ny)]; if(cell.terrain!=='ground')continue; if(visited.has(nx+','+ny))continue; visited.set(nx+','+ny,1); stack.push([nx,ny]); } }
  markBridge(cells,n,visited);
}
function markBridge(cells,n,visited){
  const idx=(x,y)=>y*n+x; const inb=(x,y)=>x>=0&&y>=0&&x<n&&y<n;
  const fwd=[[1,0],[-1,0],[0,1],[0,-1]];
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){ const c=cells[idx(x,y)]; if(c.terrain!=='ground')continue; if(visited.has(x+','+y))continue; for(const [dx,dy] of fwd){ const nx=x+dx,ny=y+dy; if(!inb(nx,ny))continue; if(cells[idx(nx,ny)].terrain==='obstacle'){ cells[idx(nx,ny)].terrain='ground'; }else if(visited.has(nx+','+ny)){ visited.set(x+','+y,1); expandVisited(cells,n,x,y,visited); break; } } }
}
function expandVisited(cells,n,x,y,visited){
  const idx=(x0,y0)=>y0*n+x0; const inb=(a,b)=>a>=0&&b>=0&&a<n&&b<n;
  const stack=[[x,y]]; visited.set(x+','+y,1); const fwd=[[1,0],[-1,0],[0,1],[0,-1]];
  while(stack.length){ const [cx,cy]=stack.pop(); for(const [dx,dy] of fwd){ const nx=cx+dx,ny=cy+dy; if(!inb(nx,ny))continue; if(cells[idx(nx,ny)].terrain!=='ground')continue; if(visited.has(nx+','+ny))continue; visited.set(nx+','+ny,1); stack.push([nx,ny]); } }
}
