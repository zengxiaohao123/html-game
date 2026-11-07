// src/ui/FenceTerrainDrop.js
// 地形拖拽到栅栏内（§4：地形可作用于栅栏内任意格子）。
// 设施 / 资源 / 技能仍只允许外圈，因此这里只接管 terrain_ 前缀：
// 在 MapView 容器的捕获阶段命中 .fence-tile 才拦截，其余一律交回 MapView 原逻辑。
//
// 之所以单独成模块而不是改 MapView：MapView 的 drop 处理只认同外圈坐标，
// 栅栏内坐标会被直接拒绝；本模块在不改动其逻辑的前提下补一条栅栏地形通道。

import { BuildSystem } from '../systems/BuildSystem.js';

export function mountFenceTerrainDrop(mapView) {
  const root = mapView?.root;
  const host = root?.parentNode;
  if (!host || host.__fenceTerrainDropBound) return;
  host.__fenceTerrainDropBound = true;

  /** 命中栅栏格 → { row, col } */
  const cellFromEvent = (e) => {
    const el = e.target?.closest?.('.fence-tile');
    if (!el || !root.contains(el)) return null;
    const row = Number(el.dataset.fenceRow);
    const col = Number(el.dataset.fenceCol);
    if (!Number.isInteger(row) || !Number.isInteger(col)) return null;
    return { row, col };
  };

  host.addEventListener('drop', (e) => {
    const contentId = e.dataTransfer?.getData('text/plain');
    if (!contentId || !contentId.startsWith('terrain_')) return;
    const cell = cellFromEvent(e);
    if (!cell) return; // 外圈：交回 MapView 的常规放置逻辑
    const gs = mapView.gs;
    if (!gs) return;

    e.preventDefault();
    e.stopPropagation(); // 阻止 MapView 弹出「只能放在外圈地块上」
    const result = BuildSystem.placeFenceTerrain(gs, cell.row, cell.col, contentId);
    // 栅栏背景层与地块背景层同源，放置成功后局部重绘栅栏容器
    if (result.ok) mapView.renderFence(gs);
  }, true);
}

export default mountFenceTerrainDrop;
