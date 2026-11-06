// src/ui/TopBar.js
// 顶部 UI 区（设计文档 §16.7，2026-11-06 修订版）：左上角三段式 + 生物容量顶部居中
//
//   ┌─ 左上半透明 HUD 根（pointer-events:none，整屏覆盖，不拦截地图）──────────┐
//   │  ┌────┐  ♥ 100 ▮▮▮▮▮▮▮    ← 第一段：立绘 + 生命 + 攻击 + 行动力
//   │  │ 竖 │  ⚔ 10
//   │  │ 框 │  ◆◆◆◆◆◆◆◆ 5/8
//   │  └──余默┘
//   │  ╭── 主牌：左「2 年 / 12月 28日」│ 右「周日 / 第 224 天」──╮   ← 第二段（木框 + 米黄内衬）
//   │   ┆（木钉） （木钉）┆
//   │  ╰── 🪙 999999 ─────╯                        ← 金币胶囊副牌，悬挂在主牌下方
//   │  (📋)                                          ← 第三段（再往下一点，独立一块）
//   └──────────────────────────────────────────────────────────────┘
//
//  · 三段不共用底板、不在同一行（§16.7）。
//  · 生物容量移到屏幕顶部居中（§16.7），超载变红缓慢闪烁规则保留。
//  · 基准 1280×720，其它分辨率按 --hud-scale 等比缩放（transform，等比不挤压）。
//  · 木牌 / 菱形水晶 / 分段血条 / 头像框属于「UI 组件绘制」：CSS 描边 + 纹理 + 光影，
//    不是美术素材占位；后续换正式 PNG 时只替换背景层、布局数值不动。
//  · 全区域不做持续呼吸 / 浮动动画（用户既有约束）；只有容量超载红闪保留。
//
// z-index 80：层级顺序 = 面板(5000+) > HUD(80) > 地图(≤50)。
// 任何新打开的面板（背包 / 商店 / 角色 / 编队 / 合成 / 载具 / 图鉴 / 信息区）都会遮挡
// 左上角 HUD 与顶部容量条；HUD 仍在地图元素之上，任务块/容量条照常可点。
// （右上功能区、底部快捷栏是独立层，仍按 §16.21 在商店内可见，≥5500。）

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { Assets } from '../core/Assets.js';
import { CHARACTERS } from '../data/characters.js';
import { createEl, qs, iconEl } from './dom.js';
import { renderStamina } from './staminaGems.js';

/** 血条分段数（§16.7 分段、倾斜、红→绿均匀渐变） */
const HP_SEGMENTS = 7;

/** 星期显示名（§6.1：周一为一周之始） */
const WEEK_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/** 基准分辨率（其它分辨率按此等比缩放） */
const BASE_W = 1280;
const BASE_H = 720;
const SCALE_MIN = 0.8;
const SCALE_MAX = 1.5;

export class TopBar {
  constructor() {
    this.root = null;          // 整屏 HUD 根（z-index 80，低于所有面板）
    this.left = null;          // 左上角三段容器
    this.taskIconEl = null;    // 任务块（独立一块，§16.7 / §16.17）

    this.atkText = null;
    this.hpText = null;        // 红心内数字
    this.hpLabel = null;       // 红心（title = 当前/最大）
    this.hpSegs = [];          // 分段血条填充层
    this.stamGems = [];
    this.stamWrap = null;
    this.staminaText = null;

    this.friendlyText = null;
    this.dangerText = null;
    this.extremeText = null;

    this.yearText = null;

    this.weekText = null;
    this.dayText = null;
    this.goldText = null;
    this.nameText = null;

    this.gs = null;
    this._onResize = null;
  }

  mount(gs, parent = qs('#app')) {
    this.gs = gs;
    this._applyScale();
    this._bindResize();

    // 整屏根：不拦截鼠标，可点元素各自 pointer-events:auto
    this.root = createEl('div', {
      class: ['top-bar'],
      style: {
        position: 'absolute', inset: '0',
        pointerEvents: 'none', zIndex: 80,
        fontFamily: '"LXGW WenKai TC", "Microsoft YaHei", sans-serif',
      },
      parent,
    });

    // ── 生物容量：屏幕顶部居中（§16.7，超载红闪）──
    const center = createEl('div', { class: ['hud-center'], parent: this.root });
    const centerInner = createEl('div', { class: ['hud-center-inner'], parent: center });
    const capBar = createEl('div', { class: ['hud-capacity'], parent: centerInner });
    this.friendlyText = this._buildCapItem(capBar, '#4fae3f', '友善');
    createEl('div', { class: ['hud-cap-div'], parent: capBar });
    this.dangerText   = this._buildCapItem(capBar, '#e67e22', '危险');
    createEl('div', { class: ['hud-cap-div'], parent: capBar });
    this.extremeText  = this._buildCapItem(capBar, '#c0392b', '高危');

    // ── 左上角三段 ──
    this.left = createEl('div', { class: ['hud-left'], parent: this.root });

    this._buildHeroGroup();
    this._buildSign();
    this._buildTask();

    this._renderAll();
    this._subscribeEvents();
    return this.root;
  }

  // ════════════════════════════════════════════════════════════
  // 第一段：立绘 + 生命值 + 攻击力 + 行动力（§16.7）
  // ════════════════════════════════════════════════════════════
  _buildHeroGroup() {
    const hero = createEl('div', { class: ['hud-hero-group'], parent: this.left });

    // 细边竖向矩形立绘框（2026-11-06 四次修订：72×96，比上一版 76×102 再收小一圈）：
    //   · 框体是独立背景层（z-index 0），立绘绘制在它之上（z-index 2）→ 人物可出血、压住边框
    //   · 双层描边：近黑粗描边 + 奶白内线，四角圆度不一致，整体轻旋
    //   · 框底只比行动力行底部略低几像素（不整体下沉）
    const portrait = createEl('div', {
      class: ['hud-portrait'],
      attrs: { title: '当前出战角色' },
      parent: hero,
    });
    createEl('div', { class: ['hud-portrait-frame'], parent: portrait });
    // 立绘占位：主角小人模型（= assets/images/characters/hero.png），后续换正式立绘只改这张图
    createEl('img', {
      class: ['hud-portrait-img'],
      attrs: { src: Assets.getIcon('ui', 'player') || 'assets/images/characters/hero.png', alt: '' },
      parent: portrait,
    });
    // 姓名牌：小号浅米底铭牌，压在立绘框右下外沿（右缘大致对齐框右缘、整体略偏下）
    this.nameText = createEl('div', {
      class: ['hud-nameplate'],
      text: '余默',
      parent: portrait,
    });

    // 右侧三行（2026-11-06 修订：生命在上、攻击在下）
    const stats = createEl('div', { class: ['hud-stats'], parent: hero });

    // 1) 生命值：红心 + 倾斜分段血条（短段红 → 均匀渐变 → 长段绿）
    const hpRow = createEl('div', { class: ['hud-hp'], parent: stats });
    this.hpLabel = createEl('div', { class: ['hud-heart'], attrs: { title: '生命值' }, parent: hpRow });
    createEl('div', { class: ['hud-heart-core'], parent: this.hpLabel });
    createEl('span', { class: ['hud-heart-shine'], parent: this.hpLabel });
    this.hpText = createEl('span', { class: ['hud-heart-num'], text: '', parent: this.hpLabel });

    const bar = createEl('div', { class: ['hud-hpbar'], attrs: { title: '生命值' }, parent: hpRow });
    this.hpSegs = [];
    for (let i = 0; i < HP_SEGMENTS; i++) {
      const seg = createEl('div', { class: ['hud-hpbar-seg'], parent: bar });
      // 颜色自左向右从红(4°) 均匀过渡到绿(92°)；幂次让"红段短、绿段长"
      const hue = 4 + 88 * Math.pow(i / (HP_SEGMENTS - 1), 1.6);
      const fill = createEl('div', {
        class: ['hud-hpbar-fill'],
        style: {
          background: `linear-gradient(180deg, hsl(${hue}, 86%, 63%), hsl(${hue}, 82%, 47%) 58%, hsl(${hue}, 78%, 38%))`,
          transitionDelay: `${i * 32}ms`,
        },
        parent: seg,
      });
      this.hpSegs.push(fill);
    }

    // 2) 攻击力：武器图标（用户明确允许此处用 ⚔️ 作图标）+ 数值（字号略小）
    const atkRow = createEl('div', { class: ['hud-atk'], parent: stats });
    createEl('span', { class: ['hud-atk-icon'], text: '⚔️', attrs: { title: '攻击力' }, parent: atkRow });
    this.atkText = createEl('span', { class: ['hud-num', 'hud-atk-num'], text: '', attrs: { title: '攻击力' }, parent: atkRow });

    // 3) 行动力：菱形水晶 × 上限数（8 颗）+ 数值
    const stamRow = createEl('div', { class: ['hud-stam'], parent: stats });
    this.stamWrap = createEl('div', { class: ['hud-stam-gems'], attrs: { title: '行动力' }, parent: stamRow });
    this.staminaText = createEl('span', { class: ['hud-num', 'hud-stam-num'], text: '', attrs: { title: '行动力' }, parent: stamRow });

    this._renderStaminaGems();
  }

  // ════════════════════════════════════════════════════════════
  // 第二段：双牌结构（§16.7）
  //   主牌 = 撕页台历：顶部装订条（3 颗装订钉）+ 深红月份色带（左「年」右「月」）
  //         + 纸页中央大号「日」数字 + 页脚「星期」（左）与弱化「第 N 天」印记（右）
  //   副牌 = 主牌下方两根小木钉悬挂的独立胶囊金币铭牌（徽章在左、大号数字在右）
  //   两块牌水平正放，不做 rotate / skew
  // ════════════════════════════════════════════════════════════
  _buildSign() {
    const sign = createEl('div', { class: ['hud-sign'], parent: this.left });

    // 主牌：撕页台历（装订条 / 月份色带 / 大数字 / 页脚三项），整体水平正放
    const main = createEl('div', { class: ['hud-sign-main'], parent: sign });
    const sheet = createEl('div', { class: ['hud-sign-sheet'], parent: main });
    const bind = createEl('div', { class: ['hud-sign-bind'], parent: sheet });
    for (let i = 0; i < 3; i++) createEl('i', { parent: bind });
    // 月份色带：年份弱、月份强（都属"日历上的点"，同处一条抬头带）
    const band = createEl('div', { class: ['hud-sign-band'], parent: sheet });
    this.yearText = createEl('span', { class: ['hud-sign-year'], text: '', parent: band });
    this.monthNum = createEl('span', { class: ['hud-sign-month'], text: '', attrs: { title: '月份' }, parent: band });
    // 纸页主体：只放「日」——日历上最大的永远是当天数字
    const dayWrap = createEl('div', { class: ['hud-sign-bigday'], parent: sheet });
    this.dayNum = createEl('span', { class: ['hud-sign-bigday-num'], text: '', attrs: { title: '日期' }, parent: dayWrap });
    // 页脚：星期（左）+ 第 N 天（右，弱化成印记）
    const foot = createEl('div', { class: ['hud-sign-foot'], parent: sheet });
    this.weekText = createEl('span', { class: ['hud-sign-week'], text: '', parent: foot });
    this.dayText = createEl('span', { class: ['hud-sign-dayno'], text: '', parent: foot });

    // 两根小木钉（连接主牌与金币副牌）
    const pegs = createEl('div', { class: ['hud-sign-pegs'], parent: sign });
    createEl('div', { class: ['hud-sign-peg'], parent: pegs });
    createEl('div', { class: ['hud-sign-peg'], parent: pegs });

    // 副牌：金币胶囊铭牌（徽章在左、数字在右，宽度随位数自动变宽，至少容纳 6 位）
    const coin = createEl('div', { class: ['hud-sign-coin'], parent: sign });
    createEl('div', { class: ['hud-sign-coin-inner'], parent: coin });
    const coinRow = createEl('div', { class: ['hud-sign-coin-row'], parent: coin });
    coinRow.appendChild(iconEl('ui', 'gold', { size: '34px', cls: 'hud-gold-icon', fallback: Assets.ui.gold }));
    this.goldText = createEl('span', { class: ['hud-sign-gold'], text: '', attrs: { title: '金币' }, parent: coinRow });
  }

  // ════════════════════════════════════════════════════════════
  // 第三段：任务图标（独立一块，不与前两段共用底板）
  // ════════════════════════════════════════════════════════════
  _buildTask() {
    this.taskIconEl = createEl('div', {
      class: ['hud-task'],
      attrs: { title: '任务（J 切换）' },
      onclick: () => {
        EventBus.emit(GE.UI_PANEL_OPEN, { panel: 'task' });
        EventBus.emit(GE.TASK_OPEN, {});
      },
      parent: this.left,
    });
    this.taskIconEl.appendChild(iconEl('ui', 'task', { size: '48px', fallback: '📋' }));
  }

  /** 容量条目：彩点 + 弱标签 + 强数值（数值 span 承担超载红闪） */
  _buildCapItem(parent, color, label) {
    const item = createEl('div', { class: ['hud-cap-item'], parent });
    createEl('span', { class: ['hud-cap-dot'], style: { background: color }, parent: item });
    createEl('span', { class: ['hud-cap-label'], text: label, parent: item });
    return createEl('span', { class: ['hud-cap-num'], text: '', parent: item });
  }

  // ════════════════════════════════════════════════════════════
  // 渲染
  // ════════════════════════════════════════════════════════════
  _renderAll() {
    if (!this.gs) return;
    const p = this.gs.player;
    const c = this.gs.capacity;
    const creatures = this.gs.creatures || [];

    const friendlyNow = creatures.filter(x => x.kind && x.kind.includes('chick')).length;
    const dangerNow   = creatures.filter(x => x.kind && x.kind.includes('slime')).length;
    const extremeNow  = 0;

    if (this.atkText) this.atkText.textContent = `${Math.floor(p.atk)}`;

    // 生命：红心内数字 + 分段血条填充比例
    if (this.hpText) this.hpText.textContent = `${p.hp}`;
    if (this.hpLabel) {
      this.hpLabel.title = `生命值 ${p.hp}/${p.maxHp}`;
      if (this.hpText) this.hpText.title = `生命值 ${p.hp}/${p.maxHp}`;
    }
    this._renderHpBar(p.hp, p.maxHp);

    // 行动力：大/小菱形水晶（纯函数 renderStamina 计算展示形态）+ 数值（负数保留负号）
    this._renderStaminaGems();

    if (this.friendlyText) this.friendlyText.textContent = `${friendlyNow}/${c.friendly}`;
    if (this.dangerText)   this.dangerText.textContent   = `${dangerNow}/${c.danger}`;
    if (this.extremeText)  this.extremeText.textContent  = `${extremeNow}/${c.extreme}`;

    applyOverload(this.friendlyText, friendlyNow, c.friendly);
    applyOverload(this.dangerText,   dangerNow,   c.danger);
    applyOverload(this.extremeText,  extremeNow,  c.extreme);

    // 日期体系（§6.1）：纸页大数字 = 日，「月」在抬头色带、「年」弱在色带左端，
    // 页脚左侧星期、右侧「第 N 天」印记 —— 全部为实时文本节点
    const cal = this.gs.calendar || {};
    if (this.monthNum) this.monthNum.textContent = cal.month ? `${cal.month}月` : '';
    if (this.dayNum)   this.dayNum.textContent   = cal.dayOfMonth ? `${cal.dayOfMonth}` : '';
    if (this.yearText) this.yearText.textContent = cal.year ? `${cal.year} 年` : '';
    if (this.weekText) this.weekText.textContent = WEEK_NAMES[(cal.weekday || 0) - 1] || '';
    if (this.dayText)  this.dayText.textContent  = `第 ${this.gs.day} 天`;
    if (this.goldText) this.goldText.textContent = `${p.gold}`;

    if (this.nameText) {
      const g = this.gs.team?.groups?.[this.gs.team?.activeGroup ?? 0];
      const roleId = g?.roles?.[0];
      this.nameText.textContent = (roleId && CHARACTERS[roleId]?.name) || '余默';
    }
  }

  /** 分段血条：每段按比例点亮，短段红 → 均匀渐变 → 长段绿 */
  _renderHpBar(hp, maxHp) {
    if (!this.hpSegs.length) return;
    const r = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
    const segFill = r * HP_SEGMENTS;
    this.hpSegs.forEach((fill, i) => {
      const lit = Math.max(0, Math.min(1, segFill - i));
      fill.style.width = `${lit * 100}%`;
    });
  }

  /**
   * 行动力水晶展示（§5.1 / §16.7）：
   *   · 纯函数 renderStamina(cap, current) 给出大/小 + 蓝/黄/白/红的完整视图模型
   *   · 大蓝 → 大黄 → 小蓝 → 小黄 → 白 的顺序渲染；负数为 红 → 白
   *   · 每次按数值重算 DOM（黄色小水晶被消耗即消失，不保留白位）
   */
  _renderStaminaGems() {
    if (!this.stamWrap || !this.gs) return;
    const cap = Math.max(0, Math.floor(this.gs.player.maxStamina ?? 8));
    const current = Math.floor(this.gs.player.stamina ?? 0);
    const view = renderStamina(cap, current);

    while (this.stamWrap.firstChild) this.stamWrap.removeChild(this.stamWrap.firstChild);
    this.stamGems = view.gems.map((g) => createEl('span', {
      class: ['hud-gem', `hud-gem--${g.color}`, ...(g.size === 'big' ? ['hud-gem--big'] : [])],
      parent: this.stamWrap,
    }));

    if (this.staminaText) {
      this.staminaText.textContent = `${current}/${cap}`;
      this.staminaText.title = `行动力 ${current}/${cap}`;
    }
    this.stamWrap.title = `行动力 ${current}/${cap}`;
  }

  // ════════════════════════════════════════════════════════════
  // 等比缩放（基准 1280×720）
  // ════════════════════════════════════════════════════════════
  _applyScale() {
    if (typeof window === 'undefined') return;
    const w = window.innerWidth || BASE_W;
    const h = window.innerHeight || BASE_H;
    const s = Math.max(SCALE_MIN, Math.min(SCALE_MAX, Math.min(w / BASE_W, h / BASE_H)));
    const root = document.documentElement;
    if (root?.style?.setProperty) root.style.setProperty('--hud-scale', String(s));
  }

  _bindResize() {
    if (typeof window === 'undefined' || !window.addEventListener) return;
    this._onResize = () => this._applyScale();
    window.addEventListener('resize', this._onResize);
  }

  _subscribeEvents() {
    // BOOT（新游戏启动 / startNewGame）和 STATE_RESET（读档/手动重置）都要更新 this.gs 引用
    // GameDirector.start() 会同时 emit BOOT + STATE_RESET，这里双保险
    EventBus.on(GE.BOOT,        ({ gs }) => { this.gs = gs; this._renderAll(); });
    EventBus.on(GE.STATE_RESET, ({ gs }) => { this.gs = gs; this._renderAll(); });
    EventBus.on(GE.STAMINA_CHANGE,    () => this._renderAll());
    EventBus.on(GE.HP_CHANGE,         () => this._renderAll());
    EventBus.on(GE.ATK_CHANGE,        () => this._renderAll());
    EventBus.on(GE.STAT_CHANGE,       () => this._renderAll());
    EventBus.on(GE.DAY_START,         () => this._renderAll());
    EventBus.on(GE.CAPACITY_CHANGE,   () => this._renderAll());
    EventBus.on(GE.CREATURE_SPAWNED,  () => this._renderAll());
    EventBus.on(GE.CREATURE_DEFEATED, () => this._renderAll());
    EventBus.on(GE.GOLD_CHANGE,       () => this._renderAll());
    EventBus.on(GE.TURN_ADVANCE,      () => this._renderAll());
    EventBus.on(GE.TEAM_CHANGE,       () => this._renderAll());
  }
}

/** §16.7 容量超载：数值变红 + 缓慢闪烁（class 定义在 ui.css） */
function applyOverload(el, now, cap) {
  if (!el) return;
  const over = now > cap;
  el.style.color = over ? '#c0392b' : '#4a3a2a';
  el.classList.toggle('overload-blink', over);
}

export default TopBar;
