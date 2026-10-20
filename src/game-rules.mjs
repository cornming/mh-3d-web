export const SHARPNESS_LEVELS = Object.freeze([
  Object.freeze({ name: "白斬", color: "#f5f6fa", mult: 1.32, minVal: 75 }),
  Object.freeze({ name: "藍斬", color: "#00d2d3", mult: 1.20, minVal: 40 }),
  Object.freeze({ name: "綠斬", color: "#2ecc71", mult: 1.05, minVal: 15 }),
  Object.freeze({ name: "黃斬", color: "#f1c40f", mult: 0.85, minVal: 0 })
]);

export function clamp(value, min, max) {
  if (min > max) {
    throw new RangeError("min must not be greater than max");
  }
  return Math.min(max, Math.max(min, value));
}

export function getSharpnessLevel(value, levels = SHARPNESS_LEVELS) {
  const normalizedValue = clamp(value, 0, 100);
  return levels.find((level) => normalizedValue >= level.minVal) ?? levels[levels.length - 1];
}

export function calculateAttackDamage({
  baseDamage,
  sharpnessMultiplier,
  weakpointMultiplier = 1,
  chargeMultiplier = 1,
  comboMultiplier = 1
}) {
  const damage = baseDamage * sharpnessMultiplier * weakpointMultiplier * chargeMultiplier * comboMultiplier;
  return Math.max(0, Math.floor(damage));
}

export function getChargeLevel(chargeTime, stepDuration = 0.55, maxLevel = 3) {
  if (stepDuration <= 0 || maxLevel < 1) {
    throw new RangeError("charge configuration must be positive");
  }
  const normalizedTime = Math.max(0, Number.isFinite(chargeTime) ? chargeTime : 0);
  return Math.min(maxLevel, 1 + Math.floor(normalizedTime / stepDuration));
}

export function nextComboStep(currentStep, comboWindowActive, comboLength = 3) {
  if (comboLength < 1) {
    throw new RangeError("comboLength must be positive");
  }
  if (!comboWindowActive) {
    return 0;
  }
  const normalizedStep = clamp(Math.floor(currentStep), 0, comboLength - 1);
  return (normalizedStep + 1) % comboLength;
}

export function isWithinRange(distance, range) {
  return distance >= 0 && distance <= range;
}
