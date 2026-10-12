/**
 * ui/panels/Panels.js —— 全局面板渲染（§6.4 / §6.8）
 *
 * 纯渲染：数据来自 director.state，操作调用对应系统。
 */

import { h, clear, toast } from '../dom.js';
import { InvCategory, TopState } from '../../core/Const.js';
import { getItem, SHOP_ITEMS } from '../../data/items.js';
import { BUILDABLE_FACILITIES } from '../../data/facilities.js';
import { CraftSystem, ShopSystem } from '../../systems/ShopCraft.js';
import { recomputePermanent } from '../../systems/Permanent.js';
import { CHARACTERS } from '../../data/skills.js';
import { writeSave, listSaves, deleteSave, loadSettings, saveSettings } from '../../core/Storage.js';

const CAT_NAME = {
  consumable: '消耗品', permanent: '永久道具', facility: '设施',
  quest: '任务道具', element: '元素', misc: '杂物',
};

export function renderPanel(name, d, ui) {
  const map = {
    inventory: panelInventory, craft: panelCraft, cook: panelCook,
    shop: panelShop, party: panelParty, character: panelCharacter,
    quest: panelQuest, settings: panelSettings, build: panelBuildHint,
  };
  const fn = map[name] || panelPlaceholder;
  const box = h('div.modal.paper.panel-modal', {});
  box.append(h('h2.panel-title', { text: TITLES[name] || name }));
  const body = h('div.panel-body');
  box.append(body);
  fn(body, d, ui);
  return box;
}

const TITLES = {
  inventory: '背包', craft: '合成', cook: '篝火烹饪', shop: '商店',
  party: '编队', character: '角色', quest: '任务', settings: '设置', build: '建造',
};

function panelPlaceholder(box) {
  box.append(h('p', { text: '该面板内容待补充。' }));
}

// ---------------- 背包（只读分类 + 使用） ----------------
function panelInventory(box, d, ui) {
  const inv = d.state.inventory;
  const readOnly = d.topState === TopState.COMBAT;
  if (readOnly) box.append(h('p.readonly-hint', { text: '战斗中背包为只读。' }));
  const cats = [InvCategory.CONSUMABLE, InvCategory.PERMANENT, InvCategory.FACILITY, InvCategory.MISC, InvCategory.QUEST, InvCategory.ELEMENT];
  for (const cat of cats) {
    const entries = inv.listByCategory(cat);
    // facilities 额外合并"可造但未拥有"
    const section = h('div.inv-section', {}, [h('h3', { text: CAT_NAME[cat] })]);
    const grid = h('div.inv-grid');
    for (const { id, count, def } of entries) {
      grid.append(_itemCard(def, count, () => {
        if (readOnly) return;
        if (def.use) _useItem(d, ui, id);
      }, cat === InvCategory.PERMANENT || cat === InvCategory.MISC));
    }
    if (cat === InvCategory.FACILITY) {
      for (const fac of BUILDABLE_FACILITIES) {
        const enough = inv.canAfford(fac.cost);
        grid.append(h('div.item-card.facility' + (enough ? '' : '.disabled'), {
          onClick: () => { if (enough) { d.explore.buildMode = true; ui.closePanel(); d.explore.toggleBuild(); toast('进入建造模式，选择地图位置', 'info'); } },
        }, [
          h('b', { text: fac.name }),
          h('small', { text: Object.entries(fac.cost).map(([m, n]) => `${getItem(m).name}×${n}`).join(' ') }),
          h('small', { text: fac.desc }),
        ]));
      }
    }
    section.append(grid);
    box.append(section);
  }
}

function _itemCard(def, count, onClick, noUse) {
  return h('div.item-card' + (noUse ? '' : '.usable'), { onClick, title: def.desc }, [
    h('b', { text: def.name }),
    h('span.item-count', { text: `×${count}` }),
    h('small', { text: def.desc }),
    def.literary ? h('small.text-literary', { text: def.literary }) : null,
  ]);
}

function _useItem(d, ui, id) {
  const def = getItem(id);
  const gs = d.state;
  if (!def.use) return;
  // 简化：实现果子/生肉/熟肉回复；明心浆/啤酒日级增益；赠礼
  if (def.use.healHp) {
    const before = gs.heroHp;
    gs.heroHp = Math.min(d.explore.heroMaxHp(), gs.heroHp + def.use.healHp);
    const real = gs.heroHp - before;
    if (def.use.healthChance && Math.random() < def.use.healthChance.p) d.explore.addHealth(def.use.healthChance.value, '食用果子');
    gs.inventory.remove(id, 1);
    toast(`回复 ${real} 点生命值`, 'good');
  } else if (def.use.grantBottle) {
    gs.ap = Math.min(gs.apMax + 99, gs.ap + def.use.ap);
    gs.inventory.add('bottle', def.use.grantBottle);
    if (def.use.dayBuffChance && Math.random() < def.use.dayBuffChance.p) {
      gs.dayBuffs.push({ buffId: 'beerAtk', value: def.use.dayBuffChance.atkPct, days: 1 });
      toast('攻击力提升（今日）', 'good');
    }
    if (def.use.anotherChance && Math.random() < def.use.anotherChance.p) gs.inventory.add(def.use.anotherChance.item, def.use.anotherChance.count);
    gs.inventory.remove(id, 1);
    toast(`行动力 +${def.use.ap}`, 'good');
  } else if (def.use.mental) {
    gs.party.addMental(def.use.mental);
    gs.heroHp = d.explore.heroMaxHp(); gs.ap = gs.apMax;
    gs.dayBuffs = gs.dayBuffs.filter((b) => b.buffId !== 'depression');
    gs.dayBuffs.push({ buffId: 'mingxinAtk', value: def.use.dayBuff.atkPct, days: 1 });
    gs.inventory.remove(id, 1);
    toast('明心见性！生命与行动力全满', 'good');
  } else if (def.use.giftAffinity) {
    toast('请在角色面板选择赠送对象', 'info');
  }
  recomputePermanent(gs);
  ui.closePanel(); ui.openPanel('inventory');
}

// ---------------- 合成 ----------------
function panelCraft(box, d, ui) {
  const gs = d.state;
  const list = CraftSystem.list();
  box.append(h('p', { text: '全部配方已解锁，可无限次合成。' }));
  const refresh = () => { ui.closePanel(); ui.openPanel('craft'); };
  for (const r of list) {
    const can = gs.inventory.canAfford(r.consume);
    box.append(h('div.recipe-row' + (can ? '' : '.disabled'), {}, [
      h('b', { text: r.name }),
      h('span', { text: Object.entries(r.consume).map(([m, n]) => `${getItem(m).name}×${n}`).join(' + ') }),
      h('span.arrow', { text: '→' }),
      h('b', { text: Object.entries(r.produce).map(([id, n]) => `${getItem(id).name}×${n}`).join() }),
      h('button.mini-btn', { text: '合成', onClick: () => { const res = CraftSystem.craft(gs, r.id, 1); toast(res.ok ? '合成成功' : res.msg, res.ok ? 'good' : 'bad'); if (res.ok) refresh(); } }),
    ]));
  }
  // 永久物品打造
  box.append(h('h3.sep', { text: '永久物品打造（成本递增）' }));
  for (const id of ['club', 'clothCloth', 'trap', 'quilt', 'ironSword', 'armor']) {
    const def = getItem(id);
    const times = gs.inventory.craftCount.get(id) ?? 0;
    const cost = CraftSystem.permanentCostAt(def, times);
    const can = gs.inventory.canAfford(cost);
    box.append(h('div.recipe-row' + (can ? '' : '.disabled'), {}, [
      h('b', { text: `${def.name}${times ? `（已造${times}）` : ''}` }),
      h('span', { text: Object.entries(cost).map(([m, n]) => `${getItem(m).name}×${n}`).join(' ') }),
      h('button.mini-btn', { text: '打造', onClick: () => { const res = CraftSystem.craftPermanent(gs, id); toast(res.ok ? '打造成功' : res.msg, res.ok ? 'good' : 'bad'); if (res.ok) refresh(); } }),
    ]));
  }
}

function panelCook(box, d, ui) {
  const gs = d.state;
  for (const r of CraftSystem.cookList()) {
    const can = gs.inventory.canAfford(r.consume);
    box.append(h('div.recipe-row' + (can ? '' : '.disabled'), {}, [
      h('b', { text: r.name }),
      h('span', { text: Object.entries(r.consume).map(([m, n]) => `${getItem(m).name}×${n}`).join(' + ') }),
      h('b', { text: Object.entries(r.produce).map(([id, n]) => `${getItem(id).name}×${n}`).join() }),
      h('button.mini-btn', { text: '烹饪', onClick: () => { const res = CraftSystem.cook(gs, r.id, 1); toast(res.ok ? '烹饪成功' : res.msg, res.ok ? 'good' : 'bad'); } }),
    ]));
  }
}

// ---------------- 商店 ----------------
function panelShop(box, d) {
  const gs = d.state;
  box.append(h('p', { text: `金币：${gs.inventory.gold}` }));
  for (const row of ShopSystem.list()) {
    const def = getItem(row.item);
    const owned = gs.inventory.count(row.item);
    box.append(h('div.shop-row', {}, [
      h('b', { text: def.name }),
      h('small', { text: def.desc }),
      h('span.shop-owned', { text: `持有 ${owned}` }),
      h('button.mini-btn.buy', { text: `买入 ${row.buy}金`, onClick: () => { const r = ShopSystem.buy(gs, row.item, 1); toast(r.ok ? '购买成功' : r.msg, r.ok ? 'good' : 'bad'); } }),
      h('button.mini-btn.sell' + (owned ? '' : '.disabled'), { text: `卖出 ${row.sell}金`, onClick: () => { const r = ShopSystem.sell(gs, row.item, 1); toast(r.ok ? '出售成功' : r.msg, r.ok ? 'good' : 'bad'); } }),
    ]));
  }
}

// ---------------- 编队 / 技能组 ----------------
function panelParty(box, d, ui) {
  const party = d.state.party;
  box.append(h('p', { text: '主角必须在队；队友需同行且羁绊≥1。整队共享技能组，主动技能至多 4 个。' }));
  const all = ['hero', 'xiayang', 'luyouyou'];
  for (const id of all) {
    const c = CHARACTERS[id];
    const inParty = party.has(id);
    const rel = id === 'hero' ? null : party.getRel(id);
    box.append(h('div.party-row' + (inParty ? '.in' : ''), {}, [
      h('b', { text: c.def.name + (id === 'hero' ? '（主角）' : '') }),
      rel ? h('small', { text: `好感 ${rel.affinity} · 羁绊 Lv.${rel.bond}　攻击 ${party.companionAtk(id)}` }) : h('small', { text: '主角' }),
      id === 'hero' ? h('span', { text: '固定入队' }) :
        h('button.mini-btn', { text: inParty ? '离队' : '入队', onClick: () => { inParty ? party.removeMember(id) : party.addMember(id); ui.closePanel(); ui.openPanel('party'); } }),
    ]));
  }
  _skillSetEditor(box, d, ui);
}

function _skillSetEditor(box, d, ui) {
  const party = d.state.party;
  const set = party.skillSet;
  box.append(h('h3.sep', { text: '技能组编辑（主动前，连携后；主动 ≤4）' }));
  const editor = h('div.skillset-editor');

  const pool = [];
  for (const id of party.members) {
    const c = CHARACTERS[id];
    c.actives.forEach((s) => pool.push({ skill: s, kind: 'active' }));
    c.chains.forEach((s) => pool.push({ skill: s, kind: 'chain' }));
  }

  const equipped = h('div.equipped', {}, [
    h('h4', { text: `已装备主动（${set.active.length}/4）` }),
    h('div.skill-tags', {}, set.active.map((sid) => {
      const s = pool.find((p) => p.skill.id === sid);
      return _skillTag(s?.skill || { name: sid }, true, () => { set.active = set.active.filter((x) => x !== sid); party.saveSkillSet(set); ui.closePanel(); ui.openPanel('party'); });
    })),
    h('h4', { text: '已装备连携' }),
    h('div.skill-tags', {}, set.chain.map((sid) => {
      const s = pool.find((p) => p.skill.id === sid);
      return _skillTag(s?.skill || { name: sid }, true, () => { set.chain = set.chain.filter((x) => x !== sid); party.saveSkillSet(set); ui.closePanel(); ui.openPanel('party'); });
    })),
  ]);

  const candidates = h('div.candidates', {}, [h('h4', { text: '候选技能（点击装备/卸下）' })]);
  const cg = h('div.skill-tags');
  for (const { skill, kind } of pool) {
    const isIn = kind === 'active' ? set.active.includes(skill.id) : set.chain.includes(skill.id);
    cg.append(_skillTag(skill, isIn, () => {
      if (kind === 'active') {
        if (isIn) set.active = set.active.filter((x) => x !== skill.id);
        else { if (set.active.length >= 4) return toast('主动技能至多 4 个', 'bad'); set.active.push(skill.id); }
      } else {
        if (isIn) set.chain = set.chain.filter((x) => x !== skill.id);
        else set.chain.push(skill.id);
      }
      party.saveSkillSet(set);
      ui.closePanel(); ui.openPanel('party');
    }));
  }
  candidates.append(cg);
  editor.append(equipped, candidates);
  box.append(editor);
}

function _skillTag(skill, active, onClick) {
  return h('button.skill-tag' + (active ? '.on' : ''), { title: skill.desc, onClick }, [
    h('b', { text: skill.name }),
    skill.desc ? h('small', { text: skill.desc }) : null,
  ]);
}

// ---------------- 角色 ----------------
function panelCharacter(box, d) {
  const party = d.state.party;
  for (const id of party.members) {
    const c = CHARACTERS[id];
    box.append(h('div.char-block', {}, [
      h('h3', { text: c.def.name + (id === 'hero' ? `　Lv.${party.heroLevel}（经验 ${party.heroXp}/${party.xpForNextLevel()}）` : `　羁绊 Lv.${party.bondLevel(id)}`) }),
      ...c.actives.map((s) => h('div.skill-line', {}, [h('b', { text: '【主动】' + s.name }), h('span', { text: s.desc })])),
      ...c.chains.map((s) => h('div.skill-line', {}, [h('b', { text: '【连携】' + s.name }), h('span', { text: `${s.desc}（冷却 ${s.cooldown}）` })])),
      ...c.talents.map((t) => h('div.skill-line.talent', {}, [h('b', { text: '【天赋】' + t.name }), h('span', { text: t.desc })])),
    ]));
  }
}

// ---------------- 任务（占位，框架） ----------------
function panelQuest(box) {
  box.append(h('p', { text: '当前没有进行中的任务。剧情与任务内容将在后续版本接入。' }));
}

function panelBuildHint(box, d, ui) {
  box.append(h('p', { text: '按 Q 进入/退出建造模式，在底部 hotbar 选择地块或设施，点击视野内位置放置。' }));
  box.append(h('button.mbtn', { text: '切换建造模式 (Q)', onClick: () => { d.explore.toggleBuild(); ui.closePanel(); } }));
}

// ---------------- 设置 / 存档 ----------------
function panelSettings(box, d, ui) {
  const saves = listSaves();
  box.append(h('h3.sep', { text: '存档（1 号为自动存档）' }));
  const grid = h('div.save-grid');
  saves.forEach((s) => {
    grid.append(h('div.save-card' + (s.empty ? '.empty' : ''), {}, [
      h('div.save-no', { text: s.slot === 0 ? '自动' : `槽 ${s.slot}` }),
      h('div.save-day', { text: s.empty ? '空' : `第 ${s.day} 天 · ${s.label}` }),
      h('div.save-actions', {}, [
        s.slot !== 0 && d.state ? h('button.mini-btn', { text: '保存', onClick: () => { d.manualSave(s.slot); toast('已保存', 'good'); ui.closePanel(); ui.openPanel('settings'); } }) : h('span', { text: '' }),
        !s.empty && s.slot !== 0 ? h('button.mini-btn.del', { text: '删除', onClick: () => { deleteSave(s.slot); ui.closePanel(); ui.openPanel('settings'); } }) : null,
      ]),
    ]));
  });
  box.append(grid);

  const st = loadSettings();
  box.append(h('h3.sep', { text: '音量' }));
  box.append(h('label', { text: `音乐 ${Math.round(st.bgmVolume * 100)}%` }));
  box.append(h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: st.bgmVolume, onChange: (e) => { st.bgmVolume = Number(e.target.value); saveSettings(st); } }));

  box.append(h('div.settings-actions', {}, [
    h('button.mbtn', { text: '返回标题（不存档）', onClick: () => { if (confirm('返回标题？未保存进度将丢失。')) ui.backToMenu(); } }),
  ]));
}
