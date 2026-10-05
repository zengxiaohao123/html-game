// =============================================================
// explore.js —— 探索移动（矩形坐标 + 原地踏步 + 回字形外圈）
// 读取 04-探索与地图.md 规格
// =============================================================

// ---------------------------------------------------------------
// 方向键输入处理（由 main.js 调用）
// ---------------------------------------------------------------
function tryExploreMove(dir) {
  if (G.mode !== 'explore') return;
  if (G.hero.actionPoint <= 0) {
    UI.toast('行动力不足。睡觉恢复。');
    return;
  }

  // 先更新主角朝向（不管能不能走）
  G.hero.facing = dir;

  const target = RULES.adjacent(G.px, G.py, dir);
  if (!RULES.passable(G.map, target.x, target.y)) {
    UI.toast('无法前往那个方向。');
    // 朝向变了但位置没动；消耗 1 行动力（原地踏步语义）
    consumeMovement(/* moved */ false);
    return;
  }

  G.px = target.x;
  G.py = target.y;
  consumeMovement(/* moved */ true);
  triggerContentOnEnter(target.x, target.y);
}

// ---------------------------------------------------------------
// 消耗行动力 + 载具次数
// ---------------------------------------------------------------
function consumeMovement(moved) {
  G.hero.actionPoint -= 1;
  // 载具消耗（后续接）
  UI.refreshHUD();
}

// ---------------------------------------------------------------
// 点击地块 → 点「前往」按钮触发
// 目标是当前自身格 = 原地踏步（消耗行动力 + 载具 + 重新触发地块内容）
// ---------------------------------------------------------------
function tryExploreGoTo(targetX, targetY) {
  if (G.mode !== 'explore') return;
  if (G.hero.actionPoint <= 0) {
    UI.toast('行动力不足。');
    return;
  }
  // 只能走相邻 4 格（或原地）
  const dist = RULES.manhattan({ x: G.px, y: G.py }, { x: targetX, y: targetY });
  if (dist > 1) {
    UI.toast('太远了。');
    return;
  }
  // 设置朝向（原地踏步也设置成"朝向自己"：保持不变 或 用指定方向）
  // 这里简化处理：如果是原地，保持原朝向；如果是相邻，朝目标方向
  if (dist === 1) {
    if (targetX > G.px) G.hero.facing = 'right';
    else if (targetX < G.px) G.hero.facing = 'left';
    else if (targetY > G.py) G.hero.facing = 'down';
    else G.hero.facing = 'up';
  }

  if (dist === 1) {
    if (!RULES.passable(G.map, targetX, targetY)) {
      UI.toast('无法前往那个方向。');
      consumeMovement(false);
      return;
    }
    G.px = targetX;
    G.py = targetY;
  }
  // 原地踏步（dist === 0）：不动，但消耗行动力 + 重新触发地块内容
  consumeMovement(dist > 0);
  triggerContentOnEnter(targetX, targetY);
}

// ---------------------------------------------------------------
// 进入地块后触发内容
// ---------------------------------------------------------------
function triggerContentOnEnter(x, y) {
  const cell = MAP.getCell(G.map, x, y);
  if (!cell || !cell.content) {
    UI.refreshMap();
    return;
  }

  const ct = cell.content.type;

  switch (ct) {
    case 'empty':
      // 空地搜索
      doEmptySearch(cell);
      break;
    case 'terrain':
      // 地形也有空地搜索资源效果
      doEmptySearch(cell);
      break;
    case 'battle':
    case 'emergency':
    case 'reward': {
      // 进入战斗
      const scene = DATA.getBattleSceneByContentType(ct);
      START_COMBAT(G.map, x, y, scene);
      return;
    }
    case 'event':
      // 进入剧情事件
      startEvent(x, y);
      cell.content.done = true;
      break;
    case 'loot':
      // 战利品（先不实现）
      cell.content.done = true;
      cell.content.type = 'empty';
      break;
  }

  UI.refreshMap();
}

// ---------------------------------------------------------------
// 空地搜索（具体资源池和抽取概率由设计者给出）
// ---------------------------------------------------------------
function doEmptySearch(cell) {
  UI.toast('你在此处搜索了一下……');
  // 具体搜索逻辑后续接，先留空
}

// ---------------------------------------------------------------
// 睡眠进下一天
// ---------------------------------------------------------------
function sleepNextDay() {
  G.day += 1;
  const prevPos = { x: G.px, y: G.py };
  G.map = MAP.generateMap();    // 新地图
  MAP.clearAllAttach(G.map);    // 旧地图附着已被 generateMap 清空；双重保险
  const spawn = MAP.pickHeroSpawn(G.map, prevPos);
  G.px = spawn.x;
  G.py = spawn.y;
  G.hero.actionPoint = G.hero.maxActionPoint;  // 行动力回满
  G.hero.facing = 'up';
  // 永久物品触发效果（被子回血、陷阱收获、好人卡金币等）—— 后续接
  UI.refreshAll();
  UI.toast(`新的一天，第 ${G.day} 天开始。`);
}

// ---------------------------------------------------------------
// 导出
// ---------------------------------------------------------------
window.EXPLORE = {
  tryExploreMove,
  tryExploreGoTo,
  triggerContentOnEnter,
  doEmptySearch,
  sleepNextDay,
};
