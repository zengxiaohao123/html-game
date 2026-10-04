/* ============================================================
   js/map.js —— 模块：地图生成（每日全新）
   
   新机制：
   · 地图固定为 3×3 回字形（方案 A），只有最外一圈 8 格可通行
   · 中心 1 格 + 地图最外圈 1 格 均为 void（不可进入、不可附着）
   · 每一格都可能允许实体进入；允许的格上可以叠放任意数量的实体
   · 地形、地块内容每日重新生成
   · 地图大小固定，不会因为天数变化（除非道具/剧情）

   数据结构：
     Cell = {
       x, y,                          // 坐标
       terrain,                       // 'ground' | 'void'  (地形效果以后重做)
       passable: true|false,          // 是否允许实体进入
       content: { type, done?, ... }  // 地块内容（探索时显示）
       attach: null | 'fire'|...     // 元素附着（战斗结束保留）
       entities: []                   // 叠放在此格上的所有实体 id（支持多实体）
     }

   对外暴露：generateMap(day, opts?) -> { n, cells, ring, px, py, terrain[][] }
   ============================================================ */
"use strict";

/** 基础配置 */
const MAP_BASE_SIZE = 5;  // 3×3 回字 = 5×5 带 void 边框（void 边框 1 格 + 外圈 3×3 + 中心 1）
// 实际上我们就直接生成 5×5 网格，外圈一圈 void，次外圈一圈可通行（8 格），中心 1 格 void

/**
 * 生成一日的新地图
 * @param {number} day  第几天（影响地块内容概率等）
 * @param {object} [opts] 可选覆盖 { size, extraInner: true } — 复杂剧情下可能内部加地块
 */
function generateMap(day, opts = {}){
  const S = opts.size || MAP_BASE_SIZE;
  const n = S;
  const cells = [];

  // --- 1. 构建 5×5 网格 ---
  for(let y = 0; y < n; y++){
    for(let x = 0; x < n; x++){
      const isOuter = (x === 0 || y === 0 || x === n-1 || y === n-1);
      const isCenter = (x === Math.floor(n/2) && y === Math.floor(n/2));
      let terrain, passable;
      if(isOuter || isCenter){
        terrain = 'void';
        passable = false;
      } else {
        terrain = 'ground';
        passable = true;
      }
      cells.push({
        x, y, terrain, passable,
        content: null,       // 下面统一初始化
        attach: null,
        entities: [],
      });
    }
  }

  // --- 2. 取所有可通行格（即"回"字那一圈）---
  const ringCells = cells.filter(c => c.passable);

  // --- 3. 为每一格随机分配 content ---
  for(const c of ringCells){
    c.content = rollContent(day);
  }

  // --- 4. 主角出生点：随机挑一格，把它强制改为 empty（避免一出生就踩雷）---
  const startIdx = Math.floor(Math.random() * ringCells.length);
  const startCell = ringCells[startIdx];
  startCell.content = { type: 'empty' };

  return {
    n,
    cells,
    size: n,
    px: startCell.x,
    py: startCell.y,
    // 保留旧接口别名
    ring: ringCells.map(c => ({ x: c.x, y: c.y })),
    terrain: cells.map(c => c.terrain),
  };
}

/**
 * 随机一个地块内容（按概率）
 * 概率后续可调；当前：battle 40% / event 35% / loot 15% / reward 5% / emergency 5%
 */
function rollContent(day){
  const r = Math.random();
  if(r < 0.40) return { type: 'battle',    sub: 'normal', done: false };
  if(r < 0.55) return { type: 'emergency', sub: 'hard',   done: false };
  if(r < 0.75) return { type: 'event',     done: false };
  if(r < 0.90) return { type: 'loot',      done: false };
  if(r < 0.95) return { type: 'reward',    sub: 'boss',   done: false };
  return { type: 'empty' };
}

/** 取 cell 辅助（避免到处写 y*n+x）*/
function cellAt(map, x, y){
  if(!map) return null;
  if(x < 0 || y < 0 || x >= map.n || y >= map.n) return null;
  return map.cells[y * map.n + x];
}

/** 判断一个格是否可进入（passable + 非 void）*/
function isEnterable(map, x, y){
  const c = cellAt(map, x, y);
  return c && c.passable === true;
}

/** 判断一个格是否在回字圈上 */
function isOnRing(map, x, y){
  const c = cellAt(map, x, y);
  return c && c.terrain === 'ground';
}

window.GenerateMap = { generateMap, rollContent, cellAt, isEnterable, isOnRing };
