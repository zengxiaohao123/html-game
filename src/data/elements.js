// src/data/elements.js
// 7 种元素定义 + 物理（物理不属于元素，但统一放一起方便查找）
// 设计文档 §8

export const ELEMENTS = {
  physical: { id: 'physical', name: '物理', emoji: '⚔️' },
  fire:     { id: 'fire',     name: '火',   emoji: '🔥' },
  water:    { id: 'water',    name: '水',   emoji: '💧' },
  thunder:  { id: 'thunder',  name: '雷',   emoji: '⚡' },
  ice:      { id: 'ice',      name: '冰',   emoji: '❄️' },
  grass:    { id: 'grass',    name: '草',   emoji: '🌿' },
  wind:     { id: 'wind',     name: '风',   emoji: '🌀' },
  rock:     { id: 'rock',     name: '岩',   emoji: '🪨' },
};

export const ALL_ELEMENTS = Object.keys(ELEMENTS);

// 非物理元素（7 种）
export const MAGICAL_ELEMENTS = ALL_ELEMENTS.filter(e => e !== 'physical');
