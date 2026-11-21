// src/core/PathGraph.js
// 「小径」连通判定（纯函数，无状态、无事件、无副作用）
//
// 《设计文档 v0.6》§9.6 规则：
//   1. 一条连通小径 = 一串 4 邻接的小径格，两端各邻接一个外圈地块（起点/终点）。
//      起点/终点本身不要求地形是小径——只要它是外圈地块。
//   2. 节点 = 地形为小径的栅栏格 + 地形为小径的外圈格（外圈格只参与连通，不产生效果）。
//   3. 一个连通块至少邻接 2 个「不同的」外圈地块 → 该块内所有栅栏小径格生效。
//   4. 斜角不算连通；外圈环上的相邻关系不作为边（只在小径地形之间连边）。
//
// 输出：{ effectiveFence:Set<fenceIdx>, components:[...], effectiveCount }
// effectiveCount 只统计栅栏内生效格（容量 / 传送用）。

import { normalizeTerrain } from '../data/terrains.js';
import { fenceDimsOf, mapDimsOf, outerIdxToXY, outerXYToIdx, outerRingCount } from './Distance.js';

const PATH = 'terrain_path';
const DIRS = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
];

function pathFenceCells(gs) {
  const dims = fenceDimsOf(gs);
  const out = [];
  const list = gs?.map?.fence || [];
  for (let r = 0; r < dims.rows; r++) {
    for (let c = 0; c < dims.cols; c++) {
      const cell = list[r * dims.cols + c];
      if (cell && normalizeTerrain(cell.terrain) === PATH) {
        out.push({ row: r, col: c, idx: r * dims.cols + c });
      }
    }
  }
  return out;
}

function pathOuterCells(gs) {
  const dims = mapDimsOf(gs);
  const total = outerRingCount(dims.rows, dims.cols);
  const out = [];
  for (let idx = 0; idx < total; idx++) {
    const tile = gs?.map?.outerTiles?.[idx];
    if (tile && normalizeTerrain(tile.terrain) === PATH) {
      const { x, y } = outerIdxToXY(dims, idx);
      out.push({ idx, x, y });
    }
  }
  return out;
}

/**
 * @param {object} gs
 * @returns {{
 *   effectiveFence: Set<number>,
 *   effectiveCount: number,
 *   components: Array<{ fenceIdx:number[], outerTerminals:Array<{x:number,y:number}>, effective:boolean }>
 * }}
 */
export function computePathComponents(gs) {
  const dims = mapDimsOf(gs);
  const fDims = fenceDimsOf(gs);
  const nodeKey = (kind, a, b) => (kind === 'f' ? `f:${a},${b}` : `o:${a},${b}`);
  const nodes = new Map(); // key -> { kind, row?, col?, idx?, x?, y? }

  for (const f of pathFenceCells(gs)) {
    nodes.set(nodeKey('f', f.row, f.col), { kind: 'f', ...f });
  }
  for (const o of pathOuterCells(gs)) {
    nodes.set(nodeKey('o', o.x, o.y), { kind: 'o', ...o });
  }

  const parent = new Map();
  for (const key of nodes.keys()) parent.set(key, key);
  const find = (key) => {
    let k = key;
    while (parent.get(k) !== k) {
      parent.set(k, parent.get(parent.get(k)));
      k = parent.get(k);
    }
    return k;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  // 4 邻接连边（只在小径节点之间）
  for (const [key, node] of nodes) {
    const x = node.kind === 'f' ? node.col + 1 : node.x;
    const y = node.kind === 'f' ? node.row + 1 : node.y;
    for (const d of DIRS) {
      const nx = x + d.dx;
      const ny = y + d.dy;
      if (nx < 0 || ny < 0 || nx >= dims.cols || ny >= dims.rows) continue;
      let nkey = null;
      const fr = ny - 1;
      const fc = nx - 1;
      if (fr >= 0 && fr < fDims.rows && fc >= 0 && fc < fDims.cols) {
        nkey = nodeKey('f', fr, fc);
      } else {
        const oi = outerXYToIdx(dims, nx, ny);
        if (oi !== null) nkey = nodeKey('o', nx, ny);
      }
      if (nkey && nodes.has(nkey)) union(key, nkey);
    }
  }

  const grouping = new Map();
  for (const [key, node] of nodes) {
    const root = find(key);
    if (!grouping.has(root)) grouping.set(root, { fenceIdx: [], outerTerminals: [] });
    if (node.kind === 'f') grouping.get(root).fenceIdx.push(node.idx);
  }

  // 统计每个连通块邻接到的「不同外圈地块」
  for (const [key, node] of nodes) {
    const root = find(key);
    const bucket = grouping.get(root);
    const seen = (bucket._terminalKeys || (bucket._terminalKeys = new Set()));
    if (node.kind === 'o') {
      // 外圈小径格自身就是一个端点
      const tk = `${node.x},${node.y}`;
      if (!seen.has(tk)) {
        seen.add(tk);
        bucket.outerTerminals.push({ x: node.x, y: node.y });
      }
      continue;
    }
    // 栅栏小径格：4 邻接里的外圈格都是端点
    const x = node.col + 1;
    const y = node.row + 1;
    for (const d of DIRS) {
      const nx = x + d.dx;
      const ny = y + d.dy;
      const oi = outerXYToIdx(dims, nx, ny);
      if (oi === null) continue;
      const tk = `${nx},${ny}`;
      if (!seen.has(tk)) {
        seen.add(tk);
        bucket.outerTerminals.push({ x: nx, y: ny });
      }
    }
  }

  const effectiveFence = new Set();
  const components = [];
  for (const bucket of grouping.values()) {
    const terminals = bucket.outerTerminals;
    const eligible = terminals.length >= 2;
    if (eligible) bucket.fenceIdx.forEach((i) => effectiveFence.add(i));
    components.push({
      fenceIdx: bucket.fenceIdx,
      outerTerminals: terminals,
      effective: eligible,
    });
    delete bucket._terminalKeys;
  }

  return { effectiveFence, effectiveCount: effectiveFence.size, components };
}

export default computePathComponents;
