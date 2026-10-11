/**
 * state/GameMap.js —— 探索地图（§3.1–§3.6）
 *
 * 二维正方形网格，四方向相邻逻辑；坐标不展示给玩家。
 * tiles: Map<"x,y", Tile>，未记录即 Void。
 * Tile { terrain, content, entity }
 *   entity: { kind:'facility'|'hero'|'summon'..., id, data? }
 * 主角位置单独存于 GameState.heroPos；地图不重复持有 hero entity。
 */

import { Terrain, ContentType, CONFIG } from '../core/Const.js';
import { rng } from '../core/Rng.js';

export const key = (x, y) => `${x},${y}`;
export const parseKey = (k) => k.split(',').map(Number);

export function makeTile(terrain = Terrain.NONE, content = ContentType.EMPTY, entity = null) {
  return { terrain, content, entity, contentDoneToday: false };
}

export class GameMap {
  constructor() {
    this.tiles = new Map();
  }

  has(x, y) { return this.tiles.has(key(x, y)); }
  get(x, y) { return this.tiles.get(key(x, y)) ?? null; }
  set(x, y, tile) { this.tiles.set(key(x, y), tile); }

  isVoid(x, y) { return !this.has(x, y); }

  /** 初始 3×3（§3.6）：50%无地形/40%草地/10%水面；中心无地形放主角 */
  static initInitial() {
    const map = new GameMap();
    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        let terrain = Terrain.NONE;
        if (x === 0 && y === 0) {
          terrain = Terrain.NONE;
        } else {
          const r = rng.next();
          terrain = r < 0.50 ? Terrain.NONE : r < 0.90 ? Terrain.GRASS : Terrain.WATER;
        }
        map.set(x, y, makeTile(terrain, ContentType.EMPTY));
      }
    }
    return map;
  }

  /** 四方向相邻坐标 */
  static neighbors4(x, y) {
    return [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]];
  }

  /** 曼哈顿距离 */
  static manhattan(ax, ay, bx, by) {
    return Math.abs(ax - bx) + Math.abs(ay - by);
  }

  /** 某格是否可被主角进入（有 entity 或阻挡地形则不可） */
  enterable(x, y) {
    const t = this.get(x, y);
    if (!t) return false;
    if (t.entity) return false;
    if (t.terrain === Terrain.MOUNTAIN || t.terrain === Terrain.FOREST || t.terrain === Terrain.MINE) {
      return false;
    }
    return true;
  }

  /** 列出所有设施实体（供每日刷新豁免） */
  facilityTiles() {
    const out = [];
    for (const [k, t] of this.tiles) {
      if (t.entity?.kind === 'facility') out.push({ key: k, tile: t });
    }
    return out;
  }

  /** 视口内是否包含坐标（由渲染层给世界坐标范围） */
  static inViewport(x, y, vp) {
    return x >= vp.minX && x <= vp.maxX && y >= vp.minY && y <= vp.maxY;
  }

  serialize() {
    const arr = [];
    for (const [k, t] of this.tiles) {
      arr.push([k, {
        terrain: t.terrain, content: t.content,
        entity: t.entity, contentDoneToday: !!t.contentDoneToday,
        extra: t.extra ?? null, // 森林/矿脉 HP、篝火点燃天数、抽水泵储水等
      }]);
    }
    return { tiles: arr };
  }
  static deserialize(d) {
    const map = new GameMap();
    for (const [k, t] of (d.tiles || [])) {
      map.tiles.set(k, {
        terrain: t.terrain, content: t.content, entity: t.entity ?? null,
        contentDoneToday: !!t.contentDoneToday, extra: t.extra ?? null,
      });
    }
    return map;
  }
}
