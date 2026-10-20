import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateAttackDamage,
  getChargeLevel,
  getSharpnessLevel,
  isWithinRange,
  nextComboStep
} from "../src/game-rules.mjs";

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
