import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateAttackDamage,
  getChargeLevel,
  getSharpnessLevel,
  isWithinRange,
  nextComboStep
} from "../src/game-rules.mjs";
import {
  SAVE_KEY,
  STATS_KEY,
  createSaveState,
  normalizeSaveState,
  readSave,
  readStats,
  removeSave,
  writeSave,
  writeStats
} from "../src/save-system.mjs";

test("sharpness levels resolve from highest matching threshold", () => {
  assert.equal(getSharpnessLevel(100).name, "白斬");
  assert.equal(getSharpnessLevel(74.99).name, "藍斬");
  assert.equal(getSharpnessLevel(15).name, "綠斬");
  assert.equal(getSharpnessLevel(0).name, "黃斬");
});

test("attack damage combines combat multipliers and floors the result", () => {
  assert.equal(calculateAttackDamage({
    baseDamage: 100,
    sharpnessMultiplier: 1.2,
    weakpointMultiplier: 1.35,
    chargeMultiplier: 1.25,
    comboMultiplier: 1.1
  }), 222);
});

test("charge levels increase at each charge threshold", () => {
  assert.equal(getChargeLevel(0), 1);
  assert.equal(getChargeLevel(0.55), 2);
  assert.equal(getChargeLevel(1.1), 3);
  assert.equal(getChargeLevel(10), 3);
});

test("combo steps reset after the input window closes and wrap at three", () => {
  assert.equal(nextComboStep(0, false), 0);
  assert.equal(nextComboStep(0, true), 1);
  assert.equal(nextComboStep(1, true), 2);
  assert.equal(nextComboStep(2, true), 0);
});

test("range checks reject negative distances", () => {
  assert.equal(isWithinRange(4.9, 5), true);
  assert.equal(isWithinRange(5.1, 5), false);
  assert.equal(isWithinRange(-1, 5), false);
});

test("save state round-trips combat progress and clamps unsafe values", () => {
  const storage = new Map();
  storage.getItem = storage.get.bind(storage);
  storage.setItem = (key, value) => storage.set(key, value);
  storage.removeItem = storage.delete.bind(storage);

  const state = createSaveState({
    player: { hp: 87, stamina: 42, sharpness: 18, potions: 2 },
    monster: { hp: 340, headHp: 0, tailHp: 90, isHeadBroken: true, isTailBroken: false },
    hunterPosition: { x: 4, y: 0, z: 18 },
    monsterPosition: { x: -2, y: 0, z: -8 },
    camera: { yaw: 1.2, pitch: 0.5 },
    stats: { hunts: 3, victories: 2, defeats: 1 },
    weaponMode: "dualblades"
  });

  assert.equal(writeSave(storage, state), true);
  assert.equal(storage.has(SAVE_KEY), true);
  assert.equal(storage.has(STATS_KEY), true);
  assert.deepEqual(readSave(storage).player.position, { x: 4, y: 0, z: 18 });
  assert.equal(readSave(storage).monster.isHeadBroken, true);
  assert.equal(readSave(storage).monster.hasRoared60, true);
  assert.equal(readSave(storage).monster.hasRoared25, false);
  assert.equal(readSave(storage).equipment.weaponMode, "dualblades");
  assert.deepEqual(readStats(storage), { hunts: 3, victories: 2, defeats: 1 });
  assert.equal(writeSave(storage, { ...state, player: { ...state.player, hp: 0 } }), false);
  assert.equal(writeStats(storage, { hunts: 4, victories: 3, defeats: 1 }), true);
  assert.deepEqual(readStats(storage), { hunts: 4, victories: 3, defeats: 1 });

  const unsafe = normalizeSaveState({
    version: 1,
    player: { hp: 999, stamina: -10, sharpness: 400, potions: 9 },
    monster: { hp: -2, headHp: 900, tailHp: -4 },
    camera: { pitch: 9 }
  });
  assert.equal(unsafe.player.hp, 100);
  assert.equal(unsafe.player.stamina, 0);
  assert.equal(unsafe.player.potions, 3);
  assert.equal(unsafe.monster.hp, 0);
  assert.equal(unsafe.camera.pitch, 1.2);
  assert.equal(removeSave(storage), true);
  assert.equal(readSave(storage), null);
});
