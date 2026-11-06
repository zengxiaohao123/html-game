// src/ui/staminaGems.js
// 行动力水晶展示纯函数（§5.1 展示规则 / §16.7 HUD）
//
// 规则（用户 2026-11-06 逐条确认，水晶只是展示，不参与数值算法）：
//   · current >= 0：蓝单位 = min(current, cap)，黄单位 = max(0, current - cap)，
//                   白单位 = max(0, cap - current)。
//   · current < 0：红单位 = min(-current, cap)，其余为白；不会出现黄色。
//   · 实心单位按「蓝在前、黄在后」排队，再从左往右按 10 个一组切块；
//     **剩余单位数 > 10 才切出一个大水晶**（恰好 10 点不出大水晶），剩余 ≤ 10 全部用小水晶。
//   · 大水晶颜色：该 10 点块里只要含任何黄单位 → 大黄；全是蓝单位 → 大蓝。
//   · 摆放顺序：大蓝 → 大黄 → 小蓝 → 小黄 → 白（负数时：红 → 白）。
//   · 蓝色小水晶被消耗时从右往左依次变白；黄色小水晶被消耗时直接消失（数值重算后不再存在）。
//
// 返回的 gems 是可直接渲染的视图模型数组；同时返回各计数，便于自测断言。

/**
 * @param {number} cap 行动力上限（当前 8）
 * @param {number} current 当前行动力（可为负）
 * @returns {{gems: Array<{size: 'big'|'small', color: 'blue'|'yellow'|'white'|'red'}>, bigBlue: number, bigYellow: number, smallBlue: number, smallYellow: number, red: number, white: number}}
 */
export function renderStamina(cap, current) {
  const c = Math.max(0, Math.floor(Number.isFinite(cap) ? cap : 0));
  const cur = Math.floor(Number.isFinite(current) ? current : 0);

  const gems = [];
  let bigBlue = 0, bigYellow = 0, smallBlue = 0, smallYellow = 0, red = 0, white = 0;

  if (cur < 0) {
    red = Math.min(-cur, c);
    white = c - red;
    for (let i = 0; i < red; i++) gems.push({ size: 'small', color: 'red' });
    for (let i = 0; i < white; i++) gems.push({ size: 'small', color: 'white' });
    return { gems, bigBlue, bigYellow, smallBlue, smallYellow, red, white };
  }

  let blueLeft = Math.min(cur, c);
  let yellowLeft = Math.max(0, cur - c);
  white = Math.max(0, c - cur);

  // 实心单位：蓝在前、黄在后，按 10 个一组切大水晶（必须剩余 > 10 才切）
  let solid = blueLeft + yellowLeft;
  while (solid > 10) {
    const takeBlue = Math.min(blueLeft, 10);
    const takeYellow = 10 - takeBlue;
    if (takeYellow > 0) bigYellow += 1;
    else bigBlue += 1;
    blueLeft -= takeBlue;
    yellowLeft -= takeYellow;
    solid -= 10;
  }
  smallBlue = blueLeft;
  smallYellow = yellowLeft;

  // 摆放顺序：大蓝 → 大黄 → 小蓝 → 小黄 → 白
  for (let i = 0; i < bigBlue; i++) gems.push({ size: 'big', color: 'blue' });
  for (let i = 0; i < bigYellow; i++) gems.push({ size: 'big', color: 'yellow' });
  for (let i = 0; i < smallBlue; i++) gems.push({ size: 'small', color: 'blue' });
  for (let i = 0; i < smallYellow; i++) gems.push({ size: 'small', color: 'yellow' });
  for (let i = 0; i < white; i++) gems.push({ size: 'small', color: 'white' });

  return { gems, bigBlue, bigYellow, smallBlue, smallYellow, red, white };
}
