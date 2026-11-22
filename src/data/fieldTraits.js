// src/data/fieldTraits.js
// 地块内容「特性行」的展示口径（用户 2026-11-22 裁定）：
//   · 地块原生特性 —— 原色（稀有度 1）
//   · 魔导书新增 / 修改的特性 —— 该书稀有度色；多本作用于同一特性时描述合并、底色取最高
//   · 其他地块给予的临时特性 —— 给予者稀有度色（向日葵 R3 → 蓝）
//   · 被封禁（【压制】）的特性 —— 整条红底 + 红色删除线（图鉴永不显示红）
//   · 非特性说明（啤酒花浇水、蘑菇水面失效等）—— 保持原色，不参与封禁
//
// 物品库只存人类可读描述；「哪一行来自哪本魔导书 / 哪个地块」全部集中在本注册表，
// 不往物品库新增结构化列。

import { ITEMS } from './items.js';
import { countItem } from '../systems/InventorySystem.js';
import { FieldEffects } from '../systems/FieldEffects.js';

/** 稀有度底色（1 原色 / 2 绿 / 3 蓝 / 4 紫 / 5 金；0 与 99 用原色） */
export const TRAIT_FILL = {
  1: '#f5ecd8',
  2: '#d9efd6',
  3: '#d6e6f7',
  4: '#e8d9f5',
  5: '#f7e6b0',
};
export const SUPPRESSED_FILL = '#f7d6d6';
export const SUPPRESSED_TEXT = '#c0392b';

/** 稀有度 → 底色；无效 / 特殊值（0、99）一律原色 */
export function rarityFill(rarity) {
  const n = Number(rarity);
  if (!Number.isFinite(n) || n < 1 || n > 5) return TRAIT_FILL[1];
  return TRAIT_FILL[n] || TRAIT_FILL[1];
}

/** 不上色、不参与封禁的原生说明行（非特性） */
const NOTE_LINES = new Set([
  '啤酒花需要浇水，当相邻格的地形有水面时，激活特性：【产出时】产量+2',
  '蘑菇田块所在地块地形为水面时，所有特性失效',
]);

const stripBullet = (line) => String(line || '').replace(/^\s*•\s*/, '').trim();

/**
 * 地块特性来源注册表
 *   mods:   魔导书对该田块特性的操作
 *           op='add'     → 追加一条新特性（底色 = 该书稀有度）
 *           op='replace' → 修改已有特性（match 命中原文行；多本同时命中则描述合并、底色取最高）
 *   shared: 仓廪实共享（稻 / 麦互为视同）—— 满足 via 与原书都持有时追加，底色 = via 的稀有度
 */
const ownsBook = (gs, id) => !!gs && countItem(gs, id) >= 1;

export const FIELD_TRAIT_PROVENANCE = {
  facility_wheat: {
    mods: [
      { grimoire: 'grimoire_grain_full', op: 'add', line: '【每一日结束时】获得小麦 ×1' },
      {
        grimoire: 'grimoire_golden_wave',
        op: 'add',
        line: '【经过时】获得小麦 ×1',
        // 条件属于「发放判定」，不属于特性描述：只有该格真正处于
        // 「≥3 个小麦田块相连」的簇内（仓廪实时水稻同样计入）才显示这条特性
        condition: (gs, ref) => ref != null && FieldEffects.hasGoldenWaveTrait(gs, ref),
      },
    ],
  },

  facility_rice: {
    shared: [
      {
        via: 'grimoire_granary_full',
        grimoire: 'grimoire_grain_full',
        line: '【每一日结束时】获得小麦 ×1',
      },
      {
        via: 'grimoire_granary_full',
        grimoire: 'grimoire_golden_wave',
        line: '【经过时】获得小麦 ×1',
        condition: (gs, ref) => ref != null && FieldEffects.hasGoldenWaveTrait(gs, ref),
      },
    ],
  },

  facility_potato: {
    mods: [
      {
        grimoire: 'grimoire_potato_hardship',
        op: 'replace',
        match: '【进入时】',
        line: '【进入时】可以取走所有土豆田块储存的土豆',
      },
      {
        grimoire: 'grimoire_potato_mine',
        op: 'add',
        line: '【每一日开始时】在栅栏内埋下 1 个【土豆地雷】（场上至多 5 个）：5 回合后探出，敌人碰撞时爆炸造成小范围火元素伤害，伤害量为本田块当前储存的土豆数量，并使敌人【晕眩】1 回合',
      },
    ],
  },

  facility_tulip: {
    mods: [
      // 泡沫与「简单！」修改同一条波动特性：数值 vs 节点。
      // 两书同持时合并为一条（节点=每回合、区间=-9~+18），由下面「简单！」那条统一产出。
      {
        grimoire: 'grimoire_bubble',
        op: 'replace',
        match: '【每一日开始时】',
        line: (gs) => (ownsBook(gs, 'grimoire_tulip_simple') ? null : '【每一日开始时】价值随机 -9~+18'),
      },
      // 简单！把日初节点换成回合节点；祝福文案以物品库原文为准，不在代码里另拼
      {
        grimoire: 'grimoire_tulip_simple',
        op: 'replace',
        match: '【每一日开始时】',
        line: (gs) => (ownsBook(gs, 'grimoire_bubble')
          ? '【每回合开始时】价值随机 -9~+18'
          : '【每回合开始时】价值随机 -4~+9'),
      },
      // 泡沫后三段合为一条常态特性；被【压制】时随该特性一起失效
      {
        grimoire: 'grimoire_bubble',
        op: 'add',
        line: '价值可以为负：为负时采摘或拆除扣除对应价值的金币；|价值| > 50 时采摘或拆除价值 ×1.5；价值 < -100 时强制拆除',
      },
      {
        grimoire: 'grimoire_tulip_simple',
        op: 'add',
        line: '可在郁金香田块上叠放新的郁金香：当前价值 += 初始价值（3；有经济上行时为 9，每次叠放都加），此后波动结果 ×(1 + 叠放层数)',
      },
    ],
  },
};

/** 该行是否属于「特性」：除白名单里的非特性说明外，一律按特性渲染（统一米色底） */
export function isTraitLine(line) {
  const text = stripBullet(line);
  if (!text) return false;
  return !NOTE_LINES.has(text);
}

/**
 * 计算某田块「地块内容」应显示的行
 * @param {object|null} gs 游戏状态（图鉴模式 / 未提供时忽略玩家进度）
 * @param {string} fieldId 田块 id
 * @param {object} [opts]
 * @param {boolean} [opts.codex] 图鉴：只显示地块原始特性，与玩家进度无关，永不封禁变红
 * @param {boolean} [opts.suppressed] 该地块当前是否被【压制】
 * @param {Array<{text:string, rarity:number}>} [opts.extraTraits] 运行期临时特性（向日葵给予等）
 * @param {number|object|null} [opts.ref] 该田块在地图上的位置（外圈 idx / 栅栏 ref）；
 *        魔导书的条件型特性（如黄金浪）只有拿到真实位置时才可能显示
 * @returns {Array<{text:string, kind:'trait'|'note', rarity:number, suppressed:boolean}>}
 */
export function fieldContentRows(gs, fieldId, opts = {}) {
  const { codex = false, suppressed = false, extraTraits = [], ref = null } = opts;
  const def = ITEMS[fieldId];
  if (!def) return [];

  const owned = (id) => !!gs && countItem(gs, id) >= 1;
  // 条件属于「发放判定」：满足才发放这条特性；背包 / 图鉴等没有真实位置时不发放
  const granted = (entry) => !entry.condition || (!!gs && entry.condition(gs, ref));
  const nativeLines = String(def.description || '').split('\n').map((l) => l.trim()).filter(Boolean);

  let rows = nativeLines.map((line) => ({
    text: line,
    kind: isTraitLine(line) ? 'trait' : 'note',
    rarity: 1,
    suppressed: false,
  }));

  if (!codex && gs) {
    const provenance = FIELD_TRAIT_PROVENANCE[fieldId] || {};

    // 1) 魔导书修改：同一原文行可被多本命中 → 描述合并、底色取最高
    const replaced = new Map();
    for (const mod of provenance.mods || []) {
      if (mod.op !== 'replace' || !owned(mod.grimoire)) continue;
      const idx = rows.findIndex((r) => r.kind === 'trait' && r.text.includes(mod.match));
      if (idx < 0) continue;
      // line 可为函数：返回 null 表示「与另一本书合并后由对方统一产出」，避免重复成行
      const line = typeof mod.line === 'function' ? mod.line(gs) : mod.line;
      if (!line) continue;
      const rec = replaced.get(idx) || { lines: [], rarity: 1 };
      rec.lines.push(line);
      rec.rarity = Math.max(rec.rarity, ITEMS[mod.grimoire]?.rarity || 1);
      replaced.set(idx, rec);
    }
    if (replaced.size > 0) {
      const next = [];
      rows.forEach((row, idx) => {
        const rec = replaced.get(idx);
        if (!rec) { next.push(row); return; }
        for (const line of rec.lines) {
          next.push({ text: line, kind: 'trait', rarity: rec.rarity, suppressed: false });
        }
      });
      rows = next;
    }

    // 2) 魔导书新增特性
    for (const mod of provenance.mods || []) {
      if (mod.op !== 'add' || !owned(mod.grimoire) || !granted(mod)) continue;
      const line = typeof mod.line === 'function' ? mod.line(gs) : mod.line;
      if (!line) continue;
      rows.push({
        text: line,
        kind: 'trait',
        rarity: ITEMS[mod.grimoire]?.rarity || 1,
        suppressed: false,
      });
    }

    // 3) 仓廪实共享：需要同时持有 via 与原书，底色取 via 的稀有度
    for (const shared of provenance.shared || []) {
      if (!owned(shared.via) || !owned(shared.grimoire) || !granted(shared)) continue;
      rows.push({
        text: shared.line,
        kind: 'trait',
        rarity: ITEMS[shared.via]?.rarity || 1,
        suppressed: false,
      });
    }
  }

  // 4) 运行期临时特性（向日葵给予）：给予者稀有度色
  for (const t of extraTraits || []) {
    if (!t || !t.text) continue;
    rows.push({
      text: t.text,
      kind: 'trait',
      rarity: t.rarity || 1,
      suppressed: false,
    });
  }

  // 5) 【压制】：特性整条变红 + 删除线；非特性说明保持原样；图鉴永不红
  if (suppressed && !codex) {
    for (const row of rows) if (row.kind === 'trait') row.suppressed = true;
  }
  return rows;
}

export default fieldContentRows;
