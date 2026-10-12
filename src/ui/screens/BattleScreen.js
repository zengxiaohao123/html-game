/**
 * ui/screens/BattleScreen.js —— 战斗态界面（§4）
 *
 * 左我方 5 格 / 右敌方 5 格；敌人意图（图标+预估数值）；
 * 底部：主动技能按钮（1-4）+ 逃跑 + 元素手牌；连携 E 弹窗；战斗记录。
 */

import { h, clear } from '../dom.js';
import { CONFIG, ELEMENT_NAME } from '../../core/Const.js';
import { EventBus } from '../../core/EventBus.js';
import { GE } from '../../core/GameEvents.js';
import { getSkill } from '../../data/skills.js';
import { Assets } from '../../core/Assets.js';

export class BattleScreen {
  constructor(director, ui) {
    this.d = director; this.ui = ui;
    this.targetingSkill = null;
    this.unsubs = [];
    this.chainTimer = null;
  }
  get engine() { return this.d.combat; }
  get S() { return this.engine.S; }

  render(root) {
    clear(root);
    this.root = root;
    root.append(
      h('div.battle-wrap', {}, [
        h('div.battle-stage', {}, [
          h('div.side-side.side-ally', {}, [
            h('div.side-title', { text: '我方' }),
            this._allyRow(),
            h('div.companion-bar#companionBar'),
          ]),
          h('div.battle-mid', {}, [
            h('div.round-info#roundInfo'),
            h('div.battle-vs', { text: 'VS' }),
          ]),
          h('div.side-side.side-enemy', {}, [
            h('div.side-title', { text: '敌方' }),
            this._enemyRow(),
          ]),
          this._chainLayer(),
        ]),
        this._hud(),
        h('div.battle-log#battleLog'),
      ]),
    );
    this._bindKeys();
    this._subscribe();
    this.refresh();
  }

  destroy() {
    this.unsubs.forEach((f) => f()); this.unsubs = [];
    if (this._keyHandler) window.removeEventListener('keydown', this._keyHandler);
    if (this.chainTimer) clearInterval(this.chainTimer);
  }

  // ---------- 阵地 ----------
  _enemyRow() {
    return h('div.row.enemy-row#enemyRow', {});
  }
  _allyRow() {
    return h('div.row.ally-row#allyRow', {});
  }

  _unitCard(u) {
    const isEnemy = u.side === 'enemy';
    const card = h('div.unit-card.side-' + u.side + (u.role === 'leader' ? '.leader' : '') + (u.role === 'companion' ? '.companion' : '') + (u.isSummon ? '.summon' : '') + (u.notEnemy ? '.residue' : ''), {
      dataset: { uid: u.uid, pos: u.pos },
      onClick: () => this._onUnitClick(u),
    }, [
      h('div.u-sprite' + (u.role === 'leader' ? '.hero-sprite' : ''), { style: { backgroundImage: this._spriteBg(u) } }, [
        (!u.sprite && u.role !== 'leader') ? h('span.u-glyph', { text: u.name.slice(0, 1) }) : null,
      ]),
      h('div.u-name', { text: u.name }),
      u.stats.maxHp != null ? h('div.u-hpbar', {}, [h('div.u-hpfill#hpfill-' + u.uid), h('span.u-hptxt#hptxt-' + u.uid)]) : null,
      h('div.u-shield#shield-' + u.uid),
      h('div.u-statuses#status-' + u.uid),
      isEnemy ? h('div.u-intent#intent-' + u.uid) : null,
      u.aura ? h('div.u-aura.el-' + u.aura + '#aura-' + u.uid, { text: ELEMENT_NAME[u.aura] }) : h('div.u-aura.placeholder#aura-' + u.uid),
    ]);
    return card;
  }

  /** 伤害/治疗飘字（挂在舞台层，避免随卡片重建被清掉） */
  _floatOn(uid, text, cls) {
    const stage = this.root && this.root.querySelector('.battle-stage');
    const card = document.getElementById('hpfill-' + uid)?.closest('.unit-card');
    if (!stage || !card) return;
    const s = stage.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    const el = h('span.floater.' + cls, { text });
    el.style.left = (c.left - s.left + c.width / 2) + 'px';
    el.style.top = (c.top - s.top + c.height * 0.28) + 'px';
    stage.append(el);
    setTimeout(() => el.remove(), 900);
  }

  _spriteBg(u) {
    if (u.role === 'leader') return `url("${Assets.IMG.character.hero}")`;
    const sp = u.sprite || '';
    if (sp.startsWith('slime.')) {
      const key = sp.split('.')[1];
      return Assets.IMG.slime[key] ? `url("${Assets.IMG.slime[key]}")` : 'none';
    }
    if (sp.startsWith('foe.')) {
      const key = sp.split('.')[1];
      return Assets.IMG.foe[key] ? `url("${Assets.IMG.foe[key]}")` : 'none';
    }
    return 'none';
  }

  refresh() {
    if (!this.root || !this.S) return;
    this._refreshRow('enemyRow', this.S.enemies(true));
    // 我方：占格单位（主角+召唤物），队友单独显示为小徽章
    this._refreshRow('allyRow', this.S.allies(true));
    this._refreshCompanions();
    document.getElementById('roundInfo').textContent = `第 ${this.S.round} 回合 · ${this.S.phase === 'player' ? '我方行动' : '敌方行动'}`;
    this._refreshSkills();
    this._refreshHand();
    this._refreshUses();
  }

  _refreshRow(rowId, units) {
    const row = document.getElementById(rowId);
    clear(row);
    const byPos = new Map(units.filter((u) => u.pos != null).map((u) => [u.pos, u]));
    for (let p = 0; p < CONFIG.BATTLE_ROW; p++) {
      const slot = h('div.battle-slot', { dataset: { pos: p } });
      const u = byPos.get(p);
      if (u) slot.append(this._unitCard(u));
      row.append(slot);
    }
    // 数值刷新
    for (const u of units) this._refreshUnit(u);
  }

  _refreshUnit(u) {
    if (u.stats.maxHp != null) {
      const fill = document.getElementById('hpfill-' + u.uid);
      const txt = document.getElementById('hptxt-' + u.uid);
      if (fill) fill.style.width = Math.max(0, (u.hp / u.stats.maxHp) * 100) + '%';
      if (txt) txt.textContent = `${u.hp}/${u.stats.maxHp}`;
    }
    const shield = document.getElementById('shield-' + u.uid);
    if (shield) { shield.textContent = u.shield > 0 ? `盾 ${u.shield}` : ''; shield.style.display = u.shield > 0 ? '' : 'none'; }
    const stBox = document.getElementById('status-' + u.uid);
    if (stBox) {
      clear(stBox);
      for (const st of u.statuses) {
        stBox.append(h('span.status-tag.st-' + st.category, {
          text: st.name || st.buffId + (st.stacks ? `×${st.stacks}` : ''),
        }));
      }
    }
    const aura = document.getElementById('aura-' + u.uid);
    if (aura) {
      if (u.aura) { aura.textContent = ELEMENT_NAME[u.aura]; aura.className = 'u-aura el-' + u.aura; }
      else { aura.textContent = ''; aura.className = 'u-aura placeholder'; }
    }
    const intent = document.getElementById('intent-' + u.uid);
    if (intent && u.side === 'enemy') this._renderIntent(intent, u);
  }

  _renderIntent(el, u) {
    clear(el);
    if (!u.alive) return;
    const it = u.intent;
    if (it?.controlled) {
      el.append(h('span.intent.ctrl', { text: it.controlled === 'freeze' ? '冻' : it.controlled === 'sleep' ? '睡' : '眩' }));
      return;
    }
    const skill = u.skills.find((s) => s.id === it?.skillId);
    if (!skill) return;
    const isAtk = skill.type === 'attack';
    let est = '';
    if (isAtk) {
      // 意图预估：只算施法方自身（不含目标抗性/减伤）
      const mult = this._estimateMultiplier(skill);
      const val = Math.round(u.stats.atk * mult);
      est = skill.charge ? '蓄力' : `${skill.effects.filter((e) => e.kind === 'damage').reduce((mx, e) => Math.max(mx, (e.multiplier || 0) * (e.hits || 1)), 0) ? `${(skill.effects.find((e) => e.kind === 'damage')?.hits || 1) > 1 ? `${skill.effects.find((e) => e.kind === 'damage').hits}*${val}` : val}` : ''}`;
    } else {
      est = '辅';
    }
    el.append(h('span.intent' + (isAtk ? '.atk' : '.sup'), { text: `${isAtk ? '攻' : '辅'} ${est}` }));
  }

  _estimateMultiplier(skill) {
    const d = skill.effects.find((e) => e.kind === 'damage');
    if (!d) return 0;
    return (d.multiplier || 1) * (d.hits || 1);
  }

  _refreshCompanions() {
    // 队友不占格，在我方阵地下方以头像徽章展示
    const box = document.getElementById('companionBar');
    if (!box) return;
    clear(box);
    for (const c of this.S.companions) {
      box.append(h('div.companion-chip', { title: c.name }, [
        h('b', { text: c.name }),
        h('small', { text: `攻 ${c.stats.atk}` }),
      ]));
    }
  }

  // ---------- HUD：技能 / 手牌 / 逃跑 ----------
  _hud() {
    return h('div.battle-hud', {}, [
      h('div.hand#handBar', {}),
      h('div.skill-bar#skillBar', {}),
      h('div.hud-side', {}, [
        h('button.flee-btn#fleeBtn', { text: '逃跑', onClick: () => this._flee() }),
        h('button.end-btn', { text: '结束回合 (Space)', onClick: () => this.engine.endPlayerPhase() }),
      ]),
    ]);
  }

  _refreshSkills() {
    const bar = document.getElementById('skillBar');
    clear(bar);
    const set = this.d.state.party.skillSet;
    set.active.forEach((skillId, i) => {
      const skill = getSkill(skillId);
      if (!skill) return;
      const owner = skill.owner === 'hero' ? this.S.leader : this.S.companions.find((c) => c.id === skill.owner);
      const uses = this.S.activeUses[skill.owner] ?? 0;
      const cd = this.S.cooldowns.get(skillId) ?? 0;
      const disabled = this.S.phase !== 'player' || uses < 1 || cd > 0;
      bar.append(h('button.skill-btn' + (disabled ? '.disabled' : '') + '.owner-' + skill.owner, {
        dataset: { skill: skillId, idx: i + 1 },
        onClick: () => this._pickSkill(skillId),
      }, [
        h('span.sk-key', { text: i + 1 }),
        h('span.sk-name', { text: skill.name }),
        h('span.sk-owner', { text: owner?.name || '' }),
        cd > 0 ? h('span.sk-cd', { text: `冷却${cd}` }) : null,
      ]));
    });
  }

  _refreshHand() {
    const hand = document.getElementById('handBar');
    clear(hand);
    hand.append(h('span.hand-title', { text: '元素手牌' }));
    if (!this.S.hand.length) hand.append(h('span.hand-empty', { text: '（空）' }));
    for (const el of this.S.hand) hand.append(h('span.hand-card.el-' + el, { text: ELEMENT_NAME[el] }));
  }

  _refreshUses() {
    document.getElementById('fleeBtn').classList.toggle('disabled', this.S.phase !== 'player');
  }

  _pickSkill(skillId) {
    const skill = getSkill(skillId);
    // 需要选目标：进入指示器模式；无目标增益直接对自身释放
    const needsTarget = skill.effects.some((e) =>
      ['damage', 'bounceDamage'].includes(e.kind) &&
      ['selected', 'selectedAndSide1'].includes(e.target?.select));
    if (needsTarget) {
      this.targetingSkill = skillId;
      this._markTargeting();
    } else {
      this._doCast(skillId, null);
    }
  }

  _markTargeting() {
    document.querySelectorAll('.skill-btn').forEach((b) => b.classList.toggle('targeting', b.dataset.skill === this.targetingSkill));
  }

  _onUnitClick(u) {
    if (this.targetingSkill && u.side === 'enemy') {
      const skill = getSkill(this.targetingSkill);
      this._doCast(this.targetingSkill, { side: u.side, pos: u.pos, uid: u.uid });
      this.targetingSkill = null;
      this._markTargeting();
    }
  }

  _doCast(skillId, target) {
    const skill = getSkill(skillId);
    const r = this.engine.castActive(skillId, skill.owner, target);
    if (!r.ok) { this._flashTip(r.msg); return; }
    this.refresh();
    if (r.autoEnd) setTimeout(() => { if (this.S.phase === 'player') this.engine.endPlayerPhase(); }, 450);
  }

  _flee() {
    const r = this.engine.tryFlee();
    if (!r) return;
    if (r.success) this.ui.finishBattle();
    else this.refresh();
  }

  // ---------- 连携 ----------
  _chainLayer() {
    return h('div.chain-layer#chainLayer');
  }
  _renderChain() {
    const layer = document.getElementById('chainLayer');
    clear(layer);
    this.S.chainQueue.forEach((c, i) => {
      const skill = getSkill(c.skillId);
      layer.append(h('div.chain-orb' + (i === 0 ? '.head' : ''), {
        text: i === 0 ? `E ${skill.name}` : skill.name,
        onClick: () => { if (i === 0) this.engine.castChain(); },
      }));
    });
  }

  // ---------- 输入 / 订阅 ----------
  _bindKeys() {
    this._keyHandler = (e) => {
      const k = e.key.toLowerCase();
      if (k === ' ') { e.preventDefault(); if (this.S.phase === 'player') this.engine.endPlayerPhase(); }
      else if (k === 'e') { if (this.S.chainQueue.length) { this.engine.castChain(); this.refresh(); } }
      else if (['1', '2', '3', '4'].includes(k)) {
        const id = this.d.state.party.skillSet.active[Number(k) - 1];
        if (id) this._pickSkill(id);
      }
    };
    window.addEventListener('keydown', this._keyHandler);
  }

  _subscribe() {
    const on = (ev, fn) => this.unsubs.push(EventBus.on(ev, fn));
    const rerender = () => this.refresh();
    on(GE.BATTLE_DAMAGE, (p) => {
      rerender();
      if (p && p.target && p.amount > 0 && !p.dodged && !p.blocked) {
        this._floatOn(p.target.uid, String(p.amount), p.isCrit ? 'crit' : 'dmg');
      }
    });
    on(GE.BATTLE_HEAL, (p) => { rerender(); if (p && p.uid && p.amount) this._floatOn(p.uid, '+' + p.real, 'heal'); });
    on(GE.BATTLE_SHIELD, rerender);
    on(GE.BATTLE_AURA, rerender);
    on(GE.BATTLE_SKILL, () => setTimeout(() => this.refresh(), 0));
    on(GE.BATTLE_INTENT, rerender);
    on(GE.BATTLE_ROUND, rerender);
    on(GE.BATTLE_REACTION, (p) => this._flashTip(`元素反应：${p.reaction}`));
    on(GE.BATTLE_CHAIN_PROMPT, () => this._renderChain());
    on(GE.BATTLE_LOG, (entry) => {
      const box = document.getElementById('battleLog');
      if (!box) return;
      box.append(h('div.blog-line.' + entry.kind, { text: entry.text }));
      box.scrollTop = box.scrollHeight;
    });
    on(GE.BATTLE_END, () => setTimeout(() => this.ui.finishBattle(), 900));
  }

  _flashTip(text) {
    const tip = h('div.battle-tip', { text });
    document.body.append(tip);
    setTimeout(() => tip.classList.add('show'), 10);
    setTimeout(() => { tip.classList.remove('show'); setTimeout(() => tip.remove(), 300); }, 1100);
  }
}
