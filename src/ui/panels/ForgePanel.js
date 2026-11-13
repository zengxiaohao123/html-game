// ForgePanel.js —— 第 5 批 UI 对齐（§16.13 合成页面）  ·  快捷键 F
// 布局：非全屏占中央大半；顶部 tab（总览/设施/资源/地形/产物/道具，无技能——技能不可合成）
//   左 2/3：可合成物品图标格（无文字，iconEl 渲染）
//   右上（2/3 高）：选中物品图标、名字、当前数量、描述、合成所需材料
//   右下（1/3 高）：滑动条（0~可合成数）+「合成」按钮
// 配方来自 ForgeSystem.getAllRecipes()，字段 ingredients / outputs（复数）
// 合成调 ForgeSystem.craft(gs, recipeId)，含巧手返原材料
// 材料检查调 ForgeSystem.canCraft(gs, recipeId)

import { EventBus } from '../../core/EventBus.js';
import { GE } from '../../core/GameEvents.js';
import { ITEMS } from '../../data/items.js';
import { ForgeSystem } from '../../systems/ForgeSystem.js';
import { InventorySystem } from '../../systems/InventorySystem.js';
import { createStandardPanel } from './_panelHelper.js';
import { createEl, iconEl } from '../dom.js';
import { renderTraitBadges } from '../TraitBadges.js';
import { renderTermText } from '../TermText.js';
import { devLog } from '../../core/Logger.js';

function itName(id) { return ITEMS[id]?.name || id; }

/** 按物品库归类取 iconEl 的 group（参考数据 tier1/tier2） */
function iconGroupOf(itemId) {
  const d = ITEMS[itemId];
  if (d?.tier2 === '田块' || d?.tier2 === '设施') return 'facilities';
  if (d?.tier2 === '资源') return 'resources';
  if (d?.tier1 === '地形') return 'terrains';
  return 'items';
}

/** 配方主产出物品定义（归类 / 展示以第一个产出为准） */
function recipeOutDef(r) { return ITEMS[r.outputs?.[0]?.itemId] || null; }

/** §16.13：无「技能」tab —— 技能不可合成 */
const TABS = [
  { id: 'all',      label: '总览', match: () => true },
  { id: 'field',    label: '田块', match: (d) => d?.tier2 === '田块' },
  { id: 'facility', label: '设施', match: (d) => d?.tier2 === '设施' },
  { id: 'resource', label: '资源', match: (d) => d?.tier2 === '资源' },
  { id: 'terrain',  label: '地形', match: (d) => d?.tier1 === '地形' },
  { id: 'product',  label: '产物', match: (d) => d?.tier1 === '产物' },
  { id: 'item',     label: '道具', match: (d) => d?.tier1 === '道具' },
];

export class ForgePanel {
  constructor(director) {
    this.director = director;
    this.helper = null;
    this.tabBarEl = null;
    this.tabBtns = [];
    this.listEl = null;
    this.detailEl = null;
    this.craftEl = null;
    this.selectedTabIdx = 0;
    this.selectedRecipeId = null;
    this.craftQty = 0;
  }

  mount() {
    this.helper = createStandardPanel({
      panelKey: 'forge',
      width: 'min(92vw, 820px)',
      height: 'min(86vh, 680px)',
      onMount: (_p, body) => this._build(body),
    });
    this._subscribe();
  }

  _build(body) {
    // 顶部 tab
    // 右上角 ✖ 浮在面板角上：tab 条右侧留出按钮宽度，避免首个内容行被遮住 / 点不到
    this.tabBarEl = createEl('div', { class: 'tab-bar', style: { paddingRight: '44px' }, parent: body });
    TABS.forEach((t, i) => {
      this.tabBtns.push(createEl('button', {
        class: ['tab-btn', i === 0 ? 'active' : ''],
        text: t.label, parent: this.tabBarEl,
        onclick: () => this._switchTab(i),
      }));
    });

    // 主区：左 2/3 图标格 + 右 1/3（右上详情 / 右下合成，行高约 2:1）
    const main = createEl('div', {
      style: { flex: '1', minHeight: '0', display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '10px' },
      parent: body,
    });
    this.listEl = createEl('div', {
      style: { padding: '10px', background: 'rgba(255,255,255,0.55)', border: '2px solid #b8a888', borderRadius: '12px', overflowY: 'auto' },
      parent: main,
    });
    const rightCol = createEl('div', {
      style: { display: 'flex', flexDirection: 'column', gap: '10px', minHeight: '0' },
      parent: main,
    });
    this.detailEl = createEl('div', {
      style: { flex: '2', minHeight: '0', overflowY: 'auto', padding: '12px', background: 'rgba(255,255,255,0.55)', border: '2px solid #b8a888', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '8px' },
      parent: rightCol,
    });
    this.craftEl = createEl('div', {
      style: { flex: '1', minHeight: '0', padding: '12px', background: 'rgba(255,255,255,0.55)', border: '2px solid #b8a888', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '8px', justifyContent: 'center' },
      parent: rightCol,
    });

    this._refresh();
  }

  _subscribe() {
    // 幂等显示：已显示只刷新内容，绝不 toggle 关闭（开新面板关旧面板由 GameDirector 中央处理）
    EventBus.on(GE.UI_PANEL_OPEN, ({ panel }) => {
      if (panel !== 'forge') return;
      if (this.helper?.visible) { this._refresh(); return; }
      this.helper?.show();
      this._refresh();
    });
    EventBus.on(GE.UI_PANEL_CLOSE, ({ panel }) => { if (panel === 'forge' && this.helper?.visible) this.helper.hide(); });
    EventBus.on(GE.INVENTORY_CHANGE, () => { if (this.helper?.visible) this._refresh(); });
  }

  _getGS() { return this.director?.getGS?.(); }

  _switchTab(idx) {
    if (idx < 0 || idx >= TABS.length) return;
    this.selectedTabIdx = idx;
    this.tabBtns.forEach((b, i) => (i === idx ? b.classList.add('active') : b.classList.remove('active')));
    // 选中配方若不在新 tab 内则清空选中
    const sel = this._selectedRecipe();
    if (sel && !TABS[idx].match(recipeOutDef(sel))) this.selectedRecipeId = null;
    this._refresh();
  }

  _selectedRecipe() {
    if (!this.selectedRecipeId) return null;
    return ForgeSystem.getAllRecipes().find(r => r.id === this.selectedRecipeId) || null;
  }

  /** 当前材料最多可合成数 */
  _maxCraftable(gs, r) {
    let n = Infinity;
    for (const ing of r.ingredients) {
      const have = gs ? InventorySystem.countItem(gs, ing.itemId) : 0;
      n = Math.min(n, Math.floor(have / Math.max(1, ing.qty)));
    }
    return Number.isFinite(n) ? n : 0;
  }

  _refresh() {
    if (!this.listEl) return;
    const gs = this._getGS();
    const tabDef = TABS[this.selectedTabIdx];
    const recipes = ForgeSystem.getAllRecipes().filter(r => tabDef.match(recipeOutDef(r)));

    // ── 左：可合成物品图标格（无文字） ──
    this.listEl.innerHTML = '';
    if (recipes.length === 0) {
      createEl('div', { style: { color: '#b0a090', fontSize: '13px', textAlign: 'center', padding: '40px 10px', fontStyle: 'italic' }, text: '该分类暂无可合成物品', parent: this.listEl });
    } else {
      const grid = createEl('div', {
        style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))', gap: '8px' },
        parent: this.listEl,
      });
      for (const r of recipes) {
        const outId = r.outputs?.[0]?.itemId;
        const ok = gs ? ForgeSystem.canCraft(gs, r.id) : false;
        const sel = this.selectedRecipeId === r.id;
        const slot = createEl('div', {
          style: {
            position: 'relative', aspectRatio: '1 / 1',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: sel ? '#ffe099' : 'rgba(255,255,255,0.75)',
            border: sel ? '3px solid #e8a900' : '2px solid #b8a888',
            borderRadius: '12px', cursor: 'pointer', opacity: ok ? 1 : 0.55,
          },
          attrs: { title: `${itName(outId)}（${r.name}）` },
          parent: grid,
        });
        slot.appendChild(iconEl(iconGroupOf(outId), outId, {
          size: '36px', def: ITEMS[outId] || undefined, fallback: ITEMS[outId]?.emoji || r.emoji || '❓',
        }));
        slot.addEventListener('click', () => {
          if (this.selectedRecipeId !== r.id) this.craftQty = 0; // 换选中配方 → 数量回默认
          this.selectedRecipeId = r.id;
          this._refresh();
        });
      }
    }

    // ── 右上：选中物品详情 ──
    this.detailEl.innerHTML = '';
    const r = this._selectedRecipe();
    if (!r) {
      createEl('div', { style: { color: '#b0a090', fontSize: '13px', textAlign: 'center', padding: '40px 10px', fontStyle: 'italic' }, text: '← 点击左侧图标查看合成详情', parent: this.detailEl });
    } else {
      const outId = r.outputs?.[0]?.itemId;
      const have = gs && outId ? InventorySystem.countItem(gs, outId) : 0;
      const topRow = createEl('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '2px solid #3a3a3a', paddingBottom: '6px' }, parent: this.detailEl });
      topRow.appendChild(iconEl(iconGroupOf(outId), outId, {
        size: '42px', def: ITEMS[outId] || undefined, fallback: ITEMS[outId]?.emoji || r.emoji || '❓',
      }));
      const nameCol = createEl('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' }, parent: topRow });
      createEl('div', { style: { fontSize: '16px', fontWeight: '900' }, text: itName(outId), parent: nameCol });
      createEl('div', { style: { fontSize: '12px', color: '#8a5a1a', fontWeight: '700' }, text: `当前数量 ×${have}`, parent: nameCol });
      // 合成产物详情：展示词条统一徽章入口
      renderTraitBadges(this.detailEl, ITEMS[outId]?.traits);
      // 合成产物描述：逐字取数据层，其中【术语】走统一行内术语组件
      renderTermText(this.detailEl, ITEMS[outId]?.description || r.description || '', {
        tag: 'div', style: { fontSize: '12px', color: '#8a7a66' },
      });

      createEl('div', { style: { fontSize: '12px', fontWeight: '700', color: '#5a4a3a', marginTop: '4px' }, text: '🧾 合成所需材料', parent: this.detailEl });
      r.ingredients.forEach((inp) => {
        const haveMat = gs ? InventorySystem.countItem(gs, inp.itemId) : 0;
        const enough = haveMat >= inp.qty;
        const row = createEl('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }, parent: this.detailEl });
        row.appendChild(iconEl(iconGroupOf(inp.itemId), inp.itemId, { size: '20px', def: ITEMS[inp.itemId] || undefined }));
        createEl('span', { text: `${itName(inp.itemId)} ×${inp.qty}`, parent: row });
        createEl('span', { style: { marginLeft: 'auto', color: enough ? '#2a8a3a' : '#c0392b', fontWeight: '800' }, text: `${haveMat} / ${inp.qty}`, parent: row });
      });
    }

    // ── 右下：滑动条（0~可合成数）+「合成」按钮 ──
    this.craftEl.innerHTML = '';
    if (!r) {
      createEl('div', { style: { color: '#b0a090', fontSize: '12px', textAlign: 'center', fontStyle: 'italic' }, text: '（未选中配方）', parent: this.craftEl });
      return;
    }
    const max = this._maxCraftable(gs, r);
    this.craftQty = Math.max(0, Math.min(this.craftQty || 1, max));

    const qtyLabel = createEl('div', { style: { textAlign: 'center', fontSize: '18px', fontWeight: '800', color: '#e8a900', lineHeight: '1' }, text: String(this.craftQty), parent: this.craftEl });
    // 第 10 批：滑动条统一用背包基准 .inv-action-slider（同类元素同一套尺寸语言）
    const slider = createEl('input', {
      class: ['inv-action-slider'],
      attrs: { type: 'range', min: 0, max: Math.max(0, max), value: this.craftQty },
      style: { width: '100%', cursor: 'pointer' },
      parent: this.craftEl,
    });
    const craftBtn = createEl('button', {
      class: 'action-btn',
      style: { alignSelf: 'center', padding: '6px 22px', fontSize: '14px' },
      text: `⚒️ 合成 ×${this.craftQty}`,
      parent: this.craftEl,
    });
    const syncQtyUI = () => {
      qtyLabel.textContent = String(this.craftQty);
      craftBtn.textContent = `⚒️ 合成 ×${this.craftQty}`;
      craftBtn.style.opacity = this.craftQty > 0 ? 1 : 0.6;
      slider.style.setProperty('--slider-percent',
        max > 0 ? `${(this.craftQty / max) * 100}%` : '0%');
    };
    slider.addEventListener('input', () => {
      this.craftQty = Number(slider.value) || 0;
      syncQtyUI();
    });
    syncQtyUI();
    craftBtn.addEventListener('click', () => this._craft());
  }

  _craft() {
    const gs = this._getGS();
    const r = this._selectedRecipe();
    if (!gs || !r) return;

    if (this.craftQty < 1) {
      // 走 ForgeSystem 统一提示「材料不足」
      ForgeSystem.craft(gs, r.id);
      return;
    }
    let okCount = 0;
    for (let i = 0; i < this.craftQty; i++) {
      const result = ForgeSystem.craft(gs, r.id);
      if (!result.ok) break;
      okCount++;
    }
    if (okCount > 0) devLog.info('[ForgePanel] FORGE_COMPLETE', r.id, '×', okCount);
    this.craftQty = 0;
    this._refresh();
  }

  show() { this.helper?.show(); this._refresh(); }
  hide() { this.helper?.hide(); }
}

export default ForgePanel;
