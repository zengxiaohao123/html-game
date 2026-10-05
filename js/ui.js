// =============================================================
// ui.js —— UI 渲染层（重写地图渲染：CDN 图标 + 居中覆盖 + 层次分明）
// =============================================================

// ---------------------------------------------------------------
// 图标映射（lucide CDN SVG）
// ---------------------------------------------------------------
const ICON = {
  CDN: 'https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/',
  SUF: '.svg',
  key(name) { return this.CDN + name + this.SUF; },
  content: {
    battle:    'swords',
    emergency: 'zap',
    event:     'help-circle',
    loot:      'package',
    reward:    'gift',
    terrain:   'mountain',
  },
  elem: {
    fire:    'flame',
    water:   'droplet',
    grass:   'leaf',
    thunder: 'zap',
    ice:     'snowflake',
    wind:    'wind',
    rock:    'mountain-snow',
  },
  spawn: 'target',
  hero:  'circle-dot',
};

const ELEM_COLORS = {
  fire:    '#ff5533',
  water:   '#4499ff',
  grass:   '#55cc55',
  thunder: '#ffcc33',
  ice:     '#88ddff',
  wind:    '#bbddbb',
  rock:    '#aa8866',
};

// ---------------------------------------------------------------
// 多实体 2 秒循环切换
// ---------------------------------------------------------------
let _stackIdx = {};
let _stackTimer = null;
const STACK_SWITCH_MS = 2000;

function startStackLoop() {
  if (_stackTimer) return;
  _stackTimer = setInterval(() => {
    const map = (COMBAT && COMBAT.map) || G.map;
    if (!map) return;
    for (const c of map.cells) {
      if (c.entities && c.entities.length > 1) {
        const k = `${c.x},${c.y}`;
        _stackIdx[k] = ((_stackIdx[k] || 0) + 1) % c.entities.length;
      }
    }
    refreshMapView();
  }, STACK_SWITCH_MS);
}
function stopStackLoop() {
  if (_stackTimer) { clearInterval(_stackTimer); _stackTimer = null; }
  _stackIdx = {};
}
function currentEnt(cell) {
  if (!cell.entities || cell.entities.length === 0) return null;
  if (cell.entities.length === 1) return cell.entities[0];
  const k = `${cell.x},${cell.y}`;
  return cell.entities[_stackIdx[k] || 0];
}

// ---------------------------------------------------------------
// UI 主入口
// ---------------------------------------------------------------
const UI = {
  init() {
    document.addEventListener('keydown', onKeydown);
    startStackLoop();
  },
  switchMode(mode) {
    switchMode(mode);  // main.js 全局
    if (mode === 'explore' || mode === 'combat') startStackLoop(); else stopStackLoop();
  },
  refreshAll() { UI.refreshHUD(); UI.refreshMap(); },
  refreshHUD() {
    const el = document.getElementById('hud');
    if (!el || !G.hero) return;
    el.innerHTML = `第 ${G.day} 天 · 行动力 ${G.hero.actionPoint}/${G.hero.maxActionPoint} · HP ${G.hero.hp}/${G.hero.maxHp} · 健康 ${G.hero.health}/100`;
  },
  refreshMap() { refreshMapView(); },
  refreshCombat() { refreshMapView(); refreshCombatHUD(); },
  toast(text) {
    let t = document.getElementById('_toast');
    if (!t) {
      t = document.createElement('div');
      t.id = '_toast';
      Object.assign(t.style, {
        position:'fixed',top:'20px',left:'50%',transform:'translateX(-50%)',
        background:'rgba(0,0,0,.8)',color:'#fff',padding:'8px 16px',
        borderRadius:'6px',zIndex:'9999',pointerEvents:'none',opacity:'0',transition:'opacity .3s'
      });
      document.body.appendChild(t);
    }
    t.textContent = text; t.style.opacity = '1';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.style.opacity = '0', 1600);
  },
  log(text) { console.log(`[LOG] ${text}`); },
  showStatChoice(choices, count) { UI.log(`属性升级 ${count} 选 ${choices.length}`); },
};
window.UI = UI;

// ---------------------------------------------------------------
// 地图渲染 —— 核心：层次分明 + 全部居中 + 图标优先
//
// 一个格子（.map-cell）的渲染层，全部用 absolute + inset:0 覆盖正中间：
//   layer 0: 地形底色（background-color，整格）
//   layer 1: 元素附着半透明覆盖（inset:0，整格）
//   layer 2: 进攻点标记（图标，居中，z-index 2）
//   layer 3: content 图标（居中，z-index 3）
//   layer 4: 实体图标（居中，主角指示点 / 敌人头像，z-index 4）
//   layer 5: 选中边框（outline，z-index 5）
// ---------------------------------------------------------------
function refreshMapView() {
  const map = (COMBAT && COMBAT.map) || G.map;
  if (!map) return;

  const grid = document.getElementById('mapGrid');
  if (!grid) return;

  grid.innerHTML = '';
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = `repeat(${map.width}, 56px)`;
  grid.style.gridTemplateRows    = `repeat(${map.height}, 56px)`;
  grid.style.gap = '3px';

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const cell = MAP.getCell(map, x, y);
      const div = document.createElement('div');
      div.className = 'map-cell';
      div.dataset.x = x; div.dataset.y = y;

      // layer 0: 地形底色
      if (cell.terrain === 'void') {
        div.classList.add('is-void');
      } else {
        div.classList.add('is-terrain');
      }

      // layer 1: 元素附着（半透明整格覆盖）
      if (cell.attach) {
        const at = document.createElement('div');
        at.className = 'layer layer-attach';
        at.style.background = ELEM_COLORS[cell.attach] || '#888';
        at.style.opacity = '0.35';
        div.appendChild(at);
      }

      // layer 2: 进攻点标记
      if (cell.isEnemySpawnPoint) {
        const sp = iconLayer(ICON.key(ICON.spawn), 'layer layer-spawn');
        sp.style.color = '#e44';
        div.appendChild(sp);
      }

      // layer 3: content 图标（只在探索模式、非 void 格显示）
      if (cell.content && !cell.content._hidden && cell.terrain !== 'void') {
        const name = ICON.content[cell.content.type];
        if (name) {
          div.appendChild(iconLayer(ICON.key(name), 'layer layer-content'));
        }
      }

      // layer 4: 实体图标
      const ent = currentEnt(cell);
      if (ent) {
        if (ent.key === 'pro') {
          // 主角：圆圈指示点（带朝向小三角）
          const h = document.createElement('div');
          h.className = 'layer layer-hero';
          // 中心圆点
          h.innerHTML = `
            <div class="hero-dot"></div>
            <div class="hero-facing facing-${ent.facing}"></div>
          `;
          div.appendChild(h);
        } else {
          // 其他实体：用 entity 名字 + 一个色块背景（敌人头像素材后续你会给）
          const e = document.createElement('div');
          e.className = 'layer layer-entity';
          e.textContent = (ent.name || ent.key).slice(0, 4);
          e.style.background = factionBg(ent.faction);
          div.appendChild(e);
        }
      }

      div.addEventListener('click', () => onCellClick(x, y));
      grid.appendChild(div);
    }
  }

  // 最后：把主角指示点补到它当前所在格（探索态和战斗态都画）
  const heroPos = (() => {
    if (G.mode === 'combat' && COMBAT && COMBAT.heroEntity) {
      return { x: COMBAT.heroEntity.x, y: COMBAT.heroEntity.y, facing: COMBAT.heroEntity.facing };
    }
    if (G.hero && G.map) {
      return { x: G.px, y: G.py, facing: G.hero.facing };
    }
    return null;
  })();
  if (heroPos) {
    const cellDiv = grid.querySelector(`[data-x="${heroPos.x}"][data-y="${heroPos.y}"]`);
    if (cellDiv && !cellDiv.querySelector('.layer-hero')) {
      const h = document.createElement('div');
      h.className = 'layer layer-hero';
      h.innerHTML = `<div class="hero-dot"></div><div class="hero-facing facing-${heroPos.facing}"></div>`;
      cellDiv.appendChild(h);
    }
  }
}

function iconLayer(src, cls) {
  const el = document.createElement('div');
  el.className = cls;
  const img = document.createElement('img');
  img.src = src;
  img.onerror = function() { this.remove(); };  // 图标加载失败就静默
  img.draggable = false;
  el.appendChild(img);
  return el;
}

function factionBg(f) {
  return ({ player:'#2a7', enemy:'#b44', neutral:'#888', summon_player:'#48c', summon_enemy:'#a64' })[f] || '#666';
}

// ---------------------------------------------------------------
// 战斗 HUD
// ---------------------------------------------------------------
function refreshCombatHUD() {
  const info = document.getElementById('combatInfo');
  if (!info) return;
  info.textContent = `回合 ${COMBAT.turn} · 阶段 ${COMBAT.phase}`;
}

// ---------------------------------------------------------------
// 点击 / 前往
// ---------------------------------------------------------------
let _selCell = null;
function onCellClick(x, y) {
  _selCell = { x, y };
  const prompt = document.getElementById('promptZone');
  const goBtn  = document.getElementById('goBtn');
  if (prompt) {
    const map = (COMBAT && COMBAT.map) || G.map;
    const c = MAP.getCell(map, x, y);
    prompt.innerHTML = `(${x+1},${y+1}) · ${c.terrain}${c.attach?' · attach:'+c.attach:''}${c.content?' · '+c.content.type:''}`;
  }
  if (goBtn) {
    const heroPos = G.mode === 'explore'
      ? { x: G.px, y: G.py }
      : (COMBAT ? { x: COMBAT.heroEntity.x, y: COMBAT.heroEntity.y } : null);
    if (!heroPos) { goBtn.disabled = true; goBtn.textContent = '—'; return; }
    const dist = RULES.manhattan(heroPos, { x, y });
    goBtn.disabled = dist > 1;
    goBtn.textContent = dist > 1 ? '太远了' : `前往 (${x+1},${y+1})`;
    goBtn.onclick = () => {
      if (G.mode === 'explore') EXPLORE.tryExploreGoTo(x, y);
    };
  }
}

// ---------------------------------------------------------------
// 键盘输入
// ---------------------------------------------------------------
function onKeydown(e) {
  const k = e.key.toLowerCase();
  if (G.mode === 'explore') {
    if (k === 'w') EXPLORE.tryExploreMove('up');
    else if (k === 's') EXPLORE.tryExploreMove('down');
    else if (k === 'a') EXPLORE.tryExploreMove('left');
    else if (k === 'd') EXPLORE.tryExploreMove('right');
  } else if (G.mode === 'combat' && COMBAT && COMBAT.phase === 'playerManual' && !COMBAT.ended) {
    if (k === 'w') tryCombatMove('up');
    else if (k === 's') tryCombatMove('down');
    else if (k === 'a') tryCombatMove('left');
    else if (k === 'd') tryCombatMove('right');
    else if (k === 'f') tryCombatSkip();
  }
}
