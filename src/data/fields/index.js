// src/data/fields/index.js
// 田块注册表：一个田块一个文件，新增田块只需在此追加一行。
// 21 种田块（FAC-001 ~ FAC-025）全部在本目录；facilities.js 只保留设施与资源。

import { WheatField } from './wheat.js';
import { PotatoField } from './potato.js';
import { TulipField } from './tulip.js';
import { StrawberryField } from './strawberry.js';
import { PeaField } from './pea.js';
import { CornField } from './corn.js';
import { CabbageField } from './cabbage.js';
import { WildSeedField } from './wild_seed.js';
import { DandelionField } from './dandelion.js';
import { GhostGrassField } from './ghost_grass.js';
import { MugwortField } from './mugwort.js';
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
  WheatField,
  PotatoField,
  TulipField,
  StrawberryField,
  PeaField,
  CornField,
  CabbageField,
  WildSeedField,
  DandelionField,
  GhostGrassField,
  MugwortField,
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
  WheatField, PotatoField, TulipField, StrawberryField, PeaField, CornField,
  CabbageField, WildSeedField, DandelionField, GhostGrassField, MugwortField,
  RiceField, LavenderField, SunflowerField, HopsField, PumpkinField,
  StarfruitField, MushroomField, BlackberryField, SorrelField, BlueStarFruitField,
};
