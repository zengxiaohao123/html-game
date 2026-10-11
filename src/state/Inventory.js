/**
 * state/Inventory.js —— 背包（6 分类）+ 金币 + 元素池
 *
 * 所有分类无容量上限、可无限堆叠（§6.2）。
 * items: Map<itemId, count>，category 由物品表决定（不在这里冗余）。
 * elements: Map<Element, count> 战斗外元素池（ElementDeck 的探索态视图）。
 */

import { InvCategory } from '../core/Const.js';
import { getItem } from '../data/items.js';
import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';

export class Inventory {
  constructor() {
    this.items = new Map();   // itemId -> count（材料/消耗品/永久/设施/地块/杂物）
    this.elements = new Map(); // element -> count
    this.gold = 0;
    // 永久物品"已合成次数"（成本递增加算）
    this.craftCount = new Map(); // itemId -> times
  }

  count(id) { return this.items.get(id) ?? 0; }
  elementCount(el) { return this.elements.get(el) ?? 0; }

  add(id, n = 1) {
    if (n <= 0) return;
    this.items.set(id, this.count(id) + n);
    EventBus.emit(GE.INV_CHANGE, { op: 'add', id, count: n });
  }

  /** 足够才扣；不足返回 false 且不扣 */
  remove(id, n = 1) {
    const have = this.count(id);
    if (have < n) return false;
    if (have === n) this.items.delete(id);
    else this.items.set(id, have - n);
    EventBus.emit(GE.INV_CHANGE, { op: 'remove', id, count: n });
    return true;
  }

  canAfford(cost) {
    return Object.entries(cost).every(([id, n]) => this.count(id) >= n);
  }
  payCost(cost) {
    if (!this.canAfford(cost)) return false;
    for (const [id, n] of Object.entries(cost)) this.remove(id, n);
    return true;
  }
  gainLoot(loot) {
    for (const { item, count } of loot) {
      if (item === 'gold') this.addGold(count);
      else this.add(item, count);
    }
  }

  addGold(n) {
    this.gold = Math.max(0, this.gold + n);
    EventBus.emit(GE.GOLD_CHANGE, { gold: this.gold });
  }
  spendGold(n) {
    if (this.gold < n) return false;
    this.addGold(-n);
    return true;
  }

  addElement(el, n = 1) {
    this.elements.set(el, this.elementCount(el) + n);
    EventBus.emit(GE.INV_CHANGE, { op: 'element', id: el });
  }
  removeElement(el, n = 1) {
    const have = this.elementCount(el);
    if (have < n) return false;
    if (have === n) this.elements.delete(el);
    else this.elements.set(el, have - n);
    return true;
  }

  /** 按分类列出（用于背包 UI） */
  listByCategory(cat) {
    const out = [];
    for (const [id, count] of this.items) {
      const def = getItem(id);
      if (def && def.category === cat) out.push({ id, count, def });
    }
    return out;
  }

  /** 某分类下的条目数量（含设施"未拥有但可造"由设施 UI 另行合并） */
  serialize() {
    return {
      items: [...this.items.entries()],
      elements: [...this.elements.entries()],
      gold: this.gold,
      craftCount: [...this.craftCount.entries()],
    };
  }
  static deserialize(d) {
    const inv = new Inventory();
    inv.items = new Map(d.items || []);
    inv.elements = new Map(d.elements || []);
    inv.gold = d.gold ?? 0;
    inv.craftCount = new Map(d.craftCount || []);
    return inv;
  }
}

export { InvCategory };
