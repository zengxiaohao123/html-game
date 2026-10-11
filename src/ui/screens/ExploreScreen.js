/**
 * ui/screens/ExploreScreen.js —— 探索态界面（§3）
 *
 * 布局：
 *   顶部状态栏：天数 / 健康 / 行动力 / 金币 / 主角HP / 区域
 *   中部：左=地图（镜头跟随），右=信息区（地块内容/地形/实体 三 tab）
 *   底部：行动记录 + 建造 hotbar（建造模式时）
 *   全局面板按钮（J/B/E/Q/C/L/V）
 */

import { h, clear, toast } from '../dom.js';
import {
  Terrain, ContentType, CONFIG, PanelKey,
} from '../../core/Const.js';
import { GameMap, key } from '../../state/GameMap.js';
import { EventBus } from '../../core/EventBus.js';
import { GE } from '../../core/GameEvents.js';
import { getItem } from '../../data/items.js';
import { getFacility } from '../../data/facilities.js';
import { ELEMENT_NAME } from '../../core/Const.js';

const TERRAIN_LABEL = {
  none: '无地形', mountain: '山', water: '水面', grass: '草地',
  ice: '冰面', snow: '雪地', lava: '岩浆', forest: '森林', mine: '矿脉',
};
const CONTENT_LABEL = {
  empty: '空地', event: '事件', battle: '作战', elite: '紧急作战', reward: '奖励',
};

export class ExploreScreen {
  constructor(director, ui) {
    this.d = director;
    this.ui = ui;
    this.selected = null;      // {x,y}
    this.infoTab = 1;
    this.buildHotbar = [];     // 地块物品 id
    this.unsubs = [];
  }

  get gs() { return this.d.state; }
  get ex() { return this.d.explore; }

  render(root) {
    clear(root);
    this.root = root;
    root.append(
      this._topbar(),
      h('div.explore-body', {}, [
        h('div.map-stage#mapStage', {}, [this._mapLayer()]),
        this._infoPanel(),
      ]),
      this._bottomBar(),
    );
    this._bindKeys();
    this._subscribe();
    this.refresh();
  }

  destroy() {
    this.unsubs.forEach((f) => f());
    this.unsubs = [];
    if (this._keyHandler) window.removeEventListener('keydown', this._keyHandler);
  }

  // ---------------- 顶栏 ----------------
  _topbar() {
    return h('div.topbar#topbar', {}, [
      h('div.tb-group', {}, [
        this._chip('day', '第 - 天'),
        this._chip('area', ''),
      ]),
      h('div.tb-group.center', {}, [
        this._chip('health', '健康', 'hp'),
        this._chip('hp', '生命', 'hp'),
        this._chip('ap', '行动力', 'ap'),
        this._chip('gold', '金币', 'gold'),
      ]),
      h('div.tb-group.right', {}, this._panelButtons()),
    ]);
  }

  _chip(cls, label, tone) {
    return h(`div.chip.${cls}${tone ? '.' + tone : ''}`, {}, [
      h('span.chip-label', { text: label }),
      h('span.chip-value#tb-' + cls, { text: '' }),
    ]);
  }

  _panelButtons() {
    const defs = [
      ['J', '任务', 'quest'], ['B', '背包', 'inventory'], ['E', '合成', 'craft'],
      ['Q', '建造', 'build'], ['C', '角色', 'character'], ['L', '编队', 'party'], ['V', '商店', 'shop'],
    ];
    return defs.map(([k, name, panel]) => h('button.panel-btn', {
      dataset: { key: k, panel },
      title: `${name}（${k}）`,
      onClick: () => this.ui.openPanel(panel),
    }, [h('b', { text: k }), h('span', { text: name })]));
  }

  // ---------------- 地图 ----------------
  _mapLayer() {
    const wrap = h('div.map-viewport#mapViewport', { onClick: (e) => this._onMapClick(e) });
    wrap.append(h('div.map-grid#mapGrid'));
    return wrap;
  }

  /** 依据主角位置计算镜头内要显示的格子范围（含一圈 Void 用于建造） */
  _viewRange() {
    const { x, y } = this.gs.heroPos;
    const R = 6;
    return { minX: x - R, maxX: x + R, minY: y - R, maxY: y + R };
  }

  refresh() {
    if (!this.root) return;
    this._refreshTopbar();
    this._refreshMap();
    this._refreshInfo();
  }

  _refreshTopbar() {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('tb-day', `第 ${this.gs.day} 天`);
    set('tb-area', this.gs.area === 'city' ? '城市' : '野外');
    set('tb-health', this.gs.health);
    set('tb-hp', `${this.gs.heroHp}/${this.ex.heroMaxHp()}`);
    set('tb-ap', `${this.gs.ap}/${this.gs.apMax}`);
    set('tb-gold', this.gs.inventory.gold);
  }

  _refreshMap() {
    const grid = document.getElementById('mapGrid');
    if (!grid) return;
    clear(grid);
    const vr = this._viewRange();
    this.ex.setViewport(vr);
    const size = 24; // 13×13
    grid.style.gridTemplateColumns = `repeat(${vr.maxX - vr.minX + 1}, var(--tile-size))`;

    for (let y = vr.minY; y <= vr.maxY; y++) {
      for (let x = vr.minX; x <= vr.maxX; x++) {
        const tile = this.gs.map.get(x, y);
        const cell = h('div.tile-cell', { dataset: { x, y } });
        if (!tile) {
          cell.classList.add('void');
          if (this.d.explore?.buildMode) cell.classList.add('buildable-void');
        } else {
          cell.classList.add('terrain-' + tile.terrain);
          if (tile.content && tile.content !== ContentType.EMPTY) cell.classList.add('content-' + tile.content);
          if (tile.entity) cell.classList.add('has-entity', 'entity-' + (tile.entity.id || tile.entity.kind));
          if (x === this.gs.heroPos.x && y === this.gs.heroPos.y) cell.classList.add('hero-here');
          this._decorateTile(cell, tile, x, y);
        }
        if (this.selected && this.selected.x === x && this.selected.y === y) cell.classList.add('selected');
        grid.append(cell);
      }
    }
  }

  _decorateTile(cell, tile, x, y) {
    // 地形角标
    cell.append(h('span.t-terrain', { text: TERRAIN_LABEL[tile.terrain] }));
    // 内容标记
    if (tile.content && tile.content !== ContentType.EMPTY) {
      const mapText = { event: '？', battle: '战', elite: '险', reward: '赏' };
      cell.append(h('span.t-content.badge-' + tile.content, { text: mapText[tile.content] }));
    }
    // 主角
    if (x === this.gs.heroPos.x && y === this.gs.heroPos.y) {
      cell.append(h('span.actor.hero', { text: '余' }));
    } else if (tile.entity) {
      cell.append(h('span.actor.facility', { text: this._facilityGlyph(tile.entity.id) }));
    }
  }

  _facilityGlyph(id) {
    return { tent: '帐', campfire: '火', campfireOut: '烬', pump: '泵' }[id] || '设';
  }

  _onMapClick(e) {
    const cell = e.target.closest('.tile-cell');
    if (!cell) return;
    const x = Number(cell.dataset.x), y = Number(cell.dataset.y);
    // 建造模式：点击 Void 尝试建造
    if (this.ex.buildMode) {
      const chosen = this._chosenBuildItem();
      if (chosen) {
        if (chosen.placeTile) this.ex.buildTile(x, y, chosen.id);
        else this.ex.buildFacility(x, y, chosen.facilityId);
        this.refresh();
        return;
      }
    }
    this.selected = { x, y };
    this.infoTab = 1;
    this.refresh();
  }

  // ---------------- 信息区 ----------------
  _infoPanel() {
    return h('div.info-panel', {}, [
      h('div.info-tabs', {}, [1, 2, 3].map((n) => h('button.info-tab#itab' + n, {
        onClick: () => { this.infoTab = n; this.refresh(); },
      }, { 1: '地块内容', 2: '地形', 3: '实体' }[n]))),
      h('div.info-body#infoBody'),
      h('div.info-actions#infoActions'),
    ]);
  }

  _refreshInfo() {
    const body = document.getElementById('infoBody');
    const acts = document.getElementById('infoActions');
    if (!body) return;
    for (let n = 1; n <= 3; n++) {
      const t = document.getElementById('itab' + n);
      if (t) t.classList.toggle('active', n === this.infoTab);
    }
    clear(body); clear(acts);
    if (!this.selected) {
      body.append(h('p.info-empty', { text: '点击地图上的格子查看信息。' }));
      return;
    }
    const { x, y } = this.selected;
    const tile = this.gs.map.get(x, y);
    if (!tile) {
      body.append(h('p.info-empty', { text: '虚空（Void）：尚不存在的位置，可在建造模式铺设地块。' }));
      return;
    }
    const { x: hx, y: hy } = this.gs.heroPos;
    const adjacent = GameMap.manhattan(hx, hy, x, y) === 1;

    if (this.infoTab === 1) {
      const label = CONTENT_LABEL[tile.content];
      body.append(h('h3', { text: label }));
      if (tile.content === ContentType.BATTLE) body.append(h('p', { text: '这里会遭遇一场战斗。' }));
      if (tile.content === ContentType.ELITE) body.append(h('p', { text: '这里会遭遇一场艰难的战斗。' }));
      if (tile.content === ContentType.EVENT) body.append(h('p', { text: '似乎有什么事情将要发生。' }));
      if (tile.content === ContentType.REWARD) body.append(h('p', { text: '感觉这里能找到好东西。' }));
      if (tile.content === ContentType.EMPTY) body.append(h('p', { text: '一块普通的空地，走过去或许能搜到些什么。' }));
      if (!tile.entity) this._goButton(acts, x, y, adjacent);
    } else if (this.infoTab === 2) {
      body.append(h('h3', { text: TERRAIN_LABEL[tile.terrain] }));
      body.append(h('p', { text: this._terrainDesc(tile.terrain) }));
      if (!tile.entity) this._goButton(acts, x, y, adjacent);
    } else {
      if (x === hx && y === hy) {
        body.append(this._heroEntityCard());
      } else if (tile.entity?.kind === 'facility') {
        body.append(this._facilityCard(tile, adjacent));
        if (adjacent) this._facilityActions(acts, tile, x, y);
      } else {
        body.append(h('p.info-empty', { text: '这一格没有实体。' }));
        if (!tile.entity) this._goButton(acts, x, y, adjacent);
      }
    }
  }

  _terrainDesc(t) {
    return {
      none: '平平无奇的地面。',
      mountain: '无法翻越的高山，任何单位都不能进入。',
      water: '浅水。站在上面的单位总会附着水元素。',
      grass: '柔软的草地。站在上面的单位总会附着草元素。',
      ice: '湿滑的冰面，走上去会被迫向前滑行。',
      snow: '积雪覆盖。站在上面的单位总会附着冰元素。',
      lava: '滚烫的岩浆！总会附着火元素，每回合还会获得燃烧。',
      forest: '茂密的森林阻挡通行，可用主动技能砍伐（2 次），获得木材。',
      mine: '坚硬的矿脉阻挡通行，可用主动技能开采（2 次），获得矿石。',
    }[t] || '';
  }

  _goButton(acts, x, y, adjacent) {
    const { x: hx, y: hy } = this.gs.heroPos;
    const tile = this.gs.map.get(x, y);
    const isHere = x === hx && y === hy;
    const canGo = isHere || (adjacent && this.gs.map.enterable(x, y));
    acts.append(h('button.act-btn' + (canGo ? '' : '.disabled'), {
      text: isHere ? '原地踏步' : canGo ? '前往' : '不可前往',
      onClick: () => {
        if (!canGo) return;
        this.ex.goTo(x, y);
        this.refresh();
        this._maybeBattleSwitch();
      },
    }));
  }

  _heroEntityCard() {
    const gs = this.gs;
    return h('div.entity-card.hero-card', {}, [
      h('h4', { text: '余默（主角）' }),
      h('p', { text: `攻击 ${10 + gs.party.heroBonus.atk + (gs.permAgg?.baseAtk || 0)}　防御 ${gs.party.heroBonus.def}　速度 ${100 + gs.party.heroBonus.speed}` }),
      h('p', { text: `当前附着：${gs.heroAura ? ELEMENT_NAME[gs.heroAura] : '无'}` }),
      gs.heroAura ? h('span.aura-tag', { text: ELEMENT_NAME[gs.heroAura] }) : null,
    ]);
  }

  _facilityCard(tile, adjacent) {
    const fac = getFacility(tile.entity.id === 'campfireOut' ? 'campfireOut' : tile.entity.id);
    return h('div.entity-card', {}, [
      h('h4', { text: tile.entity.name }),
      h('p', { text: fac?.desc || '' }),
      tile.entity.id === 'pump' ? h('p', { text: `储水：${tile.extra?.stored ?? 0}/10` }) : null,
      adjacent ? h('p.adj-hint', { text: '相邻，可交互。' }) : h('p.adj-hint', { text: '走到相邻格才能交互。' }),
    ]);
  }

  _facilityActions(acts, tile, x, y) {
    const id = tile.entity.id;
    if (id === 'tent') {
      acts.append(h('button.act-btn.primary', { text: '睡觉（进入下一天）', onClick: () => { this.d.sleep(); this.refresh(); } }));
    }
    if (id === 'campfire') {
      acts.append(h('button.act-btn', { text: '烹饪', onClick: () => this.ui.openPanel('cook') }));
    }
    if (id === 'pump') {
      acts.append(h('button.act-btn', { text: '收取', onClick: () => { this.ex.collectPump(x, y); this.refresh(); } }));
    }
    acts.append(h('button.act-btn.ghost', { text: '拆除（返还一半材料）', onClick: () => {
      if (window.confirm('确定拆除该设施？返还一半材料。')) { this.ex.demolish(x, y); this.refresh(); }
    } }));
  }

  // ---------------- 底部 ----------------
  _bottomBar() {
    return h('div.bottom-bar', {}, [
      h('div.build-hotbar#buildHotbar'),
      h('div.action-log#actionLog'),
    ]);
  }

  _refreshBuildBar() {
    const bar = document.getElementById('buildHotbar');
    if (!bar) return;
    clear(bar);
    if (!this.ex.buildMode) { bar.style.display = 'none'; return; }
    bar.style.display = 'flex';
    bar.append(h('span.hb-title', { text: '建造：选择物品后点击视野内位置' }));
    const tileItems = ['tilePlain', 'tileGrass', 'tileWater', 'tileIce', 'tileForest', 'tileMine', 'tileSnow'];
    const facs = ['tent', 'campfire', 'pump'];
    const mk = (id, isFac) => {
      const def = isFac ? getFacility(id) : getItem(id);
      const owned = isFac ? this._facilityBuildable(id) : this.gs.inventory.count(id);
      const enough = isFac ? owned.enough : owned > 0;
      return h('button.hb-slot' + (enough ? '' : '.disabled'), {
        dataset: { buildId: id, fac: isFac ? '1' : '0' },
        onClick: () => { this._chosen = { id, placeTile: !isFac, facilityId: isFac ? id : null }; this._markChosen(); },
      }, [
        h('b', { text: def.name }),
        h('small', { text: isFac ? this._costText(id) : `持有 ${owned}` }),
      ]);
    };
    tileItems.forEach((id) => bar.append(mk(id, false)));
    facs.forEach((id) => bar.append(mk(id, true)));
  }

  _facilityBuildable(id) {
    const fac = getFacility(id);
    return { enough: this.gs.inventory.canAfford(fac.cost) };
  }
  _costText(id) {
    const fac = getFacility(id);
    return Object.entries(fac.cost).map(([m, n]) => `${getItem(m).name}×${n}`).join(' ');
  }

  _chosenBuildItem() {
    if (!this._chosen) {
      // 默认选第一个可建的
      const first = document.querySelector('.hb-slot:not(.disabled)');
      if (first) this._chosen = { id: first.dataset.buildId, placeTile: first.dataset.fac === '0', facilityId: first.dataset.fac === '1' ? first.dataset.buildId : null };
    }
    return this._chosen;
  }
  _markChosen() {
    document.querySelectorAll('.hb-slot').forEach((el) => el.classList.toggle('chosen', el.dataset.buildId === this._chosen?.id));
  }

  // ---------------- 输入 / 事件 ----------------
  _bindKeys() {
    this._keyHandler = (e) => {
      if (this.d.topState !== 'EXPLORE') return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const k = e.key.toLowerCase();
      if (this.ui.anyModalOpen()) return;
      if (k === 'w') { this.ex.moveDir(0, -1); this._afterMove(); }
      else if (k === 's') { this.ex.moveDir(0, 1); this._afterMove(); }
      else if (k === 'a') { this.ex.moveDir(-1, 0); this._afterMove(); }
      else if (k === 'd') { this.ex.moveDir(1, 0); this._afterMove(); }
      else if (PanelKey[k]) this.ui.openPanel(PanelKey[k]);
      else if (k === 'escape') this.ui.openSettings();
    };
    window.addEventListener('keydown', this._keyHandler);
  }

  _afterMove() {
    this.selected = { ...this.gs.heroPos };
    this.refresh();
    this._maybeBattleSwitch();
    this._appendLog();
  }

  _maybeBattleSwitch() {
    if (this.d.topState === 'COMBAT') this.ui.showBattle();
  }

  _subscribe() {
    const on = (ev, fn) => this.unsubs.push(EventBus.on(ev, fn));
    on(GE.EXPLORE_NEW_DAY, () => this.refresh());
    on(GE.EXPLORE_AP_CHANGE, () => this._refreshTopbar());
    on(GE.HEALTH_CHANGE, (p) => { this._refreshTopbar(); if (p.runFailed) this.ui.runFailed(); });
    on(GE.GOLD_CHANGE, () => this._refreshTopbar());
    on(GE.EXPLORE_MOVE, () => this.refresh());
    on(GE.BUILD_TILE, () => this.refresh());
    on(GE.BUILD_FACILITY, () => this.refresh());
    on(GE.UI_PANEL_OPEN, (p) => {
      if (p.panel === 'buildMode') { this.ex.buildMode = p.open; this._refreshBuildBar(); this._refreshMap(); }
    });
    on(GE.EXPLORE_LOG, (e) => { if (e.channel === 'explore') this._appendLogEntry(e.entry); });
    on(GE.ITEM_TOAST, () => this._refreshTopbar());
  }

  _appendLog() { this._appendLogEntry(null); }
  _appendLogEntry(entry) {
    const box = document.getElementById('actionLog');
    if (!box) return;
    if (!entry) { clear(box); GameLog.list('explore').slice(-30).forEach((e2) => this._appendLogEntry(e2)); return; }
    const line = h('div.log-line.' + entry.kind, { text: entry.text });
    box.append(line);
    box.scrollTop = box.scrollHeight;
  }
}
