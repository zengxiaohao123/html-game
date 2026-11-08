// src/ui/MineView.js
// 场上实体【土豆地雷】的渲染层（与 CreatureView 同为逐帧绘制，节点缓存）
//   · 未探出：半透明泥土色小圆（虚线边，表示「埋在栅栏里」）
//   · 已探出：💣 图标（可被敌人踩爆）
// zIndex 低于生物层（18），保证生物踩雷时压在雷上方。

import { createEl } from './dom.js';

export class MineView {
  constructor(layer) {
    this.layer = layer;
    /** @type {Map<string, {root: HTMLElement, inner: HTMLElement, state: string}>} */
    this.nodes = new Map();
  }

  paint(gs, tileSize) {
    const mines = Array.isArray(gs?.mines) ? gs.mines : [];
    const alive = new Set();

    for (const m of mines) {
      if (!m || !m.id) continue;
      alive.add(m.id);
      let node = this.nodes.get(m.id);
      if (!node) {
        const root = createEl('div', {
          style: {
            position: 'absolute',
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          },
          parent: this.layer,
        });
        const inner = createEl('div', {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxSizing: 'border-box',
          },
          parent: root,
        });
        node = { root, inner, state: '' };
        this.nodes.set(m.id, node);
      }

      const d = Math.max(8, (m.radius || 0.35) * 2 * tileSize);
      node.root.style.width = `${d}px`;
      node.root.style.height = `${d}px`;
      node.root.style.left = `${((m.x || 0) - (m.radius || 0.35)) * tileSize}px`;
      node.root.style.top = `${((m.y || 0) - (m.radius || 0.35)) * tileSize}px`;

      const state = m.surfaced ? 'surfaced' : 'buried';
      if (node.state !== state) {
        node.state = state;
        node.inner.textContent = m.surfaced ? '💣' : '';
        node.inner.style.width = '100%';
        node.inner.style.height = '100%';
        node.inner.style.borderRadius = '50%';
        node.inner.style.fontSize = `${Math.round(d * 1.05)}px`;
        node.inner.style.lineHeight = '1';
        node.inner.style.background = m.surfaced ? 'rgba(255, 244, 214, 0.0)' : 'rgba(107, 74, 46, 0.5)';
        node.inner.style.border = m.surfaced ? 'none' : '2px dashed rgba(80, 52, 28, 0.75)';
      }
    }

    for (const [id, node] of this.nodes) {
      if (alive.has(id)) continue;
      node.root.remove();
      this.nodes.delete(id);
    }
  }

  destroy() {
    for (const node of this.nodes.values()) node.root.remove();
    this.nodes.clear();
  }
}

export default MineView;
