// src/data/fields/index.js
// 田块增量注册表：一个田块一个文件，新增田块只需在此追加一行。
//
// 已迁移：水稻（v0.6 改写）+ 9 种新增田块（FAC-017 ~ FAC-025）
// 其余旧田块（小麦/土豆/郁金香/草莓/豌豆/玉米/卷心菜/野生种子/蒲公英/幽怜草/艾草）
// 仍位于 facilities.js，后续可按同一模式逐个迁移，不影响本表增量追加。

import { RiceField } from './rice.js';
import { LavenderField } from './lavender.js';
import { SunflowerField } from './sunflower.js';
import { HopsField } from './hops.js';
import { PumpkinField } from './pumpkin.js';
import { StarfruitField } from './starfruit.js';
import { MushroomField } from './mushroom.js';
import { BlackberryField } from './blackberry.js';
import { SorrelField } from './sorrel.js';
import { BlueStarFruitField } from './blue_star_fruit.js';

export const FIELD_DEFS = [
  RiceField,
  LavenderField,
  SunflowerField,
  HopsField,
  PumpkinField,
  StarfruitField,
  MushroomField,
  BlackberryField,
  SorrelField,
  BlueStarFruitField,
];

export {
  RiceField, LavenderField, SunflowerField, HopsField, PumpkinField,
  StarfruitField, MushroomField, BlackberryField, SorrelField, BlueStarFruitField,
};
