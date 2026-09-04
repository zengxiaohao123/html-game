/* ============================================================
   js/map.js —— 模块：地图与探索（地图生成）
   每日随机地图：尺寸随天数渐进、保底连通、格子内容填充。
   地形：空地=可通行(可能出资源)；山脉/地图外=不可通行。
   有效地图为内区 n×n，其外再包一圈「地图外」(void) 边框。
   ============================================================ */
"use strict";

/* 从对象随机取一个键（用于随机敌人等） */
function randKey(obj){const ks=Object.keys(obj); return ks[Math.floor(Math.random()*ks.length)];}

/* 根据天数决定地图边长（参考值含随机波动） */
function mapSizeForDay(day){
  const ref=[[1,4],[20,6],[50,8],[100,9],[150,12]];
  let n=4;
  for(const [d,s] of ref){ if(day>=d) n=s; }
  const jitter=Math.round((Math.random()-0.5)*2);
  return Math.max(4, n+jitter);
}

/* 生成当天完整地图：内区不规则连通地块 + 障碍 + 内容，主角随机出生；
   内区外围包一圈「地图外」(void) 边框，不影响有效地图生成。 */
function generateMap(day){
  const inner=mapSizeForDay(day);   // 有效可玩尺寸
  const n=inner+2;                  // 总边长：上下左右各多1圈地图外
  const off=1;                      // 内区起点偏移
  const cells=[];
  for(let i=0;i<n*n;i++) cells.push({terrain:'void', content:'empty', idx:i});
  // 1) 在内区用生长法生成不规则可行走地块（空地），约80%面积，减少不可通行
  const blob=generateBlob(inner);
  const groundIdx=[];
  for(let y=0;y<inner;y++)for(let x=0;x<inner;x++)
    if(blob[y*inner+x]){ const ci=(y+off)*n+(x+off); cells[ci].terrain='ground'; groundIdx.push(ci); }
  // 2) 在空地内撒少量山脉障碍
  const obstacles=Math.floor(groundIdx.length*0.08);
  for(let k=0;k<obstacles;k++){
    const i=groundIdx[Math.floor(Math.random()*groundIdx.length)];
    cells[i].terrain='obstacle';
  }
  // 3) 填充内容
  for(const c of cells) if(c.terrain==='ground') c.content=rollContent(day);
  // 4) 保底连通（孤立地块会被缝合到主地块）
  ensureConnectivity(cells,n);
  // 5) 随机挑出生点（该格保证空地，位于内区）
  const groundCells=[];
  for(let y=0;y<inner;y++)for(let x=0;x<inner;x++)
    if(cells[(y+off)*n+(x+off)].terrain==='ground') groundCells.push({x:x+off,y:y+off});
  const start=groundCells[Math.floor(Math.random()*groundCells.length)]||{x:off,y:off};
  cells[start.y*n+start.x].content={type:'empty'};
  return {n, cells, px:start.x, py:start.y};
}

/* 生长法生成不规则地块掩码：从中心随机生长，越靠近边缘越易断。目标面积约80% */
function generateBlob(n){
  const mask=[]; for(let i=0;i<n*n;i++) mask.push(false);
  const cx=(n-1)/2, cy=(n-1)/2;
  const target=Math.max(9, Math.floor(n*n*0.80));
  const baseR=Math.max(2, n*0.42);
  const stack=[[Math.floor(n/2),Math.floor(n/2)]];
  const seen=new Set();
  let count=0;
  while(stack.length && count<target){
    const i=Math.floor(Math.random()*stack.length);
    const [x,y]=stack.splice(i,1)[0];
    const key=x+','+y; if(seen.has(key))continue; seen.add(key);
    if(x<0||y<0||x>=n||y>=n)continue;
    const dist=Math.hypot(x-cx,y-cy);
    const p=Math.max(0, 1-dist/(baseR*1.5)) * (0.8+Math.random()*0.2);
    if(dist<=baseR*0.5 || Math.random()<p){
      mask[y*n+x]=true; count++;
      for(const [a,b] of [[1,0],[-1,0],[0,1],[0,-1]]) stack.push([x+a,y+b]);
    }
  }
  return mask;
}

/* 随机填充一个格子的内容（敌人/宝箱/事件/空地） */
function rollContent(day){
  const r=Math.random();
  if(r<0.20) return {type:'enemy', key:randKey(ENEMIES), id:0};
  if(r<0.32) return {type:'loot', done:false};
  if(r<0.42) return {type:'event', done:false};
  return {type:'empty'};
}

/* 保底：从(0,0)做连通遍历 */
function ensureConnectivity(cells,n){
  const idx=(x,y)=>y*n+x;
  const inb=(x,y)=>x>=0&&y>=0&&x<n&&y<n;
  const ground=[];
  for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(cells[idx(x,y)].terrain==='ground')ground.push([x,y]);
  const visited=new Map(); const stack=[ground[0]];
  if(ground[0]) visited.set(ground[0][0]+','+ground[0][1],1);
  const fwd=[[1,0],[-1,0],[0,1],[0,-1]];
  while(stack.length){
    const [cx,cy]=stack.pop();
    for(const [dx,dy] of fwd){
      const nx=cx+dx, ny=cy+dy;
      if(!inb(nx,ny)) continue;
      const cell=cells[idx(nx,ny)];
      if(cell.terrain!=='ground') continue;
      if(visited.has(nx+','+ny)) continue;
      visited.set(nx+','+ny,1);
      stack.push([nx,ny]);
    }
  }
  markBridge(cells,n,visited);
}

/* 把孤立地块与可达区缝合起来（必要时把中间障碍转为地面） */
function markBridge(cells,n,visited){
  const idx=(x,y)=>y*n+x;
  const inb=(x,y)=>x>=0&&y>=0&&x<n&&y<n;
  const fwd=[[1,0],[-1,0],[0,1],[0,-1]];
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const c=cells[idx(x,y)];
    if(c.terrain!=='ground') continue;
    if(visited.has(x+','+y)) continue;
    for(const [dx,dy] of fwd){
      const nx=x+dx,ny=y+dy;
      if(!inb(nx,ny)) continue;
      if(cells[idx(nx,ny)].terrain==='obstacle'){
        cells[idx(nx,ny)].terrain='ground';
      }else if(visited.has(nx+','+ny)){
        visited.set(x+','+y,1);
        expandVisited(cells,n,x,y,visited);
        break;
      }
    }
  }
}

/* 从某点扩散标记可达地面 */
function expandVisited(cells,n,x,y,visited){
  const idx=(x0,y0)=>y0*n+x0; const inb=(a,b)=>a>=0&&b>=0&&a<n&&b<n;
  const stack=[[x,y]]; visited.set(x+','+y,1);
  const fwd=[[1,0],[-1,0],[0,1],[0,-1]];
  while(stack.length){
    const [cx,cy]=stack.pop();
    for(const [dx,dy] of fwd){
      const nx=cx+dx,ny=cy+dy;
      if(!inb(nx,ny))continue;
      if(cells[idx(nx,ny)].terrain!=='ground')continue;
      if(visited.has(nx+','+ny))continue;
      visited.set(nx+','+ny,1); stack.push([nx,ny]);
    }
  }
}