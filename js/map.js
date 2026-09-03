/* ============================================================
   js/map.js —— 模块：地图与探索（地图生成）
   每日随机地图：尺寸随天数渐进、保底连通、格子内容填充。
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

/* 生成当天完整地图（障碍 + 内容 + 连通性），起点(0,0)保证空地 */
function generateMap(day){
  const n=mapSizeForDay(day);
  const cells=[];
  for(let i=0;i<n*n;i++) cells.push({terrain:'ground', content:'empty', idx:i});
  const obstacles=Math.floor(n*n*0.12);
  for(let k=0;k<obstacles;k++){
    const i=Math.floor(Math.random()*n*n);
    if(cells[i].idx===0) continue;
    cells[i].terrain='obstacle';
  }
  for(const c of cells){
    if(c.terrain==='obstacle') continue;
    c.content=rollContent(day);
  }
  ensureConnectivity(cells,n);
  const start=cells[0];
  start.content='empty';
  return {n, cells, px:0, py:0};
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