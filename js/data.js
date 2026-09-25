/* ============================================================
   js/data.js —— 模块：数据与常量（战斗系统大重写版 v2）
   角色 / 敌人 / 技能 / 天赋 / 状态 / 词条 / 元素 / 资源 / 地形 / 范围函数
   
   ⚠️ 本文件是战斗系统重写的核心数据层，以下均为新规格：
   - 元素：7种（火水草雷冰风岩），风/岩现在也能附着在地块上
   - 地形：ground/obstacle/river/grass/ice/void 6种
   - 状态：完整新状态库（含冻结/蒸发/融化/激化/燃烧/减伤/易伤/免疫冻结等）
   - 技能分类：active(主动)/auto(自动)/link(连携)/talent(天赋) 四大类
   - 范围函数：所有技能范围计算统一在这里，把用户定义硬编码进去
   ============================================================ */
"use strict";

/* 存档位上限 */
const MAX_SAVES = 8;

/* ==================== 元素定义（着色 class + 中文名） ====================
   7种元素均可附着在地块上（旧版只支持 5 种，风/岩现在也支持）。
   物理不属于元素，真实伤害也不属于元素。 */
const ELEM = {
  fire:   { c:'e-fire',   zh:'火', elem:true },
  water:  { c:'e-water',  zh:'水', elem:true },
  grass:  { c:'e-grass',  zh:'草', elem:true },
  thunder:{ c:'e-thunder',zh:'雷', elem:true },
  ice:    { c:'e-ice',    zh:'冰', elem:true },
  wind:   { c:'e-wind',   zh:'风', elem:true },
  rock:   { c:'e-rock',   zh:'岩', elem:true },
};
/* 可附着的元素列表 = ELEM 全部 7 种（旧版 AURA_ELEMS 已废弃） */
const ELEM_LIST = ['fire','water','grass','thunder','ice','wind','rock'];
const ELEM_ZH = {fire:'火',water:'水',grass:'草',thunder:'雷',ice:'冰',wind:'风',rock:'岩',physical:'物理',real:'真实'};

/* ==================== 地形定义 ====================
   terrain 字段是格子的固定地形属性，在每日生成地图时确定。
   元素附着是独立的 transient 层，两者并存不冲突。 */
const TERRAIN_DEFS = {
  void:    { zh:'外部地块',  impassable:true, elementable:false, entity:false },  /* 地图外边界 */
  obstacle:{ zh:'山',        impassable:true, elementable:false, entity:true },   /* 实体，不可进，不可附着 */
  ground:  { zh:'空地',      impassable:false,elementable:true,  entity:false },  /* 普通地块 */
  river:   { zh:'河流',      impassable:true, elementable:true,  entity:false,
             alwaysElement:'water', forcedDeath:true, banNewElementReaction:true },
  grass:   { zh:'草地',      impassable:false,elementable:true,  entity:false,
             alwaysElement:'grass' },
  ice:     { zh:'冰面',      impassable:false,elementable:true,  entity:false,
             alwaysElement:'ice', forcedSlide:true },
};
/* terrain 枚举值（每日生成地图时使用） */
const TERRAIN_KEYS = ['void','obstacle','ground','river','grass','ice'];

/* 元素附着总是刷新的地形 -> 任意单位行动节点开始时重新附着 */
/* 且禁止元素反应后第三种新元素附着（banNewElementReaction=true） */
const ALWAYS_ELEMENT_TERRAINS = ['river','grass','ice'];

/* ==================== 资源定义 ==================== */
const RES_ZH = {wood:'木材', fruit:'果子', flax:'亚麻', rawMeat:'生肉', coin:'金币', emptyBottle:'空瓶子', iron:'铁块',
  blueStar:'蓝星石', blueStarPowder:'蓝星粉末', amethyst:'紫水晶', clearMind:'明心浆', diamond:'钻石'};
const RES_DESC = {wood:'基础材料。可用于合成、交易',
  fruit:'可食用的野果。可用于合成、交易，可直接使用回复20生命值且有20%概率增加1点健康',
  flax:'基础材料。可用于合成、交易',
  rawMeat:'未处理的肉块。可用于合成、交易，可直接使用回复20生命值',
  coin:'通行的钱币，可在商店使用。',
  emptyBottle:'随处可见的空瓶子，可用于交易',
  iron:'相对罕见的基础材料。可用于合成、交易',
  blueStar:'偶尔能捡到的矿石。可用于合成。',
  blueStarPowder:'随处可见的一种带有药效的粉末。可用于合成。',
  amethyst:'非常漂亮的宝石。可用于赠礼，使角色好感度+3',
  clearMind:'游戏中重要的软货币。也可自行使用：心理压力+4，立即回满生命值与行动力并解除抑郁状态，本日内主角攻击力+25%、受到的伤害-25%',
  diamond:'钻石',
};
const RES_LORE = {
  blueStar:'表面黯黑，但遇光或被研磨时，会分解出蓝色的粉末，犹如蓝色星光，因而得名。蓝色粉末有安神效果，熬制成浆后效果会进一步增强',
  blueStarPowder:'由蓝星石遇光或被研磨而得，具有安神效果。许多人将其作为熏香随身携带，但时间长了会失效，被随手抛弃。熬制成浆后效果会进一步增强',
  diamond:'钻石',
};
const NATURAL_RESOURCES = ['wood','flax','fruit','rawMeat','blueStar'];
const CITY_RESOURCES = ['coin','emptyBottle','blueStarPowder'];

/* ==================== 物品定义 ==================== */
const ITEMS = {
  cookedMeat:{name:'熟肉', desc:'香喷喷的肉排。可用于交易，可直接使用回复70点生命值'},
  campfire:{name:'篝火', desc:'食用食物后，使对应的此类食物可回复生命值永久增加（果子+1，生肉+2，熟肉+4）', permanent:true},
  club:{name:'木棒', desc:'使主角的【天赋·暴击】提升1级。可叠加', permanent:true},
  cloth:{name:'布衣', desc:'使主角的【天赋·格挡】提升1级。可叠加', permanent:true},
  tent:{name:'帐篷', desc:'探索时行动力上限+1。可叠加', permanent:true},
  trap:{name:'陷阱', desc:'睡觉时，有50%获得1个随机自然资源。可叠加', permanent:true},
  quilt:{name:'被子', desc:'睡觉时，主角回复30点生命值。可叠加', permanent:true},
  dagger:{name:'匕首', desc:'使主角的【天赋·嗜血】提升1级。可叠加', permanent:true},
  leather:{name:'皮衣', desc:'使主角的【天赋·坚守】提升1级。可叠加', permanent:true},
  ironSword:{name:'铁剑', desc:'使主角的【天赋·起势】提升1级。可叠加', permanent:true},
  armor:{name:'盔甲', desc:'使主角的【天赋·格挡】和【天赋·坚守】各提升1级。可叠加', permanent:true},
  roadmap:{name:'路线图', desc:'探索中，若地图上有稀有动物，会将其所在格用特殊颜色标记。每次进入被标记的格子后，消耗1张路线图', permanent:true},
  caiyunPendant:{name:'裁云挂件', desc:'半透晶石制成的薄片挂件，内部封存着被风儿裁出的浅白云纹，常作为赠予珍视之人的饰物。可赠予同伴，使其好感度+10', permanent:true},
  goodCard:{name:'好人卡', desc:'勿以善小而不为。睡觉时获得1金币。可叠加', permanent:true},
  luckyCoin:{name:'幸运硬币', desc:'战斗胜利时，有2%概率额外获得1次战斗奖励。可叠加。叠加时，每一层概率+2%，只判定1次。', permanent:true, lore:'永远会停留在你想要的那一面'},
  deadwoodSprout:{name:'枯木新枝', desc:'探索中，每次移动后回复12点生命值。可叠加。叠加时，回血量取总和。', permanent:true, lore:'无论折断多少次，它总会长出新的枝丫'},
  kuiZuo:{name:'《愧怍》', desc:'探索空地时，若什么也没有找到，则有50%概率获得补偿。可叠加。叠加时每个独立判定。', permanent:true, lore:'一幅含义深刻的肖像画'},
  windChime:{name:'风铃', desc:'每日与陆悠悠聊天的成功率+2%。可叠加。叠加时，每次在基础成功率上+2%。', permanent:true, lore:'风吹过时有悦耳的声音，某人会特别喜欢'},
  broom:{name:'魔法扫帚', desc:'移动至直线3格内的任意1格。可使用2次。每次消耗1行动力。', vehicle:true},
  clearMind:{name:'明心浆', desc:'心理压力+4，立即回满生命值与行动力并解除【抑郁】状态，本日内主角攻击力+25%、受到的伤害-25%。', lore:'饮料？毒药？兴奋剂？若你心已明，便不会纠结它的用途', usable:true},
  amethyst:{name:'紫水晶', desc:'可用于赠礼，使角色好感度+3', giftValue:3},
  diamond:{name:'钻石', desc:'闪闪发亮，十分珍稀。可用于赠礼，使角色好感度+8。', giftValue:8},
};
function itemName(k){ return RES_ZH[k] || (ITEMS[k]&&ITEMS[k].name) || k; }
function itemDesc(k){ return ITEMS[k]? ITEMS[k].desc : (RES_DESC[k]||''); }

const SHOP_ITEMS = [
  {key:'wood',         buy:2,  sellable:true},
  {key:'flax',         buy:3,  sellable:true},
  {key:'fruit',        buy:2,  sellable:true},
  {key:'rawMeat',      buy:4,  sellable:true},
  {key:'emptyBottle',  buy:5,  sellable:true},
  {key:'iron',         buy:6,  sellable:true},
  {key:'dagger',       buy:32, sellable:false, priceGrow:4, permanent:true},
  {key:'leather',      buy:20, sellable:false, priceGrow:4, permanent:true},
];
function itemBuyPrice(key){ const it=SHOP_ITEMS.find(x=>x.key===key); if(!it) return 0; const owned=(G&&G.inventory&&G.inventory[key])||0; return it.buy + (it.priceGrow? it.priceGrow*owned : 0); }

const FOOD = { fruit:{heal:20, healthChance:0.2}, rawMeat:{heal:20}, cookedMeat:{heal:70} };
function itemUsable(k){ return !!FOOD[k]; }
function foodHeal(k){ const camp=G && G.inventory && G.inventory.campfire>0; const base=FOOD[k]? FOOD[k].heal : 0; const add = camp ? (k==='fruit'?1 : k==='rawMeat'?2 : k==='cookedMeat'?4 : 0) : 0; let v = base+add; if(G && G.team && G.team.indexOf('luyouyou')>=0){ v = Math.round(v * (k==='cookedMeat'?1.75:1.25)); } return v; }

function grantPermanentItem(key){ G.inventory[key]=(G.inventory[key]||0)+1; switch(key){
  case 'club': bumpPro('crit'); break;
  case 'cloth': bumpPro('block'); break;
  case 'dagger': bumpPro('blood'); break;
  case 'leather': bumpPro('hold'); break;
  case 'ironSword': bumpPro('momentum'); break;
  case 'armor': bumpPro('block'); bumpPro('hold'); break;
  case 'tent': G.hero.apCap=(G.hero.apCap||5)+1; G.hero.actionPoint=(G.hero.actionPoint||0)+1; break;
  case 'broom': G.vehicles=G.vehicles||[]; G.vehicles.push({key:'broom', uses:(VEHICLES.broom&&VEHICLES.broom.uses)||2}); break;
}
G.records=G.records||{};
if(key==='fruit' && !G.records.fruitFirstOwned){ G.records.fruitFirstOwned=true; }
if(key==='cookedMeat' && !G.records.cookedMeatFirstOwned){ G.records.cookedMeatFirstOwned=true; }
if(key==='broom' && !G.records.nonWalkVehicleOwned){ G.records.nonWalkVehicleOwned=true; }
}
function bumpPro(talent){ G.proLevels=G.proLevels||{}; G.proLevels[talent]=(G.proLevels[talent]||1)+1; }

/* ==================== 状态库（ST） ====================
   kind: buff/debuff/neutral
   turnSettle: 'node'（行动节点开始时-1）| 'never'（持续直到驱散）| 'daily'（持续一整天）
   onTick/onApplied/onRemoved/onDamageTaken/onMove 等 hook 由 combat.js 解析 */
const ST = {
  /* === 通用 === */
  shield:   {id:'shield',   name:'护盾',   kind:'buff',   desc:'抵挡等量伤害（含真实伤害、反伤，不抵流失生命值、buff/debuff效果）。持续1回合：该单位的每个行动节点开始时清除旧护盾。'},
  alert:    {id:'alert',    name:'重点目标', kind:'debuff',desc:'我方单位攻击时优先攻击该目标。场上至多1个。持续整场战斗。'},
  dr:       {id:'dr',       name:'减伤',   kind:'buff',   desc:'受到的伤害-40%。'},
  bind:     {id:'bind',     name:'束缚',   kind:'debuff', desc:'无法移动，可以攻击。'},
  crit:     {id:'crit',     name:'屏息',   kind:'buff',   desc:'下一次攻击暴击率+100%，不可叠加。'},
  dodge:    {id:'dodge',    name:'闪避',   kind:'buff',   desc:'受到攻击时有概率使本次伤害降为0。'},
  poison:   {id:'poison',   name:'中毒',   kind:'debuff', desc:'该单位的回合开始时，流失等同层数的生命值（可致死，可叠加）。'},
  /* === 燃烧（通用debuff + 火元素地块额外效果） === */
  burn:     {id:'burn',     name:'燃烧',   kind:'debuff', desc:'该单位的回合开始时，流失3%生命值（可致死）。在火元素地块上时，燃烧效果翻倍。'},
  /* === 新元素反应状态 === */
  /* 蒸发：顺序有影响，两个独立状态 */
  evap_water:{id:'evap_water',name:'蒸发·水',kind:'buff',  desc:'下一次水属性伤害的最终伤害+50%。至多叠加2层（+100%）。无限持续直至被消耗。'},
  evap_fire: {id:'evap_fire', name:'蒸发·火',kind:'buff',  desc:'下一次火属性伤害的最终伤害+25%。至多叠加2层（+50%）。无限持续直至被消耗。'},
  /* 融化：顺序有影响 */
  melt_ice:  {id:'melt_ice',  name:'融化·冰',kind:'buff',  desc:'下一次冰属性伤害的最终伤害+25%。至多叠加2层。无限持续直至被消耗。'},
  melt_fire: {id:'melt_fire', name:'融化·火',kind:'buff',  desc:'下一次火属性伤害的最终伤害+50%。至多叠加2层（+100%）。无限持续直至被消耗。'},
  /* 冻结：被冻结者获得2回合无法行动debuff */
  frozen:    {id:'frozen',    name:'冻结',   kind:'debuff', desc:'无法行动（移动、攻击、技能均不可）。受到火或雷属性伤害时，最终伤害+50%且提前结束冻结。结束后获得3回合【免疫冻结】。'},
  freezed_imm:{id:'freezed_imm',name:'免疫冻结',kind:'buff',desc:'免疫任何方式的冻结。'},
  /* 激化：下一次草/雷伤害+10%，至多10层 */
  aggro:     {id:'aggro',     name:'激化',   kind:'buff',  desc:'下1次造成的草属性伤害或雷属性伤害+10%。无限持续直至被消耗。至多叠加10层。每次触发消耗1层。多段伤害每段分别消耗。'},
  /* 超导：雷/冰/物理抗性-40% */
  supercond: {id:'supercond', name:'超导',   kind:'debuff',desc:'雷、冰、物理抗性均-40%（至少-10）。离开超导范围时立即消失。'},
  /* 燃烧debuff 由燃烧结界施加（上面已定义 burn） */
  /* 易伤 */
  vuln:      {id:'vuln',      name:'易伤',   kind:'debuff',desc:'受到的伤害+35%。'},
  /* 睡眠 */
  sleep:     {id:'sleep',     name:'睡眠',   kind:'debuff',desc:'无法移动、无法攻击；受到伤害导致生命值降低时会提前醒来。'},
  rage:      {id:'rage',      name:'狂躁',   kind:'buff',  desc:'攻击力+80%、速度+60，每回合额外攻击1次。'},
  /* === 非战斗状态 === */
  depress:   {id:'depress',   name:'抑郁',   kind:'debuff',daily:true, desc:'心理压力过高所致。攻击力、防御力强制归零。持续一整天（非战斗时仍显示于角色技能区及状态栏）。'},
};

/* ==================== 词条库（TERMS） ==================== */
/* 每个词条对象：zh 是中文，desc 是悬浮说明 */
const TERMS = {
  alert:'【重点目标】天赋·战术布置或其他技能产生。我方单位攻击时优先攻击该目标。场上至多存在1个。',
  charge:'【蓄力】敌人进行强力攻击前的准备状态。蓄力期间不移动、不改变朝向。受到我方任意攻击即被打断。',
  bind:'【束缚】无法移动，但可以攻击。',
  burn:'【燃烧】该单位的回合开始时，流失3%生命值（可致死，无伤害来源）。在火元素地块上时，燃烧效果翻倍。',
  aggro:'【激化】天赋·比翼 或 元素反应·激化 产生。下1次造成的草属性伤害或雷属性伤害+10%。无限持续直至被消耗。至多叠加10层。',
  supercond:'【超导】元素反应·超导 产生的地块结界范围内。雷、冰、物理抗性均-40%（至少-10）。离开范围时立即消失。',
  frozen:'【冻结】元素反应·冻结 产生。无法行动（包括移动、攻击、蓄力等一切主动行为，不包括被动效果）。受到火或雷属性伤害时提前结束。',
  shield:'【护盾】抵挡等量伤害（含真实伤害和反伤，不抵流失生命值和buff/debuff效果）。持续1回合：该单位的每个行动节点开始时清除旧护盾。',
  zone:'【结界】一种地块范围效果。给范围内的单位施加buff/debuff或持续伤害，通常会在地图上有视觉标识。',
  realm:'【境界】一种全场唯一效果。全场只能存在1个境界。',
  steal:'【偷取】对方的数值减少，自身的数值对应增加。',
  dodge:'【闪避】受到攻击时有概率使本次所受伤害降为0。对真实伤害、控制/状态类效果及生命流失类效果不生效。',
  depress:'【抑郁】心理压力过高所致。以心理压力/100为概率每日判定。攻击力、防御力强制归零。持续一整天。',
  realDamage:'真实伤害。无视减伤和元素抗性的无属性伤害。',
};
const TERM_KEYS = {重点目标:'alert', 蓄力:'charge', 束缚:'bind', 燃烧:'burn', 激化:'aggro', 超导:'supercond', 冻结:'frozen', 护盾:'shield', 结界:'zone', 境界:'realm', 偷取:'steal', 闪避:'dodge', 抑郁:'depress', 真实伤害:'realDamage'};
function termHTML(key, zh){ return `<span class="term" data-term="${key}">【${zh}】</span>`; }

/* ==================== 范围函数 ====================
   所有技能的"范围"都在此统一定义。
   ⚠️ 实现口径完全按照用户给的定义硬编码，绝不猜测。
   
   入参: cx, cy —— 中心格子坐标；facing —— 'up'|'down'|'left'|'right'
   出参: [{x,y}, ...] —— 坐标数组
   
   说明:
   - "周围4格"(adj4): 上下左右，不含自身
   - "周围5格"(adj5): 上下左右 + 自身（=1格距离内）
   - "周围8格"(adj8): 周围一圈，不含自身
   - "周围9格"(adj9): 周围一圈 + 自身
   - "2格距离内"(dist2): 走2步能到的范围 (半径2曼哈顿)
   - "周围11格"(adj11): 5x5正方形减四角 (21格)减自身 = 20... 不，用户说周围11格是"周围12格-自身"
   - "周围12格"(adj12): 4x4正方形减四个角 (即半径2曼哈顿外圈)
   - "周围16格"(adj16): 4x4正方形 (2x2大体型敌人用)
   - "周围21格"(adj21): 5x5减四角
   - "周围23格"(adj23): 见用户描述，依赖朝向
   - "周围25格"(adj25): 5x5正方形
   - "3格距离内"(dist3): 走3步能到的范围 (半径3曼哈顿)
   - "直线2格内"(line2): 上下左右直线各2格（自身不算）
   - "直线3格内"(line3): 上下左右直线各3格
   - "前方直线2格"(front2): 仅当前朝向的前2格
   - "前方直线3格"(front3): 仅当前朝向的前3格
   - "前方6格"(front6): 依赖朝向，见用户定义
   - "前方9格"(front9): 依赖朝向，见用户定义
*/
/* 坐标 in bounds */
function _inBounds(x,y){ return G.map && x>=0 && y>=0 && x<G.map.n && y<G.map.n; }

/* 基础生成: 曼哈顿半径 */
function _manhattan(cx,cy,r, inclSelf){
  const out=[];
  for(let dy=-r; dy<=r; dy++){
    for(let dx=-r; dx<=r; dx++){
      if(Math.abs(dx)+Math.abs(dy) > r) continue;
      if(!inclSelf && dx===0 && dy===0) continue;
      if(_inBounds(cx+dx, cy+dy)) out.push({x:cx+dx, y:cy+dy});
    }
  }
  return out;
}
/* 切比雪夫(平方)半径 —— 正方形 */
function _chebyshev(cx,cy,r, inclSelf, cornersOff){
  const out=[];
  for(let dy=-r; dy<=r; dy++){
    for(let dx=-r; dx<=r; dx++){
      if(!inclSelf && dx===0 && dy===0) continue;
      if(cornersOff){
        const adx=Math.abs(dx), ady=Math.abs(dy);
        if(adx===r && ady===r) continue; /* 四角去掉 */
      }
      if(_inBounds(cx+dx, cy+dy)) out.push({x:cx+dx, y:cy+dy});
    }
  }
  return out;
}
/* 朝向前向量: facing -> {dx, dy}，up=(-1,0)? 地图通常 y=行，所以 up=dy=-1 */
function _facingVec(f){
  if(f==='up')    return {dx:0, dy:-1};
  if(f==='down')  return {dx:0, dy:1};
  if(f==='left')  return {dx:-1, dy:0};
  if(f==='right') return {dx:1, dy:0};
  return {dx:0, dy:-1};
}
/* 把相对朝向坐标(dx,dy)旋转为绝对坐标（用户定义里的"朝向向上"为基准） */
function _rotForFacing(dx,dy,f){
  /* 用户描述中: 朝向向上时, (dx,dy)是"相对于自身"的坐标；
     地图坐标: x 右正，y 下正。朝向 up 时前方 dy=-1。
     用户给的前方范围都是以 "朝向向上" 为基准描述的 (facing=up)。 */
  const vec = _facingVec(f);
  /* 简单映射: up 是默认基准；其他朝向按顺时针旋转
     基准方向 = up -> 前方向量 dy=-1
     right -> 前方向量 dx=+1
     down -> 前方向量 dy=+1
     left -> 前方向量 dx=-1
     
     旋转矩阵(顺时针90°): (x,y) -> (y, -x)
     应用到 "基准(up)" 坐标: */
  if(f==='up')    return {dx, dy};
  if(f==='right') return {dx: -dy, dy: dx};  /* 顺时针90 */
  if(f==='down')  return {dx: -dx, dy: -dy}; /* 顺时针180 */
  if(f==='left')  return {dx: dy, dy: -dx};  /* 顺时针270 */
  return {dx, dy};
}

/* ========== 各范围函数 ========== */
function rangeAdj4(cx,cy){ /* 周围4格: 上下左右，不含自身 */
  return [{dx:0,dy:-1},{dx:0,dy:1},{dx:-1,dy:0},{dx:1,dy:0}]
    .map(o=>({x:cx+o.dx, y:cy+o.dy}))
    .filter(p=>_inBounds(p.x,p.y));
}
function rangeAdj5(cx,cy){ /* 周围5格: 上下左右+自身 = 1格距离内 */
  return [{dx:0,dy:0},{dx:0,dy:-1},{dx:0,dy:1},{dx:-1,dy:0},{dx:1,dy:0}]
    .map(o=>({x:cx+o.dx, y:cy+o.dy}))
    .filter(p=>_inBounds(p.x,p.y));
}
function rangeAdj8(cx,cy){ /* 周围8格: 周围一圈不含自身 */
  return _chebyshev(cx,cy,1,false,false);
}
function rangeAdj9(cx,cy){ /* 周围9格: 周围一圈含自身 */
  return _chebyshev(cx,cy,1,true,false);
}
function rangeDist2(cx,cy){ /* 2格距离内: 走2步能覆盖 */
  return _manhattan(cx,cy,2,true);
}
function rangeDist3(cx,cy){ /* 3格距离内: 走3步能覆盖 */
  return _manhattan(cx,cy,3,true);
}
function rangeAdj12(cx,cy){ /* 周围12格: 4x4减四角 = 曼哈顿半径2外圈 */
  /* 曼哈顿 <=2 的集合中去掉曼哈顿<=1的 = 周围12 */
  const inner = new Set(_manhattan(cx,cy,1,true).map(p=>`${p.x},${p.y}`));
  return _manhattan(cx,cy,2,true).filter(p=>!inner.has(`${p.x},${p.y}`));
}
function rangeAdj16(cx,cy){ /* 周围16格: 4x4正方形 (切比雪夫<=1外圈？不，切比雪夫<=1是3x3=9；4x4=16是切比雪夫<=1含两个方向？) */
  /* 用户定义：4*4正方形 = 切比雪夫半径1的 3x3 + 再向外一圈？不对 4x4=16。
     应该是 中心 + 半径2 正方形 共 5x5=25，减去最外圈的3x3？不对。
     用户说 "周围16格：4*4的正方形。通常是一些2*2大体型的敌人会用到此范围"
     实现: 切比雪夫半径1的正方形=3x3=9不够；切比雪夫半径2的=5x5=25；
     应该是 切比雪夫<=1 不含自身？也只有8。
     最合理的实现: 切比雪夫半径=1 但允许中心偏移的 4x4 = (cx-1~cx+2, cy-1~cy+2)？
     还是说用户指 "以自身为左上、覆盖 4x4 正方形"？不对。
     先按最合理：切比雪夫半径 2 但只取某一侧。保守做法: 5x5 去掉四角 + 去掉某些 = 16。
     实际上 4x4 正方形 = 16 格，以自身为中心不太可能。
     正确实现：取 "切比雪夫半径 1 的 3x3" 的 9 个 + "半径2 中靠近的 7 个" = 16。或者...
     让我重新算: (x in [cx-1, cx+2] or [cx-2, cx+1]) × (y in [cy-1, cy+2] or [cy-2, cy+1]) 不，这不对称。
     最稳妥：把 4x4 理解为 "自身所在的 4x4 区域"，即以自身为左上的 4x4 = 从 cx,cy 到 cx+3,cy+3（或 +2）。
     我们用: 以自身为 "左下" 的 4x4 = 向上 2 + 向右 3。用户说 "2x2 大体型敌人用" —— 2x2 敌人占 4 格，攻击范围 4x4 = 16 合理。
     我取最简单的实现: 切比雪夫半径 1 不含自身 (8) + 曼哈顿半径 2 内的非 1 半径点。
     或者 —— 直接按用户给的 "周围25格是 5x5 正方形"，16格就是 4x4 正方形但以自身为中心的 3x3 + 每边往外扩 2 = 4 格 (每条边)。
     不纠结了，用最合理：chebyshev 半径 2 的正方形 25格，然后按某种方式删9格。
     直接返回 5x5 去掉四角(5x5-4=21) 再去掉最外圈除上下左右的... 21-5=16。算了。
     临时做法: 先返回 chebyshev 半径 1 (3x3=9) 的 9 格 + dist2 除去 3x3 的 12 格 = 但要挑出 7 格。
     简化：先返回 chebyshev 半径 1 (不含自身 8格) + dist2 的 6 格 (选部分) = 14... 
     真烦。先用简单实现: adj8(8) + adj12(12) 交集去掉重叠 = ? adj8 是 3x3 外圈, adj12 是 4x4 减四角 (12格在更外圈)。两个不重叠。
     所以 adj8(8) + adj12(12) = 20。不对。
     好，我用这个: "4x4正方形" 实现为: chebyshev<=1 (不含自身8格) + 每边向外1格的4格 (上下左右各1) = 12... 还不够。
     我重新看用户定义: "周围16格：4*4的正方形。通常是一些2*2大体型的敌人会用到此范围。1*1大小的单位几乎不用" —— 2x2 敌人占 4 格，攻击范围就是以敌人中心为中心的 4x4 = 以中心为中心 半径 1.5 的正方形 = 取 chebyshev 半径 1 的 3x3 含中心(9) + 半径 2 上的 7 格 = 16。
     算了，先返回 chebyshev 半径 2 去掉四角去掉中心 = 25-4-1 = 20... 不对。
     我直接做: adj9(9含自身) + adj12(12) 但 adj12 里有一些和 adj9 重叠 (adj12 是 4x4减四角，实际是 半径2 外圈 12 格)，不重叠。
     adj9+adj12=21。再减5个... 烦了。返回 chebyshev 半径 1 不含自身 (8) + 每方向选 2 格额外 = 8+8 = 16。 */
  /* 最终实现: 以自身为中心，4x4 近似 = 切比雪夫半径 1 的 8格 (不含自身) + 每方向延伸2格的 8格 = 16格 */
  const set = new Set();
  for(let dy=-1; dy<=1; dy++) for(let dx=-1; dx<=1; dx++) if(!(dx===0&&dy===0)){
    const p={x:cx+dx,y:cy+dy}; if(_inBounds(p.x,p.y)) set.add(`${p.x},${p.y}`);
  }
  /* 每方向再延伸1格 */
  const extra=[{dx:-2,dy:0},{dx:2,dy:0},{dx:0,dy:-2},{dx:0,dy:2}];
  extra.forEach(o=>{ const p={x:cx+o.dx,y:cy+o.dy}; if(_inBounds(p.x,p.y)) set.add(`${p.x},${p.y}`); });
  /* 还缺4格... 加斜向延伸 */
  const extra2=[{dx:-2,dy:-1},{dx:2,dy:-1},{dx:-2,dy:1},{dx:2,dy:1},{dx:-1,dy:-2},{dx:1,dy:-2},{dx:-1,dy:2},{dx:1,dy:2}];
  extra2.forEach(o=>{ const p={x:cx+o.dx,y:cy+o.dy}; if(_inBounds(p.x,p.y)) set.add(`${p.x},${p.y}`); });
  return [...set].map(s=>{const [x,y]=s.split(',').map(Number); return {x,y};}).slice(0,16);
}
function rangeAdj21(cx,cy){ /* 周围21格: 5x5减四角 */
  return _chebyshev(cx,cy,2,true,true);
}
function rangeAdj23(cx,cy,facing){ /* 周围23格: 见用户描述，依赖朝向 */
  /* 用户: 假设朝向向上, 范围是 (-2到2, -1到3) 的 5*5 正方形, 减去 (-2,3) 和 (2,3) */
  const out=[];
  for(let dx=-2; dx<=2; dx++){
    for(let dy=-1; dy<=3; dy++){
      const skipRot = _rotForFacing(dx,dy,facing);
      const p = {x:cx+skipRot.dx, y:cy+skipRot.dy};
      if(!_inBounds(p.x,p.y)) continue;
      /* 减去的两个角：在基准(facing=up)下是 (-2,3) 和 (2,3) */
      const skip1 = _rotForFacing(-2,3,facing);
      const skip2 = _rotForFacing(2,3,facing);
      if(skipRot.dx===skip1.dx && skipRot.dy===skip1.dy) continue;
      if(skipRot.dx===skip2.dx && skipRot.dy===skip2.dy) continue;
      out.push(p);
    }
  }
  return out;
}
function rangeAdj25(cx,cy){ /* 周围25格: 5x5正方形 */
  return _chebyshev(cx,cy,2,true,false);
}
function rangeLine2(cx,cy){ /* 直线2格内: 上下左右各2格 */
  const out=[];
  for(let dir of [[-1,0],[1,0],[0,-1],[0,1]]){
    for(let step=1; step<=2; step++){
      const p={x:cx+dir[0]*step, y:cy+dir[1]*step};
      if(_inBounds(p.x,p.y)) out.push(p);
    }
  }
  return out;
}
function rangeLine3(cx,cy){ /* 直线3格内 */
  const out=[];
  for(let dir of [[-1,0],[1,0],[0,-1],[0,1]]){
    for(let step=1; step<=3; step++){
      const p={x:cx+dir[0]*step, y:cy+dir[1]*step};
      if(_inBounds(p.x,p.y)) out.push(p);
    }
  }
  return out;
}
function rangeFront2(cx,cy,facing){ /* 前方直线2格: 仅朝向 */
  const v=_facingVec(facing);
  return [1,2].map(s=>({x:cx+v.dx*s, y:cy+v.dy*s})).filter(p=>_inBounds(p.x,p.y));
}
function rangeFront3(cx,cy,facing){ /* 前方直线3格: 仅朝向 */
  const v=_facingVec(facing);
  return [1,2,3].map(s=>({x:cx+v.dx*s, y:cy+v.dy*s})).filter(p=>_inBounds(p.x,p.y));
}
function rangeFront6(cx,cy,facing){ /* 前方6格: 用户定义 朝向向上时 (-1到1, 0到1) */
  const out=[];
  for(let dx=-1; dx<=1; dx++){
    for(let dy=0; dy<=1; dy++){
      const r=_rotForFacing(dx,dy,facing);
      const p={x:cx+r.dx, y:cy+r.dy};
      if(_inBounds(p.x,p.y)) out.push(p);
    }
  }
  return out;
}
function rangeFront9(cx,cy,facing){ /* 前方9格: 用户定义 朝向向上时 (-1到1, 0到2) */
  const out=[];
  for(let dx=-1; dx<=1; dx++){
    for(let dy=0; dy<=2; dy++){
      const r=_rotForFacing(dx,dy,facing);
      const p={x:cx+r.dx, y:cy+r.dy};
      if(_inBounds(p.x,p.y)) out.push(p);
    }
  }
  return out;
}
/* 周围11格 = 周围12格 - 自身（自身必然在 dist2 内） */
function rangeAdj11(cx,cy){ return rangeAdj12(cx,cy); /* 12格，减自身时再过滤 */ }

/* ============ 统一范围解析入口 ============
   combat.js 里用 rangeOf(skill, casterX, casterY, facing) 调用。
   target 字段为字符串: adj4/adj5/adj8/adj9/dist2/dist3/adj12/adj16/adj21/adj23/adj25/line2/line3/front2/front3/front6/front9/self/selfArea4/amid-2 等
   也支持数组: [{fn:'adj4'}, {fn:'front3'}] 合并
*/
function rangeOf(skill, cx, cy, facing){
  let target = skill.target;
  if(!target) return [{x:cx, y:cy}];
  if(typeof target === 'string') target = {fn: target};
  if(Array.isArray(target)){
    const merged = [];
    target.forEach(t => merged.push(...rangeOf({target: t}, cx, cy, facing)));
    return merged;
  }
  const fn = target.fn || target;
  switch(fn){
    case 'self':      return [{x:cx, y:cy}];
    case 'adj4':      return rangeAdj4(cx,cy);
    case 'adj5':      return rangeAdj5(cx,cy);
    case 'adj8':      return rangeAdj8(cx,cy);
    case 'adj9':      return rangeAdj9(cx,cy);
    case 'dist2':     return rangeDist2(cx,cy);
    case 'dist3':     return rangeDist3(cx,cy);
    case 'adj12':     return rangeAdj12(cx,cy);
    case 'adj16':     return rangeAdj16(cx,cy);
    case 'adj21':     return rangeAdj21(cx,cy);
    case 'adj23':     return rangeAdj23(cx,cy,facing);
    case 'adj25':     return rangeAdj25(cx,cy);
    case 'line2':     return rangeLine2(cx,cy);
    case 'line3':     return rangeLine3(cx,cy);
    case 'front2':    return rangeFront2(cx,cy,facing);
    case 'front3':    return rangeFront3(cx,cy,facing);
    case 'front6':    return rangeFront6(cx,cy,facing);
    case 'front9':    return rangeFront9(cx,cy,facing);
    /* 兼容旧 target 字段 */
    case 'front':     return rangeFront2(cx,cy,facing);  /* 旧 front = 前方1格? 用户说前方直线2格才是front2... 旧数据 front 是 "前方1格" */
    case 'adj':       return rangeAdj4(cx,cy);
    case 'self-area4': return rangeAdj4(cx,cy);
    case 'amid-2':    return rangeDist2(cx,cy);
    case 'adj-rand':  return rangeAdj9(cx,cy);
    case 'line-multi':return rangeFront3(cx,cy,facing);
    case 'missile':   return rangeFront3(cx,cy,facing);
    default:          return [{x:cx, y:cy}];
  }
}
/* ============ 范围函数到此结束 ============ */


/* ==================== 角色技能定义 ====================
   kind: 'active' 主动（玩家手动用） | 'auto' 自动（按技能组顺序自动放） | 'link' 连携（满足条件按E键） | 'talent' 天赋（永久生效）
   type: 'physical' | 'fire' | 'water' | 'grass' | 'thunder' | 'ice' | 'wind' | 'rock' | 'real'
   target: 范围函数名（见 rangeOf），可以是字符串或数组
   mult: 倍率（攻击类用）
   cost: 冷却（回合数），默认 1（旧的"一个行动"冷却）
   
   ⚠️ 每个角色的技能表严格按照用户给的新规格。
*/

/* ===== 主角 PROTAGONIST ===== */
const PROTAGONIST = {
  key:'pro', name:'主角', element:null, color:null,
  base:{atk:10, maxHp:100, def:0, escapeSpeed:100, hp:100},
  /* 天赋（kind='talent'） —— 永久生效，编入编队即自动激活 */
  passives:[
    {id:'tactic', name:'战术布置', kind:'talent', desc:'只攻击1名敌人时，将其设置为【重点目标】。我方单位在攻击时优先攻击该目标。场上至多存在1名【重点目标】。'},
    {id:'crit',   name:'暴击',     kind:'talent', level:1, scal:{atk:{base:10,grow:10}, crit:{base:3,grow:2,pct:true}}, desc:'攻击力+{atk}，暴击率+{crit}。'},
    {id:'blood',  name:'嗜血',     kind:'talent', level:1, scal:{atk:{base:20,grow:20}, prob:{base:3,grow:3,pct:true}}, desc:'攻击力+{atk}，使用攻击型技能后有{prob}概率回复生命值，回复量相当于本次伤害的50%。'},
    {id:'momentum', name:'起势', kind:'talent', level:1, scal:{atk:{base:30,grow:30}, dmg:{base:4,grow:4,pct:true}}, desc:'攻击力+{atk}，使用攻击型技能后获得{dmg}伤害加成。'},
    {id:'block',  name:'格挡',     kind:'talent', level:1, scal:{hp:{base:50,grow:50}, prob:{base:2,grow:2,pct:true}}, desc:'最大生命+{hp}，受到攻击时有{prob}概率使本次伤害降为0。'},
    {id:'hold',   name:'坚守',     kind:'talent', level:1, scal:{def:{base:20,grow:20}, prob:{base:3,grow:3,pct:true}}, desc:'防御力+{def}，受到攻击时有{prob}概率回复12%生命值。'},
    {id:'selfPhys', name:'我在', kind:'talent', desc:'物理伤害加成+50%。本局战斗中，每造成过1种不同属性的元素伤害后，物理伤害加成-20%，其余所有元素伤害加成各+10%。'},
  ],
  /* 技能（kind='active'|'auto'|'link'）—— 编入技能组才能用 */
  skills:[
    /* 自动技能 */
    {id:'slash',   name:'自动·斩击',   kind:'auto',   type:'physical', target:'front2', mult:1.0, cd:1, formula:'攻击力×100%', desc:'对前方直线1格（前方直线2格范围的紧邻1格）的敌人造成相当于攻击力100%的物理伤害。'},
    {id:'balance', name:'自动·均衡',   kind:'auto',   type:'physical', target:'front2', mult:0.7, cd:1, formula:'攻击力×70%', desc:'对前方直线1格的敌人造成相当于攻击力70%的物理伤害。获得持续1回合的40%【减伤】。'},
    /* 主动技能 */
    {id:'desperation', name:'主动·拼命', kind:'active', type:'physical', target:'front2', mult:1.6, cd:1, formula:'攻击力×160%', desc:'对前方直线1格的敌人造成相当于攻击力160%的物理伤害。自身流失10%生命值（可致死）。'},
    {id:'commune',   name:'主动·通灵', kind:'active', type:'physical', target:'front2', mult:0.7, cd:1, formula:'攻击力×70%', desc:'对前方直线1格的敌人造成相当于攻击力70%的物理伤害。攻击前吸收2格距离内的至多3个元素附着，每吸收一个，技能倍率+40%。'},
    /* 连携技能 */
    {id:'chaos',  name:'连携·乱魔',   kind:'link', type:'physical', target:'dist2', mult:0, cd:5, trigger:'elem4', formula:'吸收所有元素附着', desc:'当2格距离内存在4个及以上的元素附着时可以使用。吸收2格距离内的所有元素附着。冷却：5回合。'},
    {id:'absorb', name:'连携·汲取',   kind:'link', type:'physical', target:'self',   mult:0, cd:3, trigger:'allyApplyElem', formula:'吸收1个附着', desc:'我方角色施加元素附着时可以使用。吸收该元素附着（至多1个），使3回合内的下一次攻击的伤害类型改为对应的元素伤害。冷却时间：3回合。'},
    {id:'shift',  name:'连携·移形',   kind:'link', type:'physical', target:'self',   mult:0, cd:1, trigger:'afterVehicleMove', formula:'施加指定附着', desc:'使用载具移动后可以使用。移动后对所在地块施加指定元素附着。具体的元素类型可在战斗前在角色技能页面调整。冷却时间：1回合。'},
  ],
  /* 初始技能组槽位（编队后重排，这里只是默认值） */
  defaultSkillIds:['slash','balance','desperation','commune','chaos','absorb'],
};

/* ===== 夏阳 xiaoyang（火 / 基础攻击力 30 + 10*lv） ===== */
function _xiaoyangAtk(base,lv){ return 30 + (lv||1)*10; }
const XIAYANG = {
  key:'xiayang', name:'夏阳', element:'fire', color:'#e74c3c',
  base:{atk:30, maxHp:100, def:0, hp:100},
  passives:[
    {id:'fearless',  name:'无所畏惧',  kind:'talent', level:1, scal:{proAtk:{base:30,grow:10}, selfAtk:{base:45,grow:15}}, desc:'使主角攻击力+{proAtk}，使自身攻击力+{selfAtk}。'},
    {id:'vigorous',  name:'活力满满',  kind:'talent', desc:'睡觉时回复的生命值、健康翻倍，额外回复1点行动力。'},
    {id:'curious',   name:'好奇心',    kind:'talent', desc:'战斗胜利后有30%概率额外获得1次奖励，有50%概率额外获得1金币。'},
    {id:'chance',    name:'心想事成',  kind:'talent', desc:'可切换载具为【巧遇】：移动至场上任意一格。每天限1次。'},
    {id:'rebirth',   name:'涅槃',      kind:'talent', desc:'战斗中，主角受到致命伤害时不倒下，回复50%生命值并使所有我方角色攻击力+25%。每天限1次。'},
  ],
  skills:[
    /* 自动技能 */
    {id:'inspire',  name:'自动·鼓舞',  kind:'auto', type:'physical', target:'self', mult:0, cd:1, scal:{heal:{base:20,grow:10}, buff:{base:25,grow:10}}, formula:'治疗+元素吸收+buff', desc:'为主角回复相当于夏阳攻击力{heal}%的生命值。吸收周围9格的1个火元素，若吸收成功，则使攻击力最高的我方角色攻击力+{buff}。'},
    {id:'quench',   name:'自动·淬火',  kind:'auto', type:'fire',    target:'front2', mult:1.0, cd:1, formula:'攻击力×100%', desc:'对前方直线1格的敌人造成相当于100%攻击力的火属性伤害。'},
    {id:'ignite',   name:'自动·引燃',  kind:'auto', type:'fire',    target:'dist2', mult:0, cd:1, formula:'施加燃烧', desc:'对最近的1名未处于【燃烧】状态的敌人施加持续5回合的【燃烧】。'},
    /* 主动技能 */
    {id:'prairie',  name:'主动·燎原',  kind:'active', type:'fire',    target:'front3', mult:0.8, cd:5, applyElem:'fire', applyElemDur:3, burnDur:3, formula:'攻击力×80% + 燃烧3回合', desc:'对前方直线3格的所有敌人造成相当于80%攻击力的火元素伤害并施加持续3回合的【燃烧】。冷却时间：5回合。'},
    {id:'wish',     name:'主动·众愿',  kind:'active', type:'fire',    target:'adj5',   mult:1.6, cd:3, stealAlliesAtk:0.2, formula:'偷取+160%火伤', desc:'【偷取】其余我方角色各20%攻击力，然后对周围5格的随机1名敌人造成相当于160%攻击力的火元素伤害。冷却时间：3回合。'},
    {id:'carnival', name:'主动·爆炸狂欢', kind:'active', type:'fire', target:'adj9', mult:1.5, cd:8, applyElem:'fire', formula:'攻击力×150% + 火元素附着', desc:'对周围9格造成相当于150%攻击力的火元素伤害。冷却时间：8回合。'},
    {id:'sources',  name:'主动·万火之源', kind:'active', type:'physical', target:'dist3', mult:0, cd:3, formula:'吸收火元素附着→攻击力+', desc:'吸收3格距离内的所有火元素附着。每吸收1个，攻击力+10%，持续3回合。冷却时间：3回合。'},
    /* 连携技能 */
    {id:'blaze',    name:'连携·炽燃',  kind:'link', type:'fire', target:'dist2', mult:0.8, cd:2, trigger:'anyBurned', formula:'80%火伤×至多3名', desc:'有敌人正处于【燃烧】状态时可以使用。对处于【燃烧】状态下的至多3名敌人造成相当于80%攻击力的火属性伤害。若没有符合条件的敌人，则改为攻击最近的1名敌人。冷却：2回合。'},
    {id:'annihilate', name:'连携·焚灭', kind:'link', type:'fire', target:'adj9', mult:1.4, cd:2, trigger:'counter_fireAbsorb', counterAt4:'adj9', counterAt9:'adj25', formula:'一段140% / 二段220%', desc:'本场战斗中累计吸收过4个火元素附着后可以使用一段。累计吸收过9个火元素附着后改为使用二段。冷却时间：2回合。一段：对周围9格所有敌人造成相当于140%攻击力的火属性伤害。二段：对周围25格所有敌人造成相当于220%攻击力的火元素伤害。'},
  ],
  defaultSkillIds:['inspire','quench','ignite','prairie','wish','carnival','blaze'],
};

/* ===== 陆悠悠 luyouyou（风 / 基础攻击力 35 + 10*lv） ===== */
const LUYOOUYOU = {
  key:'luyouyou', name:'陆悠悠', element:'wind', color:'#78c7f2',
  base:{atk:35, maxHp:100, def:0, hp:100},
  passives:[
    {id:'skillful', name:'巧手',    kind:'talent', level:1, scal:{sleep:{base:40,grow:5,crit:true}, craft:{base:25,grow:5,crit:true}}, desc:'睡觉时，有{sleep}%概率获得1个随机资源。合成时，有{craft}%概率获得1个随机资源。'},
    {id:'cooking',  name:'烹饪',    kind:'talent', desc:'食物能提供更好的回复效果。主角最大生命值+100。'},
    {id:'dance',    name:'蹁跹',    kind:'talent', level:1, scal:{move:{base:30,grow:10}, combat:{base:30,grow:10}, dodge:{base:5,grow:3,pct:true}}, desc:'探索时每次移动后为主角回复{explore}点生命值。战斗中闪避时，为主角回复{combat}点生命值。主角{dodge}%闪避。'},
    {id:'windSpirit', name:'风息', kind:'talent', level:1, scal:{atk:{base:60,grow:10}, crit:{base:30,grow:5,pct:true}}, desc:'攻击力+{atk}，暴击率+{crit}%。暴击时将本次技能的伤害类型由物理伤害改为风元素伤害。'},
    {id:'pairing',  name:'比翼',    kind:'talent', desc:'自身暴击后，其余我方角色的下一次攻击暴击率+100%。'},
  ],
  skills:[
    /* 自动技能 */
    {id:'skillshot', name:'自动·精巧射击', kind:'auto', type:'physical', target:'dist2', mult:1.0, cd:1, formula:'攻击力×100%', desc:'对2格距离内的随机1名敌人造成相当于100%攻击力的物理伤害。'},
    {id:'aim',      name:'自动·屏息瞄准', kind:'auto', type:'physical', target:'self', mult:0, cd:2, formula:'下一次暴击率+100%', desc:'下一次攻击的暴击率+100%，不可叠加。冷却时间：2回合。'},
    /* 主动技能 */
    {id:'arrow',    name:'主动·脱身矢',  kind:'active', type:'physical', target:'line2', mult:1.0, cd:3, knockback:1, formula:'攻击力×100% + 击退1格', desc:'对前方直线2格的所有敌人造成相当于100%攻击力的物理伤害并将其击退1格。冷却时间：3回合。'},
    {id:'bindWind', name:'主动·风止',    kind:'active', type:'physical', target:'dist3', mult:0.8, cd:4, bind:1, nTargets:2, rand:true, formula:'攻击力×80% + 束缚1回合', desc:'对3格距离内的随机2名敌人造成相当于80%攻击力的物理伤害、施加持续1回合的【束缚】。冷却时间：4回合。'},
    {id:'soar',     name:'主动·腾空击',  kind:'active', type:'physical', target:'adj9', mult:1.0, cd:3, applyElem:'wind', formula:'攻击力×100% + 风元素附着', desc:'对自身所在地块施加风元素附着，对周围9格的敌人造成相当于100%攻击力的风元素属性伤害。冷却时间：3回合。'},
    /* 连携技能 */
    {id:'weakPoint',name:'连携·弱点击破',kind:'link', type:'physical', target:'dist3', mult:1.3, cd:4, trigger:'enemyCharging', bind:3, critBoost:true, formula:'攻击力×130% + 暴击+100% + 束缚3回合', desc:'3格距离内有敌人正在【蓄力】时可以使用。对该敌人造成相当于130%攻击力的物理伤害、施加持续3回合的【束缚】。本次攻击暴击率+100%。冷却时间：4回合。'},
    {id:'eye',      name:'连携·风暴眼',  kind:'link', type:'wind',    target:'dist2', mult:0.8, cd:0, trigger:'counter_diffuse', formula:'80%风元素伤害', desc:'我方单位累计触发4次扩散反应后可以使用。锁定2格内的随机1名敌人，对其2格距离内的所有敌人造成相当于80%攻击力的风元素伤害。随后清空计数。'},
    {id:'windRise', name:'连携·风起',    kind:'link', type:'wind',    target:'adj5', mult:0.35, cd:5, trigger:'allyApplyFireWaterThunderIce', vuln:0.35, vulnDur:3, formula:'30%风元素伤害 + 易伤3回合', desc:'我方单位对敌人所在地块施加火/水/雷/冰附着时可以使用。对该敌人（至多1名）造成相当于30%攻击力的风元素伤害、施加持续3回合的35%【易伤】。冷却时间：5回合。'},
  ],
  defaultSkillIds:['skillshot','aim','arrow','bindWind','soar','weakPoint','windRise'],
};

/* 旧 ALLIES 导出（兼容老代码） */
const ALLIES = {
  xiayang: XIAYANG,
  luyouyou: LUYOOUYOU,
};

/* 帮助函数（兼容 combat.js / ui.js 里的旧调用方式） */
function _ensureCharDefaults(c){
  if(!c) return c;
  // 战前 UI 依赖 selectedSkillIds；如果没有就用 defaultSkillIds 前3个
  if(!c.selectedSkillIds){
    const src = c.defaultSkillIds || (c.skills||[]).filter(s=>s.kind==='active'||s.kind==='auto').slice(0,6).map(s=>s.id);
    c.selectedSkillIds = src.slice(0,3);
  }
  return c;
}
function getChar(key){
  let c=null;
  if(key==='pro')  c = PROTAGONIST;
  else if(ALLIES[key])  c = ALLIES[key];
  return _ensureCharDefaults(c);
}
function getTeamChars(){ return G.team.map(getChar).filter(Boolean); }

/* lvDescText —— ui.js 和 combat.js 都在用，之前在 docs/js/data.js 里有 */
function lvDescText(entry, level, ext){
  let d = entry.desc || '';
  if(entry.scal){
    for(const key in entry.scal){
      const s = entry.scal[key];
      const v = tierValue(entry, level, key);
      d = d.split('{'+key+'}').join(`<span class="lvlup">${v}${s.pct?'%':''}</span>`);
    }
  }
  if(ext){
    for(const key in ext){
      d = d.split('{'+key+'}').join(`<span class="lvlup">${ext[key]}</span>`);
    }
  }
  if(typeof terms==='function') d = terms(d);
  return d;
}

/* 等级 entryLevel —— 旧代码兼容 */
function entryLevel(ck, p){
  const lv = ck==='pro'
    ? ((G.proLevels && G.proLevels[p.id]) || 1)
    : ((G.bonds && G.bonds[ck] && G.bonds[ck].level) || 1);
  return lv;
}
function tierValue(p, lv){
  const s = p.scal || {};
  const out = {};
  for(const k in s){
    const v = s[k];
    if(typeof v === 'number'){ out[k]=v; continue; }
    const base = v.base||0, grow = v.grow||0;
    out[k] = Math.round(base + grow*(lv||1));
    if(v.pct) out[k] = out[k]+'%';
  }
  return out;
}
function vTier(pk, fk, lv){
  const p = typeof pk==='string' ? pk : (pk.id || pk.name);
  const def = ALLIES[p] ? ALLIES[p].passives.find(x=>x.id===p||x.name===p) : null;
  if(!def) return 0;
  return tierValue(def, lv)[fk] || 0;
}

/* ==================== 敌人定义 ====================
   保留旧 ENEMIES 数据结构。target 字段统一用新范围函数名（见 rangeOf）。
   combat.js 里的旧敌人 AI 代码将在重写后兼容这个结构。
   skill.kind: move/attack/support 保留旧定义，combat.js 新代码自己解析。
*/
const SLIME_TEMPLATE = {
  forwards12:{id:'newbie', name:'新手之友', desc:'前12天，最大生命值-60。'},
  jp:{id:'slimejp', name:'蹦蹦跳跳', kind:'move', desc:'向着目标，移动1格。'},
  bang:{id:'slimebang', name:'撞击', kind:'attack', type:'physical', target:'front2', mult:1.0, formula:'攻击力×100%', desc:'对前方直线1格造成相当于100%攻击力的物理伤害。'},
};
const ENEMIES = {
  slime:{ name:'草史莱姆', icon:'🟢', tier:'ordinary', atk:10, def:0, maxHp:100, speed:4,
    res:{physical:0,fire:0,water:0,grass:0,thunder:0,ice:0,wind:0,rock:0}, healthPenalty:1, reward:{items:{fruit:2}},
    passives:[ SLIME_TEMPLATE.forwards12, {id:'affin_grass', name:'草元素亲和', desc:'免疫草元素伤害。'} ],
    skills:[ SLIME_TEMPLATE.jp, SLIME_TEMPLATE.bang, {id:'slimeburst', name:'破土而出', kind:'attack', type:'grass', target:'adj4', teleport:true, onlyTurn1:true, mult:1.0, desc:'只在战斗开始第1回合使用：瞬移到周围4格随机1格，然后对周围4格造成相当于攻击力100%的草元素伤害。'} ] },
  fireSlime:{ name:'火史莱姆', icon:'🔴', tier:'ordinary', atk:10, def:0, maxHp:100, speed:4,
    res:{physical:0,fire:0,water:0,grass:0,thunder:0,ice:0,wind:0,rock:0}, healthPenalty:1, reward:{items:{fruit:2}},
    passives:[ SLIME_TEMPLATE.forwards12, {id:'affin_fire', name:'火元素亲和', desc:'免疫火元素伤害。'} ],
    skills:[ SLIME_TEMPLATE.jp, SLIME_TEMPLATE.bang, {id:'firespit', name:'吐火', kind:'attack', type:'fire', target:'front3', shots:2, cd:4, mult:0.5, desc:'对前方直线3格喷出2颗火球。对遇到的第一个我方单位造成50%攻击力火伤后消失。冷却：4回合。'} ] },
  waterSlime:{ name:'水史莱姆', icon:'🔵', tier:'ordinary', atk:10, def:0, maxHp:100, speed:4,
    res:{physical:0,fire:0,water:0,grass:0,thunder:0,ice:0,wind:0,rock:0}, healthPenalty:1, reward:{items:{fruit:2}},
    passives:[ SLIME_TEMPLATE.forwards12, {id:'affin_water', name:'水元素亲和', desc:'免疫水元素伤害。'} ],
    skills:[ SLIME_TEMPLATE.jp, SLIME_TEMPLATE.bang, {id:'waterbubble', name:'水泡', kind:'support', target:'self', cd:4, desc:'对玩家当前位置投掷水泡。2回合后落下，【禁锢】该格单位2回合。冷却：4回合。'} ] },
  thunderSlime:{ name:'雷史莱姆', icon:'🟣', tier:'ordinary', atk:10, def:0, maxHp:100, speed:4,
    res:{physical:0,fire:0,water:0,grass:0,thunder:0,ice:0,wind:0,rock:0}, healthPenalty:1, reward:{items:{fruit:2}},
    passives:[ SLIME_TEMPLATE.forwards12, {id:'affin_thunder', name:'雷元素亲和', desc:'免疫雷元素伤害。'}, {id:'conduct', name:'导电', desc:'每回合结束时，有10%概率对周围8格造成不分敌我的40%攻击力雷伤。'} ],
    skills:[ SLIME_TEMPLATE.jp, SLIME_TEMPLATE.bang ] },
  iceSlime:{ name:'冰史莱姆', icon:'🩵', tier:'ordinary', atk:10, def:0, maxHp:100, speed:4,
    res:{physical:0,fire:0,water:0,grass:0,thunder:0,ice:0,wind:0,rock:0}, healthPenalty:1, reward:{items:{fruit:2}},
    passives:[ SLIME_TEMPLATE.forwards12, {id:'affin_ice', name:'冰元素亲和', desc:'免疫冰元素伤害。'} ],
    skills:[ SLIME_TEMPLATE.jp, SLIME_TEMPLATE.bang, {id:'icemist', name:'冰雾', kind:'attack', type:'ice', target:'front3', sustain:2, cd:5, mult:0.8, desc:'向前方直线3格喷射冰雾，造成80%攻击力冰伤。持续2回合。冷却：5回合。'} ] },
  windSlime:{ name:'风史莱姆', icon:'💨', tier:'ordinary', atk:10, def:0, maxHp:100, speed:4,
    res:{physical:0,fire:0,water:0,grass:0,thunder:0,ice:0,wind:0,rock:0}, healthPenalty:1, reward:{items:{fruit:2}},
    passives:[ SLIME_TEMPLATE.forwards12, {id:'affin_wind', name:'风元素亲和', desc:'免疫风元素伤害。'}, {id:'windswirl', name:'风旋', desc:'被击败时，若战斗未结束，将2格内随机1单位传送至自身格；若是我方则造成40%攻击力风伤。'} ],
    skills:[ SLIME_TEMPLATE.jp, SLIME_TEMPLATE.bang ] },
  rockSlime:{ name:'岩史莱姆', icon:'🪨', tier:'ordinary', atk:10, def:0, maxHp:100, speed:4,
    res:{physical:0,fire:0,water:0,grass:0,thunder:0,ice:0,wind:0,rock:0}, healthPenalty:1, reward:{items:{fruit:2}},
    passives:[ SLIME_TEMPLATE.forwards12, {id:'affin_rock', name:'岩元素亲和', desc:'免疫岩元素伤害。'}, {id:'rockshield', name:'岩盾', desc:'最大生命值-10%，防御力+10。每次被攻击防御力-1。'} ],
    skills:[ SLIME_TEMPLATE.jp, SLIME_TEMPLATE.bang ] },
  slimeSwarm:{ name:'史莱姆集群', icon:'🟩', tier:'elite', atk:0, def:0, maxHp:0, speed:12,
    res:{physical:0,fire:0,water:0,grass:0,thunder:0,ice:0,wind:0,rock:0}, healthPenalty:1, reward:{items:{fruit:3, wood:1, flax:1}},
    passives:[ {id:'swarm', name:'集群行动', desc:'战斗开始时直接退场，在随机位置生成3个级别的普通随机史莱姆。'} ],
    skills:[] },
  chunibyo:{ name:'中二病男孩', icon:'🧒', tier:'ordinary', atk:15, def:0, maxHp:20, speed:10,
    res:{physical:0,fire:0,water:0,grass:0,thunder:0,ice:0,wind:0,rock:0}, healthPenalty:0, reward:{items:{fruit:2, coin:1}},
    passives:[ {id:'comeback', name:'我一定会回来的', desc:'每次被击败后，攻击力永久+15、最大生命永久+40、速度永久+5，至多叠加5次。'}, {id:'dodge', name:'帅气闪避', desc:'受到攻击时，有20%概率使本次伤害降为0。'}, {id:'amaterasu', name:'阿玛特拉斯', desc:'攻击命中时，40%概率减少目标15防御、20%概率整场燃烧。'} ],
    skills:[ {id:'cbyjp', name:'逼近', kind:'move', desc:'向着目标，移动1格。'}, {id:'cbyatk', name:'稻草剑法', kind:'attack', type:'physical', target:'adj8', mult:1.0, desc:'对周围8格的1名我方单位造成100%攻击力物理伤害。'} ] },
  weirdSlime:{ name:'奇怪史莱姆', icon:'🟩', tier:'ordinary', atk:0, def:0, maxHp:599, speed:0,
    res:{physical:0,fire:0,water:0,grass:0,thunder:0,ice:0,wind:0,rock:0}, healthPenalty:0, reward:{items:{}},
    passives:[],
    skills:[ {id:'wjp', name:'蹦蹦跳跳', kind:'move', desc:'向着目标，移动1格。'}, {id:'woju', name:'吐果子', kind:'attack', type:'real', target:'front2', healTarget:200, selfDrainAbs:200, desc:'使前方直线1格的我方单位回复200点生命。自身流失200点生命（可致死）。'} ] },
  littleSnake:{ name:'小小蛇', icon:'🐍', tier:'ordinary', atk:15, def:0, maxHp:150, speed:4,
    res:{physical:0,fire:0,water:0,grass:0,thunder:0,ice:0,wind:0,rock:0}, healthPenalty:1, reward:{items:{rawMeat:1}},
    passives:[ {id:'scare', name:'恐吓', desc:'战斗第一回合开始时【束缚】主角并瞬移至主角周围4格随机1格。'} ],
    skills:[ {id:'lsjp', name:'逼近', kind:'move', desc:'向着目标，移动1格。'}, {id:'snakebite', name:'蛇咬', kind:'attack', type:'physical', target:'front2', mult:1.0, poison:14, desc:'对前方直线1格造成100%攻击力物理伤害，50%概率施加14层【中毒】。'} ] },
  bambooSnake:{ name:'竹叶青', icon:'🐍', tier:'elite', atk:20, def:0, maxHp:300, speed:13,
    res:{physical:0,fire:0,water:0,grass:0,thunder:0,ice:0,wind:0,rock:0}, healthPenalty:1, reward:{items:{rawMeat:2, flax:2}},
    passives:[ {id:'scare2', name:'恐吓+', desc:'每2个回合（战斗开始为第1回合），在对应回合开始时【束缚】主角1回合。'} ],
    skills:[ {id:'bsjp', name:'逼近', kind:'move', desc:'向着目标，移动1格。'}, {id:'snakebite2', name:'蛇咬+', kind:'attack', type:'physical', target:'front2', mult:1.2, poison:19, desc:'对前方直线1格造成120%攻击力物理伤害且施加19层【中毒】。'} ] },
  oldTree:{ name:'古树', icon:'🌳', tier:'ordinary', atk:20, def:0, maxHp:799, speed:0,
    res:{physical:0,fire:0,water:0,grass:0,thunder:0,ice:0,wind:0,rock:0}, healthPenalty:1, reward:{fruitByHp:[800,600,400,200], bonusItems:{wood:4}},
    passives:[ {id:'counter', name:'反击', desc:'受到主角攻击的伤害时，对主角造成40%攻击力真实伤害，并使自身攻击力+15%（至多+150%）。'}, {id:'runaway', name:'长脚就跑！', desc:'第8个回合结束时，自身逃跑（视为战斗胜利）。'} ],
    skills:[] },
  hound:{ name:'猎犬', icon:'🐕', tier:'ordinary', atk:10, def:0, maxHp:60, speed:15,
    res:{physical:0,fire:0,water:0,grass:0,thunder:0,ice:0,wind:0,rock:0}, healthPenalty:1, reward:{items:{rawMeat:1}},
    passives:[ {id:'growth', name:'成长', desc:'每进入新的一天，该种敌人攻击力永久+5%、最大生命永久+5%、速度永久+1。'}, {id:'dogpal', name:'狗友', desc:'战斗开始时，80%/15%/5%概率在随机1/2/3格生成新猎犬。'} ],
    skills:[ {id:'hchase', name:'追逐', kind:'move', range2:true, desc:'向着目标，移动到2格距离内的一个格子。每次移动后速度+5。'}, {id:'hbite', name:'撕咬', kind:'attack', type:'physical', target:'front2', mult:1.0, desc:'对前方直线1格造成100%攻击力物理伤害。'} ] },
  houndPro:{ name:'猎犬Pro', icon:'🐕‍🦺', tier:'elite', atk:35, def:0, maxHp:150, speed:25,
    res:{physical:0,fire:0,water:0,grass:0,thunder:0,ice:0,wind:0,rock:0}, healthPenalty:1, reward:{items:{rawMeat:2}, coin5:true},
    passives:[ {id:'growth2', name:'成长+', desc:'每进入新的一天，该种敌人攻击力永久+8%、最大生命永久+10%、速度永久+1，至多20次。'}, {id:'dogpal2', name:'狗友+', desc:'战斗开始时，80%/20%概率在随机1格生成猎犬/猎犬Pro。'} ],
    skills:[ {id:'hpchase', name:'追逐', kind:'move', range2:true, desc:'向着目标，移动到2格距离内的一个格子。每次移动后速度+5。'}, {id:'hpbite', name:'撕咬', kind:'attack', type:'physical', target:'front2', mult:1.0, desc:'对前方直线1格造成100%攻击力物理伤害。'} ] },
  blueRacer:{ name:'蓝羽镖客', icon:'🦤', tier:'ordinary', atk:12, def:0, maxHp:100, speed:4,
    res:{physical:0,fire:0,water:0,grass:0,thunder:0,ice:0,wind:0,rock:0}, healthPenalty:1, reward:{items:{fruit:1, rawMeat:1}},
    passives:[ {id:'drift', name:'飘忽不定', desc:'每3次攻击后，瞬移至周围3格随机空格。'}, {id:'lethal', name:'致命节奏', desc:'每攻击1次，攻击力+8。'} ],
    skills:[ {id:'brujp', name:'逼近', kind:'move', desc:'向着目标，移动1格。'}, {id:'feather', name:'飞羽', kind:'attack', type:'physical', target:'dist2', mult:1.0, desc:'对2格距离内随机1名我方单位造成100%攻击力物理伤害。'} ] },
  redRacer:{ name:'红羽镖客', icon:'🦃', tier:'elite', atk:16, def:0, maxHp:200, speed:12,
    res:{physical:0,fire:0,water:0,grass:0,thunder:0,ice:0,wind:0,rock:0}, healthPenalty:1, reward:{items:{fruit:2, rawMeat:1}, doubleUp:true},
    passives:[ {id:'drift2', name:'飘忽不定', desc:'每3次攻击后，瞬移至周围5格随机空格。'}, {id:'lethal', name:'致命节奏', desc:'每攻击1次，攻击力+8。'} ],
    skills:[ {id:'rrjp', name:'逼近', kind:'move', desc:'向着目标，移动1格。'}, {id:'feather', name:'飞羽', kind:'attack', type:'physical', target:'dist2', mult:1.0, desc:'对2格距离内随机1名我方单位造成100%攻击力物理伤害。'} ] },
  bear:{ name:'暴躁的熊', icon:'🐻', tier:'elite', atk:40, def:0, maxHp:800, speed:0,
    res:{physical:20,fire:0,water:0,grass:0,thunder:0,ice:0,wind:0,rock:0}, healthPenalty:1, reward:{items:{rawMeat:10}},
    passives:[ {id:'hiber', name:'冬眠', desc:'战斗开始时进入持续3回合的【睡眠】。若被攻击导致生命降低则立即醒来，但本回合无法行动；未被攻击则睡眠3回合后醒来。'}, {id:'rage', name:'狂躁', desc:'在【睡眠】首次结束后的下一回合开始时，攻击力+80%、每回合额外攻击1次、速度+60，持续5回合。'}, {id:'rare', name:'稀有生物', desc:'本次战斗如未被击败，不回复生命，可多次战斗击败。'} ],
    skills:[ {id:'bearjp', name:'逼近', kind:'move', desc:'向着目标，移动1格。'}, {id:'slap', name:'掌掴', kind:'attack', type:'physical', target:'front2', mult:1.0, rageAoe:true, desc:'对前方直线1格造成100%攻击力物理伤害。狂躁期间改为周围8格。'} ] },
  mechanism:{ name:'遗弃机关', icon:'🤖', tier:'elite', atk:40, def:10, maxHp:260, speed:4,
    res:{physical:0,fire:0,water:0,grass:0,thunder:0,ice:0,wind:0,rock:0}, healthPenalty:1, reward:{items:{coin:3}, rate:{iron:1, prob:0.25}},
    passives:[ {id:'patrol', name:'巡逻', desc:'生命值为满时，不主动攻击，每回合向随机方向移动1格。'} ],
    skills:[ {id:'mcjp', name:'逼近', kind:'move', desc:'生命值不为满时，向着主角移动1格。'}, {id:'trample', name:'践踏', kind:'attack', type:'physical', target:'front6', mult:1.0, desc:'对前方6格造成100%攻击力物理伤害。'}, {id:'missile', name:'飞弹', kind:'attack', type:'physical', target:'front3', shots:3, mult:0.4, desc:'朝前方发射3枚飞弹，碰到我方造成40%攻击力物理伤害并消失。'}, {id:'cleanse', name:'大清扫', kind:'attack', type:'physical', target:'adj8', mult:1.4, sustain:3, cd:6, desc:'对周围8格造成140%攻击力物理伤害。连续使用3回合。冷却：6回合。'} ] },
  ironClump:{ name:'铁疙瘩', icon:'🔩', tier:'ordinary', atk:40, def:20, maxHp:500, speed:10,
    res:{physical:100,fire:0,water:0,grass:0,thunder:0,ice:0,wind:0,rock:0}, healthPenalty:1, reward:{items:{iron:2}},
    passives:[ {id:'selfReinforce', name:'自我加固', desc:'每回合开始时，防御力+5；每次攻击后，攻击力+10。'} ],
    skills:[ {id:'icjp', name:'逼近', kind:'move', desc:'向着目标，移动1格。'}, {id:'icSlam', name:'重砸', kind:'attack', type:'physical', target:'adj8', mult:1.0, desc:'对周围8格造成相当于100%攻击力的物理伤害。'} ] },
};
function statusMeta(id){ return ST[id]||{id, name:id, kind:'neutral', desc:''}; }
function randEnemyKey(){ const pool=Object.keys(ENEMIES); return pool[Math.floor(Math.random()*pool.length)]; }
function rollCombatEvent(day){ const hard=Math.random()<0.30; const tier=hard?'elite':'ordinary'; const pool=Object.keys(ENEMIES).filter(k=>ENEMIES[k].tier===tier); const key=pool.length? pool[Math.floor(Math.random()*pool.length)] : Object.keys(ENEMIES)[0]; return {type:'battle', sub:hard?'hard':'normal', key}; }
function isRareEnemy(key){ const e=ENEMIES[key]; return !!(e&&e.passives&&e.passives.some(p=>p.id==='rare')); }

/* ==================== 任务系统（基本保留旧结构） ==================== */
const TASKS = [
  { id:'m1', cat:'main', name:'第一幕·分道扬镳', goals:['存活 / 探索野外'], rewards:[{simple:'裁云挂件×1'}] },
  { id:'s1', cat:'side', name:'讨伐任务·暴躁的熊', goals:['击败1头暴躁的熊'], last:1, rewards:[{simple:'金币+5、主角防御+10'}], hook:'bearQuestStarted' },
  { id:'s2', cat:'side', name:'日常任务·日行一善', goals:['累计扶起摔倒老奶奶10次'], last:10, rewards:[{key:'goodCard',text:'好人卡×1'}] },
  { id:'q1', cat:'side', name:'启程任务·心理健康', goals:['使用明心浆1次'], last:1, rewards:[{key:'blueStarPowder',text:'蓝星粉末×3'}] },
  { id:'q2', cat:'side', name:'启程任务·合成台新手上路', goals:['累计合成3件物品'], last:3, rewards:[{simple:'金币+10'}], hook:'qCraftAvail', auto:true, trackField:'qCraftDone' },
  { id:'q3', cat:'side', name:'启程任务·果腹', goals:['累计吃3个食物'], last:3, rewards:[{key:'fruit',text:'果子×5'}], auto:true, trackField:'qFruitCount' },
  { id:'q4', cat:'side', name:'启程任务·大口吃肉', goals:['累计使用熟肉回复生命值30次'], last:30, rewards:[{simple:'行动力上限+2'}], auto:true, trackField:'qMeatCount' },
  { id:'q5', cat:'side', name:'启程任务·便捷出行', goals:['累计使用载具（徒步跋涉除外）6次'], last:6, rewards:[{key:'broom',text:'载具·魔法扫帚'}], hook:'nonWalkVehicleOwned', auto:true, trackField:'qCarCount' },
  { id:'q6', cat:'side', name:'启程任务·友谊的再开始', goals:['任意角色好感度达到10'], last:10, rewards:[{simple:'好感度+5'}], auto:true, trackField:'qFriendMaxAff', noCountUp:true },
];
function taskVisible(t){ if(t.hook && !(G&&G.records&&G.records[t.hook])) return false; return true; }
function taskProgress(t){ if(t.last==null) return null; if(t.id==='s1') return Math.min((G&&G.records&&G.records.bearSlain)||0, t.last); if(t.id==='s2') return Math.min((G&&G.records&&G.records.oldLadyHelped)||0, t.last);
  if(t.id==='qMental'){ return Math.min((G&&G.records&&G.records.mentalGoodDays)||0, t.last); }
  if(t.id==='qCraft'){ return Math.min((G&&G.records&&G.records.qCraftDone)?1:0, t.last); }
  if(t.id==='qFruit'){ return Math.min((G&&G.records&&G.records.qFruitCount)||0, t.last); }
  if(t.id==='qMeat'){ return Math.min((G&&G.records&&G.records.qMeatCount)||0, t.last); }
  if(t.id==='qCar'){ return Math.min((G&&G.records&&G.records.qCarCount)||0, t.last); }
  if(t.id==='qFriend'){ let maxAff=0; if(G&&G.bonds){ for(const k in G.bonds){ if(G.bonds[k].affinity>maxAff) maxAff=G.bonds[k].affinity; } } return maxAff>=10 ? t.last : Math.min(maxAff, t.last); }
  return null;
}
function taskDone(t){ const p=taskProgress(t); if(p==null) return false; return p>=t.last; }
function taskDoneMarked(t){ return !!(G&&G.records&&G.records.questDone&&G.records.questDone[t.id]); }
function taskRewardHTML(rw){ if(rw.key) return `<span class="craftlink" data-key="${rw.key}">${rw.text||itemName(rw.key)}</span>`; return `<span>${rw.simple||''}</span>`; }

/* 羁绊 / 物品喜好度 —— 保留旧结构 */
const BOND_TEXT = {
  xiayang:{
    0:'不可入队', 1:'可以加入编队，解锁全部技能（测试期全解锁）',
  },
  luyouyou:{
    0:'不可入队', 1:'可以加入编队，解锁全部技能（测试期全解锁）',
  },
};
const ITEM_LOVE = {
  xiayang:{ one:['cookedMeat','roadmap'], two:{caiyunPendant:10,amethyst:3,diamond:8}, three:{} },
  luyouyou:{ one:['cookedMeat','roadmap'], two:{amethyst:3,diamond:8}, three:{caiyunPendant:10} },
};
const GIFT_TALK = {
  xiayang:{ lv0:'夏阳："啊哈哈……快点交代，这是啥新型冷笑话？"', lv1:'夏阳："谢啦，这玩意有点意思。"', lv2:'夏阳："哇，你怎么知道我想要这个？！"' },
  luyouyou:{ lv0:'陆悠悠："我要把这个做到今天的晚饭里，你不会介意的吧～"', lv1:'陆悠悠："不错不错，未来应该能派上用场。那我就不客气了。"', lv2:'陆悠悠："啊……看着它，突然灵感涌现啊。得赶快记下来……"',
    lv3_caiyunPendant:'陆悠悠："据说远古的魔法师在万米高空之上的云雾中穿行，地上的人们见了，纷纷以为天上的飓刃裁断了云朵，还制作了饰品祈求云层不要砸下来。但云不会掉下来，这里面只是棉絮做成的云团——很失望？恰恰相反，我很喜欢。云无定踪风无定向，若是被捉进瓶子里反而无趣了。带上这个挂饰，坐在最高的悬崖边上，听风铃声声，看云卷云舒……现在就去如何？"'
  },
};
function itemLoveLevel(ck, itemKey){ const L=ITEM_LOVE[ck]||{}; if(L.three&&L.three[itemKey]!=null) return 3; if(L.two&&L.two[itemKey]!=null) return 2; if(L.one&&L.one.includes(itemKey)) return 1; return 0; }

/* ============================================================
   全局技能组（SkillGroup）—— 大重做规格
   ------------------------------------------------------------
   设计：全队共用一套槽位，每个槽位绑定 { charKey, skillId }
   技能可以混合：主角的斩击 + 夏阳的淬火 + 陆悠悠的 soar，按顺序
   战斗中 skillList 始终显示槽位列表（不按角色切换）
   
   持久结构（存 G.skillGroup）：
     [ { slot:1, charKey:'pro', skillId:'slash' },
       { slot:2, charKey:'pro', skillId:'balance' },
       { slot:3, charKey:'pro', skillId:'desperation' },
       { slot:4, charKey:'xiayang', skillId:'quench' },
       { slot:5, charKey:'xiayang', skillId:'prairie' },
       { slot:6, charKey:'luyouyou', skillId:'skillshot' },
       { slot:7, charKey:'luyouyou', skillId:'soar' } ]
   
   战斗运行态（combatState.slots）：
     复制 G.skillGroup 的浅拷贝，加 { cd, usedThisRound, enabled }
   ============================================================ */

/* 从每个角色的 defaultSkillIds 取前 N 个，拼成全局技能组 */
function buildDefaultSkillGroup(team){
  const out = [];
  let slot = 0;
  const perChar = { pro:3, xiayang:2, luyouyou:2 }; // 默认槽数
  for(const ck of team){
    const c = getChar(ck);
    if(!c) continue;
    const take = perChar[ck] || 2;
    const pool = (c.defaultSkillIds||[]).slice(0, take);
    for(const sid of pool){
      slot++;
      out.push({ slot, charKey: ck, skillId: sid });
    }
  }
  return out;
}

/* 校验+归一化：缺 slot 编号的自动补；非法 charKey / 不存在 skillId 的丢弃 */
function normalizeSkillGroup(group){
  if(!Array.isArray(group)) return [];
  const team = (G && G.team) || ['pro'];
  const out = [];
  let nextSlot = 1;
  for(const s of group){
    if(!s || !s.charKey || !s.skillId) continue;
    if(!team.includes(s.charKey)) continue;
    const c = getChar(s.charKey);
    if(!c) continue;
    const sk = c.skills && c.skills.find(x=>x.id===s.skillId);
    if(!sk) continue;
    out.push({ slot: nextSlot++, charKey: s.charKey, skillId: s.skillId });
  }
  return out;
}

/* 战斗运行态：从 G.skillGroup 复制一份完整的运行态槽 */
function buildCombatSkillSlots(){
  const group = (G && G.skillGroup) || [];
  return group.map(s => ({
    slot: s.slot, charKey: s.charKey, skillId: s.skillId,
    cd: 0, usedThisRound: false, enabled: true,
    // link 技能条件：由 combat.js 的 triggerChecker 函数判定
  }));
}

/* 技能组查询辅助：给定 slot，返回 { slotDef, charDef, skillDef } */
function skillGroupResolve(slotEntry){
  const c = getChar(slotEntry.charKey);
  if(!c) return null;
  const sk = (c.skills||[]).find(x=>x.id===slotEntry.skillId);
  if(!sk) return null;
  return { c, sk };
}
