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

export const QUEST_TIME_LIMIT_SECONDS = 15 * 60;

export const HUNT_RANKS = Object.freeze(["S", "A", "B", "C"]);

/** 把秒數格式化成任務計時器使用的 MM:SS。 */
export function formatQuestClock(seconds) {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/** 依討伐時間與承受傷害評定任務評價；未達成任務時不給評價。 */
export function evaluateHuntRank({ victory, elapsedSeconds, damageTaken }) {
  if (!victory) return null;
  const time = Math.max(0, Number.isFinite(elapsedSeconds) ? elapsedSeconds : Infinity);
  const taken = Math.max(0, Number.isFinite(damageTaken) ? damageTaken : Infinity);
  if (time <= 180 && taken <= 40) return "S";
  if (time <= 300 && taken <= 100) return "A";
  if (time <= 480) return "B";
  return "C";
}

/** 平面 (XZ) 上，點到線段的最近點（寫入既有 out 物件，避免每幀產生暫時物件）；t=0 為 a 端、t=1 為 b 端。 */
export function closestPointOnSegment2DInto(px, pz, ax, az, bx, bz, out = { t: 0, x: 0, z: 0, distance: 0 }) {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq > 0 ? clamp(((px - ax) * dx + (pz - az) * dz) / lengthSq, 0, 1) : 0;
  const x = ax + dx * t;
  const z = az + dz * t;
  out.t = t;
  out.x = x;
  out.z = z;
  out.distance = Math.hypot(px - x, pz - z);
  return out;
}

/** 平面 (XZ) 上，點到線段的最近點；t=0 為 a 端、t=1 為 b 端。 */
export function closestPointOnSegment2D(px, pz, ax, az, bx, bz) {
  return closestPointOnSegment2DInto(px, pz, ax, az, bx, bz, { t: 0, x: 0, z: 0, distance: 0 });
}

/**
 * 以魔物脊椎線段（尾端 → 頭端）判定一次揮擊命中的部位。
 * zones.tailUntil／zones.headFrom 是線段參數 t 上的分界；radii 為各部位的身體半徑。
 * 未命中時回傳 null。
 */
export function resolveMonsterHit({ strike, spine, zones, radii }) {
  const closest = closestPointOnSegment2D(
    strike.x, strike.z,
    spine.tail.x, spine.tail.z,
    spine.head.x, spine.head.z
  );
  const zone = closest.t >= zones.headFrom ? "head" : (closest.t <= zones.tailUntil ? "tail" : "body");
  const reach = Math.max(0, strike.radius) + Math.max(0, radii[zone] ?? 0);
  if (closest.distance > reach) return null;
  return { zone, t: closest.t, distance: closest.distance, point: { x: closest.x, z: closest.z } };
}
