// src/ui/CreatureView.js
// 生物表现层：纯色圆形（直径 = 碰撞直径 radius * 2 * 每格像素）
// - 不做贴图 / 图标 / emoji；
// - 位置严格取自 Geometry.creatureRenderCircle（renderPos），与判定圆一致；
// - 节点按 creatureId 缓存，每帧只更新 transform / 直径，不重建 DOM；
// - 同一位置完全重叠的两只各自保留独立节点（半透明 + 描边，重叠时仍可分辨）。

import { createEl } from './dom.js';
import { creatureRenderCircle } from '../core/Geometry.js';

/** 物种配色：小鸡 / 成鸡各一色；史莱姆按元素变体同色系区分 */
export const CREATURE_COLORS = {
  chick: '#f5c542',        // 小鸡：暖黄
  chicken: '#e8812b',      // 成鸡：橙
  slime_fire: '#e14b36',   // 火：红
  slime_water: '#3d8fe0',  // 水：蓝
  slime_thunder: '#a05fd6',// 雷：紫
  slime_ice: '#78d4f0',    // 冰：浅青
  slime_grass: '#5cb85c',  // 草：绿
  slime_wind: '#7fd0a4',   // 风：浅绿松
  slime_rock: '#9a8468',   // 岩：褐
};
export const DEFAULT_CREATURE_COLOR = '#cccccc';

export function creatureColor(kind) {
  return CREATURE_COLORS[kind] || DEFAULT_CREATURE_COLOR;
}

/**
 * 纯函数：给定生物与每格像素，返回圆形像素几何。
 * @returns {{x:number, y:number, diameter:number, color:string}}
 */
export function creatureCircleStyle(creature, tileSizePx) {
  const circle = creatureRenderCircle(creature);
  return {
    x: circle.x * tileSizePx,
    y: circle.y * tileSizePx,
    diameter: circle.r * 2 * tileSizePx,
    color: creatureColor(creature.kind),
  };
}

export class CreatureView {
  /** @param {HTMLElement} layer 已存在的绝对定位容器（原点 = 地图左上角） */
  constructor(layer) {
    this.layer = layer;
    this.els = new Map();       // creatureId → DOM 节点
    this.sizes = new Map();     // creatureId → 上次直径 px
    this.kinds = new Map();     // creatureId → 上次 kind（长大换色/换大小）
    this.transforms = new Map();// creatureId → 上次 transform 字符串（静止时不重复写 DOM）
  }

  /**
   * 逐帧绘制所有生物。
   * @param {object} gs
   * @param {number} tileSizePx
   */
  paint(gs, tileSizePx) {
    if (!gs || !this.layer || !Array.isArray(gs.creatures)) return;
    const alive = new Set();

    for (const c of gs.creatures) {
      if (!c || c.hp <= 0) continue;
      alive.add(c.id);

      let el = this.els.get(c.id);
      if (el && this.kinds.get(c.id) !== c.kind) {
        el.remove();
        this.els.delete(c.id);
        this.sizes.delete(c.id);
        this.kinds.delete(c.id);
        this.transforms.delete(c.id);
        el = null;
      }
      if (!el) {
        el = createEl('div', {
          class: ['map-creature'],
          attrs: { 'data-creature-id': c.id, 'data-kind': c.kind },
          style: {
            position: 'absolute',
            left: '0px',
            top: '0px',
            borderRadius: '50%',
            background: creatureColor(c.kind),
            opacity: '0.88',
            boxShadow: '0 0 0 1px rgba(255,255,255,0.6)',
            pointerEvents: 'none',
            willChange: 'transform',
          },
        });
        this.layer.appendChild(el);
        this.els.set(c.id, el);
        this.kinds.set(c.id, c.kind);
      }

      const vis = creatureCircleStyle(c, tileSizePx);
      if (this.sizes.get(c.id) !== vis.diameter) {
        el.style.width = `${vis.diameter}px`;
        el.style.height = `${vis.diameter}px`;
        this.sizes.set(c.id, vis.diameter);
      }
      // 静止 / 未移动的生物不写 transform（避免每帧无意义的 DOM 更新）
      const transform = `translate(${vis.x}px, ${vis.y}px) translate(-50%, -50%)`;
      if (this.transforms.get(c.id) !== transform) {
        el.style.transform = transform;
        this.transforms.set(c.id, transform);
      }
    }

    for (const [id, el] of this.els) {
      if (alive.has(id)) continue;
      el.remove();
      this.els.delete(id);
      this.sizes.delete(id);
      this.kinds.delete(id);
      this.transforms.delete(id);
    }
  }
}
