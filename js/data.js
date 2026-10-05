// ============================================================
// data.js —— 游戏核心数据定义（重写版）
// 所有数据以 docs/ 下的规格文档为准
// ============================================================

window.GAME_DATA = (() => {

    // ===== 元素系统 =====
    const ELEMENTS = {
        physical: { id: 'physical', name: '物理', color: '#888888' },
        fire:     { id: 'fire',     name: '火',   color: '#ff6b35' },
        water:    { id: 'water',    name: '水',   color: '#4dabf7' },
        grass:    { id: 'grass',    name: '草',   color: '#51cf66' },
        thunder:  { id: 'thunder',  name: '雷',   color: '#c77dff' },
        ice:      { id: 'ice',      name: '冰',   color: '#b2f2bb' },
        wind:     { id: 'wind',     name: '风',   color: '#5bc9c9' },
        rock:     { id: 'rock',     name: '岩',   color: '#d4a373' }
    };

    // ===== 地形定义 =====
    const TERRAINS = {
        default: { id: 'default', name: '无地形', passable: true,  alwaysAttach: null,  icon: null, color: '#3a3a3a' },
        river:   { id: 'river',   name: '河流',   passable: false, alwaysAttach: 'water', icon: null, color: '#1e3a5f', lethalOnForceEnter: true },
        grass:   { id: 'grass',   name: '草地',   passable: true,  alwaysAttach: 'grass', icon: null, color: '#2d5a2d' },
        ice:     { id: 'ice',     name: '冰面',   passable: true,  alwaysAttach: 'ice',   icon: null, color: '#7fb3d5', slideOnFootMove: true }
    };

    // ===== 状态效果 =====
    const STATUS_EFFECTS = {
        fire_attach:    { id: 'fire_attach',    element: 'fire',    type: 'attach', name: '火附着', duration: 2 },
        water_attach:   { id: 'water_attach',   element: 'water',   type: 'attach', name: '水附着', duration: 2 },
        grass_attach:   { id: 'grass_attach',   element: 'grass',   type: 'attach', name: '草附着', duration: 2 },
        thunder_attach: { id: 'thunder_attach', element: 'thunder', type: 'attach', name: '雷附着', duration: 2 },
        ice_attach:     { id: 'ice_attach',     element: 'ice',     type: 'attach', name: '冰附着', duration: 2 },
        wind_attach:    { id: 'wind_attach',    element: 'wind',    type: 'attach', name: '风附着', duration: 2 },
        rock_attach:    { id: 'rock_attach',    element: 'rock',    type: 'attach', name: '岩附着', duration: 2 },
        burning:        { id: 'burning',        name: '燃烧',     type: 'debuff', description: '每回合受到 20% 攻击力火伤', duration: 3, tick: { damageRatio: 0.2, element: 'fire' } },
        wet:            { id: 'wet',            name: '潮湿',     type: 'debuff', description: '冷却时间减半（最少 1）',   duration: 2 },
        bloom_field:    { id: 'bloom_field',    name: '绽放结界', type: 'buff',   description: '每回合对周围 4 格造成 30% 攻击力草伤', duration: 2, tick: { damageRatio: 0.3, element: 'grass', aoe: 'surround4' } },
        freeze:         { id: 'freeze',         name: '冻结',     type: 'debuff', description: '无法移动 2 回合',            duration: 2 },
        electrocuted:   { id: 'electrocuted',   name: '感电',     type: 'debuff', description: '每回合受到 30% 攻击力雷伤', duration: 2, tick: { damageRatio: 0.3, element: 'thunder' } },
        wind_mark:      { id: 'wind_mark',      name: '风追标记', type: 'mark',   description: '受风元素反应时追加 40% 风伤', duration: 1 },
        crystallize:    { id: 'crystallize',    name: '结晶',     type: 'buff',   description: '受到伤害 20% 转化为护盾',    duration: 2, shieldRatio: 0.2 }
    };

    // ===== 元素附着地块效果 =====
    const ELEMENT_CELL_EFFECTS = {
        fire:    { applyToUnit: (u) => { if (u.status?.burning) u.status.burning.tickMultiplier = 2; }, bgColor: '#8b2500' },
        water:   { applyToUnit: (u) => { if (u.status?.burning) delete u.status.burning; },          bgColor: '#1a5276' },
        ice:     { applyToUnit: (u) => { if (u.status?.burning) delete u.status.burning; },          bgColor: '#5dade2' },
        grass:   { applyToUnit: () => {}, bgColor: '#1e8449' },
        thunder: { applyToUnit: () => {}, bgColor: '#6c3483' },
        wind:    { applyToUnit: () => {}, bgColor: '#16a085' },
        rock:    { applyToUnit: (u) => { const b = Math.max(1, Math.floor(u.def * 0.2)); u.cellDefBonus = (u.cellDefBonus || 0) + b; }, bgColor: '#7d6608' }
    };

    // ===== 敌人数据 =====
    function _buildSlime(element, name, opts = {}) {
        const baseMaxHp = 100;
        const isRock = element === 'rock';
        const affinId = element + 'Affinity';
        return {
            id: 'slime_' + element,
            name,
            faction: 'enemy',
            element,
            atk: 10,
            def: isRock ? 10 : 0,
            maxHp: isRock ? Math.floor(baseMaxHp * 0.9) : baseMaxHp,
            speed: 4,
            resist: { physical: 0, fire: 0, water: 0, grass: 0, thunder: 0, ice: 0, wind: 0, rock: 0 },
            attackType: 'physical',
            innateTalents: [
                { id: 'beginnerFriend', name: '新手之友', day1To12: { maxHp: -60 } },
                { id: affinId, name: element + '元素亲和', immuneElement: element, moveAttach: element },
                ...(opts.talents || [])
            ],
            immunities: opts.immunities || [],
            moveLogic: 'hopClockwise',
            defaultAttack: { atkRatio: 1.0, type: 'physical' },
            skills: opts.skills || []
        };
    }

    const ENEMIES = {
        slime_grass: _buildSlime('grass', '草史莱姆', {
            skills: [{ id: 'breakground', name: '破土而出', type: 'attack', desc: '瞬移到最近我方周围 4 格随机 1 格，对周围 4 格造成 75% 攻击力的草伤', atkRatio: 0.75, element: 'grass', aoe: 'surround4', teleport: true }]
        }),
        slime_fire: _buildSlime('fire', '火史莱姆', {
            talents: [{ id: 'selfdestruct', name: '自爆', desc: '死亡留下"即将爆炸的火史莱姆"（不算敌人），2 回合后对周围 9 格造成 120% 攻击力火伤，不分敌我', explosionRound: 2, atkRatio: 1.2, element: 'fire', aoe: 'surround9' }]
        }),
        slime_water: _buildSlime('water', '水史莱姆', {
            skills: [{ id: 'waterbubble', name: '水泡', type: 'assist', desc: '对目标当前格投水泡，下回合开始禁锢该格 2 回合。冷却 4', effect: 'bubble_restrain', duration: 2, cooldown: 4, noMoveAfterUse: true }]
        }),
        slime_thunder: _buildSlime('thunder', '雷史莱姆', {
            talents: [{ id: 'conduct', name: '导电', desc: '每回合结束 10% 概率对周围 5 格造成 40% 攻击力的雷伤（不分敌我）', trigger: 'end_of_round', prob: 0.1, atkRatio: 0.4, element: 'thunder', aoe: 'surround5' }],
            immunities: ['electrocuted']
        }),
        slime_ice: _buildSlime('ice', '冰史莱姆', {
            skills: [{ id: 'icefog', name: '冰雾', type: 'attack', desc: '对前方 3 格造成 80% 攻击力冰伤。持续 2 回合期间无法移动/攻击，冷却 5', atkRatio: 0.8, element: 'ice', aoe: 'front3', duration: 2, selfDebuff: 'unable_to_move_or_attack', cooldown: 5 }],
            immunities: ['freeze']
        }),
        slime_wind: _buildSlime('wind', '风史莱姆', {
            talents: [{ id: 'windvortex', name: '风旋', desc: '被击败时若战斗未结束，将 2 格内随机 1 格单位传送至自身格；我方额外 40% 攻击力风伤', trigger: 'on_defeat', atkRatio: 0.4, element: 'wind', teleport: true, range: 2 }]
        }),
        slime_rock: _buildSlime('rock', '岩史莱姆', {
            talents: [{ id: 'rockshield', name: '岩盾', desc: '最大生命值 -10%（即 90），防御 +10。每次被攻击防御 -1', maxHpPenalty: 0.1, defBonus: 10, defDecayOnHit: 1 }]
        })
    };

    // ===== 战斗关卡 =====
    const BATTLE_STAGES = {
        slime_time: {
            id: 'slime_time', name: '史莱姆时间', contentType: 'battle',
            spawnPointCount: 1, spawnRounds: 3,
            enemyPool: ['slime_grass', 'slime_fire', 'slime_water', 'slime_thunder', 'slime_ice', 'slime_wind', 'slime_rock'],
            reward: { items: [{ key: 'fruit', count: 3 }], upgradeChoice: 2 },
            healthPenaltyOnDefeat: 1
        },
        slime_rampage: {
            id: 'slime_rampage', name: '史莱姆暴走！', contentType: 'emergency',
            spawnPointCount: 3, spawnRounds: 3, spawnAvoidOverlap: true,
            enemyPool: ['slime_grass', 'slime_fire', 'slime_water', 'slime_thunder', 'slime_ice', 'slime_wind', 'slime_rock'],
            reward: { items: [{ key: 'fruit', count: 3 }, { key: 'wood', count: 1 }, { key: 'flax', count: 1 }], upgradeChoice: 3 },
            healthPenaltyOnDefeat: 1
        }
    };

    const ITEMS = {
        fruit: { id: 'fruit', name: '果子', desc: '日常食用材料', stackable: true },
        wood:  { id: 'wood',  name: '木材', desc: '基础建造材料', stackable: true },
        flax:  { id: 'flax',  name: '亚麻', desc: '基础纺织材料', stackable: true }
    };

    // ===== 元素反应表 =====
    const ELEMENT_REACTIONS = {
        'fire+water':     { id: 'vaporize',   name: '蒸发',     atkRatio: 1.5, effect: 'clear_all' },
        'fire+grass':     { id: 'bloom',      name: '绽放',     atkRatio: 1.0, effect: 'create_bloom' },
        'fire+thunder':   { id: 'overload',   name: '超载',     atkRatio: 2.0, effect: 'aoe_surround4' },
        'fire+ice':       { id: 'melt',       name: '融化',     atkRatio: 1.0, effect: 'clear_ice' },
        'water+thunder':  { id: 'electrocute',name: '感电',     atkRatio: 1.0, effect: 'apply_electrocuted' },
        'water+grass':    { id: 'bloom_spawn',name: '绽放·生',  atkRatio: 0.5, effect: 'create_bloom' },
        'water+ice':      { id: 'freeze',     name: '冻结',     atkRatio: 1.0, effect: 'apply_freeze' },
        'thunder+wind':   { id: 'wind_thunder',name: '风雷',    atkRatio: 1.0, effect: 'pierce_def' },
        'thunder+rock':   { id: 'crystallize_th', name: '结晶·雷', atkRatio: 0.5, effect: 'create_crystal' },
        'ice+wind':       { id: 'wind_chase', name: '风追',     atkRatio: 1.0, effect: 'apply_wind_mark' },
        'ice+grass':      { id: 'frozen_grass',name: '冰草',    atkRatio: 0.5, effect: 'clear_grass' },
        'rock+fire':      { id: 'crystallize_fi',name: '结晶·火',atkRatio: 0.5, effect: 'create_crystal' },
        'rock+water':     { id: 'crystallize_wa',name: '结晶·水',atkRatio: 0.5, effect: 'create_crystal' }
    };

    function getReaction(e1, e2) {
        return ELEMENT_REACTIONS[e1 + '+' + e2] || ELEMENT_REACTIONS[e2 + '+' + e1] || null;
    }

    // ===== 回字形地图方向辅助 =====
    function getClockwiseStep(w, h, x, y) {
        if (y < h - 1 && x === 0)     return { x: 0, y: y + 1 };
        if (x < w - 1 && y === h - 1) return { x: x + 1, y: h - 1 };
        if (y > 0 && x === w - 1)     return { x: w - 1, y: y - 1 };
        if (x > 0 && y === 0)         return { x: x - 1, y: 0 };
        return null;
    }

    function getCounterClockwiseStep(w, h, x, y) {
        if (y > 0 && x === 0)         return { x: 0, y: y - 1 };
        if (x > 0 && y === h - 1)     return { x: x - 1, y: h - 1 };
        if (y < h - 1 && x === w - 1) return { x: w - 1, y: y + 1 };
        if (x < w - 1 && y === 0)     return { x: x + 1, y: 0 };
        return null;
    }

    function isOnOuterRing(w, h, x, y) {
        return x === 0 || y === 0 || x === w - 1 || y === h - 1;
    }

    return {
        ELEMENTS, TERRAINS, STATUS_EFFECTS,
        ELEMENT_CELL_EFFECTS, ENEMIES, BATTLE_STAGES, ITEMS,
        ELEMENT_REACTIONS, getReaction,
        getClockwiseStep, getCounterClockwiseStep, isOnOuterRing
    };
})();