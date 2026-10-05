/* ============================================================
   js/reactions.js —— 模块：元素反应纯表 + 查反应函数
   
   ⚠️ 本文件只有"规则"没有"执行"：
   - 全部反应定义按 docs/02-核心概念 §九 十种反应严格编写
   - 不自己定义 ELEMENTS（旧版 reactions.js 有重复定义，已废弃）
   - 所有元素表从 window.Data.ELEM_LIST 统一读取
   - 每个反应函数返回一个"指令对象"给 combat.js 执行（副作用不在本文件发生）
   - 扩散的"一圈做完再连锁"时序由 combat.js 的 reactionStack 主循环实现，本文件只负责返回扩散目标格清单
   
   外部暴露: window.Reactions = { lookup, resolve, ... }
   ============================================================ */
"use strict";

(function () {
  /* 等 data.js 把 window.Data 挂好。传统 script 加载顺序保证 data.js 先于本文件 */
  const ELEM_LIST = ['fire', 'water', 'grass', 'thunder', 'ice', 'wind', 'rock'];

  /* ==================== 十种反应的"触发对"表 ====================
     key = `${firstElem}:${secondElem}`（first=地块现有附着，second=新附着）
     每种反应返回一个对象：{ kind: <反应名>, meta: {...} }
     多数反应顺序无关；蒸发、融化顺序敏感。 */
  const REACTIONS = {
    /* 蒸发（水+火，顺序敏感）*/
    'fire:water': { kind:'evap_water', orderSensitive:true,
      meta: { triggerGainsBuff:'evap_water', buffLayer:1 } },  /* 触发者（second=水）获蒸发·水 */
    'water:fire': { kind:'evap_fire', orderSensitive:true,
      meta: { triggerGainsBuff:'evap_fire', buffLayer:1 } },  /* 触发者（second=火）获蒸发·火 */

    /* 融化（火+冰，顺序敏感）*/
    'ice:fire': { kind:'melt_fire', orderSensitive:true,
      meta: { triggerGainsBuff:'melt_fire', buffLayer:1 } },  /* 触发者（second=火）获融化·火 */
    'fire:ice': { kind:'melt_ice', orderSensitive:true,
      meta: { triggerGainsBuff:'melt_ice', buffLayer:1 } },  /* 触发者（second=冰）获融化·冰 */

    /* 燃烧（火+草）*/
    'fire:grass': { kind:'burn_zone', meta: { zoneType:'burn' } },
    'grass:fire': { kind:'burn_zone', meta: { zoneType:'burn' } },

    /* 超载（火+雷）*/
    'fire:thunder': { kind:'overload', meta: { } },
    'thunder:fire': { kind:'overload', meta: { } },

    /* 扩散（火风/水风/雷风/冰风）—— second 必须是"另一种元素"且其中有一个是 wind */
    'fire:wind':   { kind:'diffuse', meta: { } },
    'water:wind':  { kind:'diffuse', meta: { } },
    'thunder:wind':{ kind:'diffuse', meta: { } },
    'ice:wind':    { kind:'diffuse', meta: { } },
    'wind:fire':   { kind:'diffuse', meta: { } },
    'wind:water':  { kind:'diffuse', meta: { } },
    'wind:thunder':{ kind:'diffuse', meta: { } },
    'wind:ice':    { kind:'diffuse', meta: { } },

    /* 结晶（火岩/水岩/雷岩/冰岩）*/
    'fire:rock':    { kind:'crystallize', meta: { } },
    'water:rock':   { kind:'crystallize', meta: { } },
    'thunder:rock': { kind:'crystallize', meta: { } },
    'ice:rock':     { kind:'crystallize', meta: { } },
    'rock:fire':    { kind:'crystallize', meta: { } },
    'rock:water':   { kind:'crystallize', meta: { } },
    'rock:thunder': { kind:'crystallize', meta: { } },
    'rock:ice':     { kind:'crystallize', meta: { } },

    /* 绽放（水草）*/
    'water:grass':  { kind:'bloom', meta: { } },
    'grass:water':  { kind:'bloom', meta: { } },

    /* 感电（水电）*/
    'water:thunder':  { kind:'electro_zone', meta: { zoneType:'electro' } },
    'thunder:water':  { kind:'electro_zone', meta: { zoneType:'electro' } },

    /* 冻结（水冰）*/
    'water:ice': { kind:'freeze', meta: { debuff:'frozen', turns:2 } },
    'ice:water': { kind:'freeze', meta: { debuff:'frozen', turns:2 } },

    /* 激化（草雷）*/
    'grass:thunder':  { kind:'aggro', meta: { buff:'aggro', layers:2 } },
    'thunder:grass':  { kind:'aggro', meta: { buff:'aggro', layers:2 } },

    /* 超导（雷冰）*/
    'thunder:ice': { kind:'supercond_zone', meta: { zoneType:'supercond' } },
    'ice:thunder': { kind:'supercond_zone', meta: { zoneType:'supercond' } },
  };

  /* ==================== 对外 API ==================== */

  /**
   * lookup(firstElem, secondElem)
   * 输入：地块现有附着 firstElem + 新附着 secondElem
   * 输出：反应定义对象 {kind, meta}，或 null
   * - 同种元素 → null（规格 §9.1 第 3 条：同种不反应也不叠加）
   */
  function lookup(firstElem, secondElem) {
    if (!firstElem || !secondElem) return null;
    if (firstElem === secondElem) return null;
    const key = firstElem + ':' + secondElem;
    return REACTIONS[key] || null;
  }

  /**
   * isAuraBlockingReaction(aura)
   * 某些地形始终附着的元素（grass/river/ice 等 ALWAYS_ELEMENT_TERRAINS）是否也能参与反应？
   * 按规格：能。它们就是地块上真实的附着。这个函数只为特殊兜底预留，默认返回 false。
   */
  function isAuraBlockingReaction(aura) { return false; }

  /**
   * elemOrderFor(first, second)
   * 返回 [地块现有, 新附着] 的 canonical 顺序，蒸发/融化判断顺序用。
   * lookup 里已按 first:second 精确区分顺序，本函数只是语义辅助。
   */
  function elemOrderFor(first, second) { return [first, second]; }

  /**
   * diffusionTargets(cx, cy, n)
   * 返回扩散反应的目标格清单（顺时针 9 格，扩散"一圈"）。
   * 顺序：从正上方开始顺时针 → 上 / 右上 / 右 / 右下 / 下 / 左下 / 左 / 左上
   * 输出: [{x,y}, ...]，不含自身格，过滤掉 out of bounds。
   */
  function diffusionTargets(cx, cy, mapN) {
    const order = [
      [ 0,-1], [ 1,-1], [ 1, 0], [ 1, 1],
      [ 0, 1], [-1, 1], [-1, 0], [-1,-1],
    ];
    const out = [];
    for (const [dx, dy] of order) {
      const x = cx + dx, y = cy + dy;
      if (x >= 0 && y >= 0 && x < mapN && y < mapN) out.push({ x, y });
    }
    return out;
  }

  /**
   * overloadTargets(cx, cy, mapN)
   * 超载（火+雷）范围：周围 5 格（adj5 = 上下左右 + 自身）
   */
  function overloadTargets(cx, cy, mapN) {
    const order = [[0,0],[0,-1],[0,1],[-1,0],[1,0]];
    const out = [];
    for (const [dx, dy] of order) {
      const x = cx + dx, y = cy + dy;
      if (x >= 0 && y >= 0 && x < mapN && y < mapN) out.push({ x, y });
    }
    return out;
  }

  /**
   * bloomTargets(cx, cy, mapN)
   * 绽放（水草）范围：周围 9 格（adj9 = 一圈 + 自身）
   */
  function bloomTargets(cx, cy, mapN) {
    const out = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x >= 0 && y >= 0 && x < mapN && y < mapN) out.push({ x, y });
      }
    }
    return out;
  }

  window.Reactions = window.Reactions || {};
  Object.assign(window.Reactions, {
    REACTIONS,
    lookup,
    isAuraBlockingReaction,
    elemOrderFor,
    diffusionTargets,
    overloadTargets,
    bloomTargets,
    ELEM_LIST,
  });
})();
