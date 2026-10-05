// ============================================================
// rules.js —— 游戏规则引擎（重写版）
// 规格参考：docs/02-核心概念.md、docs/03-战斗系统.md、docs/04-探索与地图.md
// ============================================================

window.RULES = (() => {

    const DATA = window.GAME_DATA;
    const MAP  = window.MAP;

    // ===== 移动判定 =====
    function canMoveTo(map, unit, tx, ty, options = {}) {
        const { fromVehicle = false, forcedEnter = false } = options;
        const cell = map.cellAt(tx, ty);
        if (!cell) return { ok: false, reason: 'out_of_bounds' };
        if (cell.unit && cell.unit !== unit) return { ok: false, reason: 'occupied' };
        if (cell.terrain === 'river' && !forcedEnter) {
            return { ok: false, reason: 'river_blocked' };
        }
        return { ok: true };
    }

    // ===== 河流强制进入处理 =====
    function handleRiverEnter(map, unit, isMainCharacter, forcedEnter = false) {
        const cell = map.cellAt(unit.x, unit.y);
        if (!cell || cell.terrain !== 'river') return null;
        if (!isMainCharacter) {
            unit.hp = 0;
            unit.isDead = true;
            return { type: 'unit_death', unit };
        }
        return { type: 'main_defeat', unit };
    }

    // ===== 冰面滑动 =====
    function processIceSlide(map, unit, dir, isMainCharacter, fromVehicle = false) {
        if (!isMainCharacter || fromVehicle) return null;
        const cell = map.cellAt(unit.x, unit.y);
        if (!cell || cell.terrain !== 'ice') return null;
        const [dx, dy] = dir;
        const nextCell = map.cellAt(unit.x + dx, unit.y + dy);
        if (!nextCell || !nextCell.passable || nextCell.unit) return null;
        return { dx, dy };
    }

    // ===== 防御获取（含地块岩元素加成） =====
    function getEffectiveDefense(unit) {
        const baseDef = unit.def || 0;
        const bonus = unit.cellDefBonus || 0;
        return Math.min(99999, Math.max(0, baseDef + bonus));
    }

    // ===== 伤害计算 =====
    function calcDamage({ attacker, defender, baseAtk, atkRatio = 1.0, element = 'physical', fromStatus = false, cellMultiplier = 1.0 }) {
        const atkValue = Math.floor(baseAtk * atkRatio);
        const finalAtk = Math.floor(atkValue * cellMultiplier);

        const resist = defender.resist ? (defender.resist[element] ?? 0) : 0;
        let afterResist = finalAtk;
        if (resist !== 0) afterResist = Math.floor(finalAtk * (1 - resist));

        let finalDamage = afterResist;
        if (!fromStatus) {
            const def = getEffectiveDefense(defender);
            finalDamage = Math.max(1, afterResist - Math.floor(def * 0.5));
        }

        return { rawAtk: finalAtk, resist, finalDamage: Math.max(1, finalDamage) };
    }

    // ===== 元素附着施加 =====
    function applyElementAttachToUnit(unit, element, duration = 2) {
        if (!unit.status) unit.status = {};
        unit.status[element + '_attach'] = { remaining: duration };
        const existingAttach = _findOtherAttach(unit, element);
        if (existingAttach) {
            const reaction = DATA.getReaction(existingAttach, element);
            if (reaction) return { reaction, newElement: element };
        }
        return null;
    }

    function _findOtherAttach(unit, excludeElement) {
        if (!unit.status) return null;
        for (const key of Object.keys(unit.status)) {
            if (key.endsWith('_attach')) {
                const e = key.replace('_attach', '');
                if (e !== excludeElement) return e;
            }
        }
        return null;
    }

    // ===== 元素反应处理 =====
    function resolveReaction(map, reaction, attacker, defender, baseDamage) {
        const result = { reaction: reaction.name, damage: 0, effects: [] };

        switch (reaction.effect) {
            case 'clear_all':   _clearAllAttaches(defender); break;
            case 'clear_ice':   _clearAttach(defender, 'ice'); break;
            case 'clear_grass': _clearAttach(defender, 'grass'); break;
            case 'aoe_surround4': {
                const cells = MAP.getAreaCells(map, defender.x, defender.y, 'surround4');
                for (const c of cells) {
                    if (c.unit && c.unit !== defender) {
                        const dmg = calcDamage({ attacker, defender: c.unit, baseAtk: attacker.atk, atkRatio: reaction.atkRatio });
                        c.unit.hp -= dmg.finalDamage;
                        result.effects.push({ target: c.unit.id, damage: dmg.finalDamage });
                    }
                }
                break;
            }
            case 'create_bloom':     _applyStatus(defender, 'bloom_field'); break;
            case 'apply_electrocuted': _applyStatus(defender, 'electrocuted'); break;
            case 'apply_freeze':     _applyStatus(defender, 'freeze'); break;
            case 'apply_wind_mark':  _applyStatus(defender, 'wind_mark'); break;
            case 'create_crystal':   _applyStatus(defender, 'crystallize'); break;
            case 'pierce_def':       break;
        }

        const primary = reaction.primaryElement || reaction.id.split('_')[0];
        const secondary = reaction.secondaryElement || '';
        // 清除所有附着（简化处理）
        _clearAllAttaches(defender);

        return result;
    }

    function _applyStatus(unit, statusId) {
        if (!unit.status) unit.status = {};
        const def = DATA.STATUS_EFFECTS[statusId];
        if (def) unit.status[statusId] = { remaining: def.duration };
    }

    function _clearAttach(unit, element) {
        if (unit.status && unit.status[element + '_attach']) delete unit.status[element + '_attach'];
    }

    function _clearAllAttaches(unit) {
        if (!unit.status) return;
        for (const key of Object.keys(unit.status)) {
            if (key.endsWith('_attach')) delete unit.status[key];
        }
    }

    // ===== 地块元素效果对单位的应用 =====
    function applyCellElementEffects(map, unit) {
        const cell = map.cellAt(unit.x, unit.y);
        if (!cell || !cell.attach) return;
        const effect = DATA.ELEMENT_CELL_EFFECTS[cell.attach];
        if (effect && effect.applyToUnit) effect.applyToUnit(unit);
    }

    // ===== 状态效果 tick =====
    function tickStatusEffects(unit, attacker = null) {
        const results = [];
        if (!unit.status) return results;

        for (const [statusId, state] of Object.entries(unit.status)) {
            const def = DATA.STATUS_EFFECTS[statusId];
            if (!def) continue;
            if (def.tick && attacker) {
                const dmg = calcDamage({
                    attacker, defender: unit,
                    baseAtk: attacker.atk,
                    atkRatio: def.tick.damageRatio,
                    element: def.tick.element,
                    fromStatus: true
                });
                unit.hp -= dmg.finalDamage;
                results.push({ statusId, damage: dmg.finalDamage });
            }
            state.remaining--;
            if (state.remaining <= 0) delete unit.status[statusId];
        }
        return results;
    }

    function onTurnStart(map) {
        MAP.refreshAlwaysAttach(map);
    }

    function getCellBgColor(cell) {
        const terrain = DATA.TERRAINS[cell.terrain];
        const baseColor = terrain.color;
        if (cell.attach) {
            const effect = DATA.ELEMENT_CELL_EFFECTS[cell.attach];
            if (effect && effect.bgColor) return effect.bgColor;
        }
        return baseColor;
    }

    return {
        canMoveTo, handleRiverEnter, processIceSlide,
        calcDamage, applyElementAttachToUnit, resolveReaction,
        applyCellElementEffects, tickStatusEffects, getEffectiveDefense,
        onTurnStart, getCellBgColor
    };
})();