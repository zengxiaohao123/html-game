// 三天赋适配审计后的回归断言（2026-11）
// 覆盖：活力满满负值边界 / 巧遇发放·限次·自动卸下·离队回收 / 比翼 1 号位归属 /
//       通用技能归属解析 / 编队纯调序 / 图鉴归属文本
// 用法：node tools/smoke-talents.mjs

globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
};

import { createInitialState } from '../src/state/gameState.js';
import { registerFacilities } from '../src/data/facilities.js';
import { SleepSystem } from '../src/systems/SleepSystem.js';
import { TalentSystem } from '../src/systems/TalentSystem.js';
import { VehicleSystem } from '../src/systems/VehicleSystem.js';
import { SkillResolve } from '../src/systems/SkillResolve.js';
import { SKILLS, getLeadRoleId, resolveSkillOwnerId } from '../src/data/characters.js';
import { TeamPanel } from '../src/ui/panels/TeamPanel.js';
import { CodexPanel } from '../src/ui/panels/CodexPanel.js';

let pass = 0, fail = 0;
function check(cond, msg) {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.log(`  ❌ ${msg}`); }
}

registerFacilities();

function mkGS(roles = ['yumo'], stamina = 8, x = 6) {
  const gs = createInitialState();
  gs.team.groups[0].roles = roles.slice();
  gs.player.stamina = stamina;
  gs.player.x = x;
  return gs;
}

console.log('═══ 1. 活力满满：负值且无心力交瘁 buff 睡觉 ═══');
{
  const gs = mkGS(['xiayang'], -2, 6);
  check(!gs.activeBuffs.some(b => b.id === 'exhausted'), '前置：没有心力交瘁 buff');
  SleepSystem.sleep(gs, false);
  // 正确语义：行动力 < 0 即按心力交瘁 → 负数归 0 再回一半（4），活力满满不生效
  check(gs.player.stamina === 4, `在家 -2 睡觉 → 4（实际 ${gs.player.stamina}）`);
  check(!gs.activeBuffs.some(b => b.id === 'exhausted'), '心力交瘁没有残留到新的一天');
}
{
  const gs = mkGS(['xiayang'], -1, 0);
  SleepSystem.sleep(gs, false);
  check(gs.player.stamina === 4, `非在家 -1 睡觉 → 4（实际 ${gs.player.stamina}）`);
}
{
  const gs = mkGS(['xiayang'], 5, 6);
  SleepSystem.sleep(gs, false);
  check(gs.player.stamina === 10, `在家 5 睡觉 → 10（回满 +2，实际 ${gs.player.stamina}）`);
}

console.log('\n═══ 2. 巧遇：发放 / 每日限次 / 自动卸下 / 离队回收 ═══');
{
  const gs = mkGS(['xiayang']);
  VehicleSystem.syncTalentVehicles(gs);
  const chance = gs.vehicle.available.filter(v => v.vehicleId === 'vehicle_chance');
  check(chance.length === 1, `夏阳在队 → 补发 1 件巧遇（实际 ${chance.length}）`);
  VehicleSystem.syncTalentVehicles(gs);
  check(gs.vehicle.available.filter(v => v.vehicleId === 'vehicle_chance').length === 1, '重复同步不会叠发');

  check(VehicleSystem.attachVehicle(gs, chance[0].instanceId) === true, '可以正常装载');
  gs.uiState.lastMoveAt = 0;
  const r1 = VehicleSystem.tryMove(gs, { targetIdx: 0 });
  check(r1.ok === true && r1.finalIdx === 0, '第一次使用成功（移动到目标格）');
  check(gs.vehicle.chanceUsedToday === true, '当日次数标记已用');
  check(gs.vehicle.current === null, '用完后自动卸下（不会锁死方向键）');
  check(VehicleSystem.attachVehicle(gs, chance[0].instanceId) === false, '当日再次装载被拒绝');

  VehicleSystem.onDayStart(gs);
  check(gs.vehicle.chanceUsedToday === false, '换日后次数重置');
  check(VehicleSystem.attachVehicle(gs, chance[0].instanceId) === true, '换日后可再次装载');

  gs.team.groups[0].roles = ['yumo'];
  VehicleSystem.syncTalentVehicles(gs);
  check(gs.vehicle.current === null, '夏阳离队 → 装载中的巧遇强制卸下');
  check(gs.vehicle.available.filter(v => v.vehicleId === 'vehicle_chance').length === 0, '夏阳离队 → 巧遇收回');
}
{
  const gs = mkGS(['yumo']);
  VehicleSystem.gainVehicle(gs, 'vehicle_chance');
  const inst = gs.vehicle.available[0];
  check(VehicleSystem.attachVehicle(gs, inst.instanceId) === false, '夏阳不在队 → 不允许装载');
}

console.log('\n═══ 3. 比翼：1 号位归属 ═══');
{
  const gs = mkGS(['luyouyou', 'xiayang']);
  TalentSystem.onCrit(gs, { attackerRoleId: 'luyouyou' });
  check(gs.team.twinBuffNextAtkCritRateBonus === 1, '陆悠悠暴击 → 比翼 buff 触发');

  const generic = SkillResolve.createSettlement(gs, { skillId: 'skill_zongheng', roleId: null });
  check(generic.batch.roleId === 'luyouyou' && generic.batch.attackerRoleId === 'luyouyou',
    `通用技能归属解析为 1 号位（实际 ${generic.batch.roleId}）`);
  const consume = TalentSystem.consumeTwinBuffIfAny(gs, generic.batch.attackerRoleId);
  check(consume.consumed === false && gs.team.twinBuffNextAtkCritRateBonus === 1,
    '1 号位=陆悠悠时，通用技能不吃掉自己的比翼 buff');

  TalentSystem.onCrit(gs, { attackerRoleId: generic.batch.attackerRoleId });
  check(gs.team.twinBuffActiveDays === 99, '通用技能暴击按陆悠悠触发比翼（不叠加）');

  const res = TalentSystem.onDamageDeal(gs, { attackerRoleId: generic.batch.attackerRoleId, defender: {} });
  check(res.critRateBonusForAttacker === 0.3, `通用技能吃到风息 +30% 暴击（实际 ${res.critRateBonusForAttacker}）`);

  gs.team.groups[0].roles = ['yumo', 'xiayang'];
  TalentSystem.onTeamChange(gs);
  check(gs.team.twinBuffNextAtkCritRateBonus === 0 && gs.team.twinBuffActiveDays === 0,
    '陆悠悠离队 → 比翼 buff 立即清除');
}
{
  const gs = mkGS(['yumo', 'luyouyou']);
  TalentSystem.onCrit(gs, { attackerRoleId: 'luyouyou' });
  const consume = TalentSystem.consumeTwinBuffIfAny(gs, 'yumo');
  check(consume.consumed === true && consume.add === 1 && gs.team.twinBuffNextAtkCritRateBonus === 0,
    '1 号位=余默时，专属于余默的技能正常消费比翼 buff');
}

console.log('\n═══ 4. 通用技能归属解析 ═══');
{
  const gs = mkGS(['luyouyou', 'xiayang']);
  check(getLeadRoleId(gs) === 'luyouyou', '1 号位 = roles[0]');
  check(resolveSkillOwnerId(gs, SKILLS.skill_zongheng) === 'luyouyou', '合纵连横（通用）→ 1 号位');
  check(resolveSkillOwnerId(gs, SKILLS.skill_link_shift) === 'luyouyou', '移形（通用连携）→ 1 号位');
  check(resolveSkillOwnerId(gs, SKILLS.skill_link_yumo_drain) === 'yumo', '专属技能保持自身 roleId');
  gs.team.groups[0].roles = ['xiayang', 'luyouyou'];
  check(resolveSkillOwnerId(gs, SKILLS.skill_zongheng) === 'xiayang', '调换 1 号位后归属即时变化');
}

console.log('\n═══ 5. 编队：纯调序算修改 ═══');
{
  const panel = Object.create(TeamPanel.prototype);
  check(panel._sameComposition(['xiayang', 'yumo'], 'momo', ['yumo', 'xiayang'], 'momo') === false,
    '仅调换 1 号位顺序 → 视为修改（可保存）');
  check(panel._sameComposition(['xiayang', 'yumo'], 'momo', ['xiayang', 'yumo'], 'momo') === true,
    '完全相同的编队 → 不算修改');
}

console.log('\n═══ 6. 图鉴归属文本实时 ═══');
{
  const gs = mkGS(['luyouyou', 'xiayang']);
  const panel = Object.create(CodexPanel.prototype);
  panel.director = { gs };
  const txt1 = panel._skillOwnerText(SKILLS.skill_zongheng);
  check(txt1.includes('当前归属') && txt1.includes('陆悠悠'), `图鉴显示通用归属：${txt1}`);
  gs.team.groups[0].roles = ['xiayang', 'luyouyou'];
  const txt2 = panel._skillOwnerText(SKILLS.skill_zongheng);
  check(txt2.includes('夏阳'), `1 号位变动后文本即时更新：${txt2}`);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
