/* ============================================================
   js/data.js —— 模块：数据与常量
   角色 / 敌人 / 词条 / 元素 / 资源 / 常量 定义。
   本文件只做定义，被其它模块在运行时读取。
   注：这些 const / function 是经典全局，可被后续 script 直接使用。
   ============================================================ */
"use strict";

/* 存档位上限 */
const MAX_SAVES = 8;

/* 元素枚举（着色 class 与中文名） */
const ELEM = {fire:{c:'e-fire',zh:'火'},water:{c:'e-water',zh:'水'},grass:{c:'e-grass',zh:'草'},
  thunder:{c:'e-thunder',zh:'雷'},ice:{c:'e-ice',zh:'冰'},wind:{c:'e-wind',zh:'风'},rock:{c:'e-rock',zh:'岩'}};
const AURA_ELEMS = ['fire','water','grass','thunder','ice'];

/* 资源中文名（展示用） */
const RES_ZH = {wood:'木材', fruit:'果子', flax:'亚麻', rawMeat:'生肉', coin:'金币', emptyBottle:'空瓶子'};

/* 词条库（悬浮弹窗文案） */
const TERMS = {
  alert:'主角天赋【战术布置】产生。我方单位攻击时优先攻击该目标；场上至多存在1个；主角用单体攻击新敌人时覆盖旧目标。',
  charge:'敌人进行强力攻击前的准备状态。蓄力期间不移动、不改变朝向。受到我方任意攻击即被打断。',
  bind:'无法移动，但可以攻击。',
  burn:'每回合开始时流失2%生命值（可致死，没有伤害来源）。持续3回合。',
  aggro:'攻击力+15%；受到的雷元素伤害与草元素伤害+25%。持续2回合。',
  superconduct:'雷、冰、物理抗性均降低30%。持续3回合。抗性最终结算强制限定在0%~90%之间。',
  frozen:'无法行动（包括移动、攻击、蓄力等一切主动行为，不包括被动效果）。持续1回合。',
  cage:'无法行动。',
  zone:'技能形成的区域效果。持续时间内对范围内单位施加特定效果。',
  extraTurn:'许泠朦【秋水澄心】天赋触发。仅泠朦能释放技能，无移动。各类增益减益不计时。冷却不减少。',
  steal:'对方的数值减少，自身的数值对应增加。',
  dodge:'在敌人即将攻击前从攻击范围内撤出。',
};
function termHTML(key, zh){
  return `<span class="term" data-term="${key}" title="${TERMS[key]||zh}">【${zh}】</span>`;
}

/* 主角（当前唯一可控制单位） */
const PROTAGONIST = {
  key:'pro', name:'主角', element:null, color:null,
  base:{atk:10, maxHp:100, def:0, escapeSpeed:100, hp:100},
  passives:[
    {name:'战术布置', desc:'攻击时设置【重点目标】，我方优先攻击该目标。'},
    {name:'暴击', desc:'攻击力+10，暴击率+3%。'},
    {name:'嗜血', desc:'攻击力+20，攻击型技能3%概率回复自身=本次伤害的50%。'},
    {name:'起势', desc:'攻击力+30，使用攻击型技能后获得4%伤害加成。'},
    {name:'格挡', desc:'最大生命+50，受攻击3%概率本伤害归零。'},
    {name:'坚守', desc:'回合开始获得30护盾，受攻击6%概率回复12%生命。'},
  ],
  skills:[
    {id:'slash', name:'斩击', kind:'attack', type:'physical', range:1,
     effect:atk=>atk*1.00, target:'front', desc:'对前方一格的敌人造成相当于攻击力100%的物理伤害。'},
    {id:'blade', name:'万刃斩', kind:'attack', type:'physical', range:1,
     effect:atk=>atk*0.85, target:'adj', desc:'对周围四格的所有敌人造成相当于攻击力85%的物理伤害。'},
    {id:'despair', name:'拼命', kind:'attack', type:'physical', range:1,
     effect:atk=>atk*1.40, target:'front', selfDrain:0.20, desc:'对前方一格的敌人造成140%物理伤害，自身流失20%生命（可致死）。'},
    {id:'balance', name:'均衡', kind:'attack', type:'physical', range:1,
     effect:atk=>atk*0.70, target:'front', selfHeal:0.08, dr:0.40, desc:'对前方一格70%物理伤害，回复自身8%生命，本回合受伤害-40%。'},
    {id:'guerrilla', name:'游击', kind:'attack', type:'physical', range:2,
     effect:atk=>atk*0.70, target:'nearest', desc:'对两格距离内最近的一名敌人造成70%物理伤害。'},
  ],
  selectedSkillIds:['slash','blade','guerrilla']
};

/* 敌人库（临时占位，后续按规格书补齐） */
const ENEMIES = {
  slime:{name:'哥布林', icon:'👺', hp:40, atk:8, dmgReduc:0, speed:20,
    skillMult:1.2, failureHealthPenalty:5, color:'#c05bff'},
  bat:{name:'毒蛾', icon:'🦋', hp:30, atk:6, dmgReduc:0, speed:30,
    skillMult:1.1, failureHealthPenalty:4, color:'#5fd96b', aura:'grass'},
  wolf:{name:'岩狼', icon:'🐺', hp:55, atk:10, dmgReduc:0.1, speed:25,
    skillMult:1.3, failureHealthPenalty:6, color:'#b09a73'},
};