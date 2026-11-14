import assert from "node:assert/strict";
import test from "node:test";
import {
  closestPointOnSegment2D,
  evaluateHuntRank,
  formatQuestClock,
  resolveMonsterHit
} from "../src/game-rules.mjs";
import {
  createSaveState,
  mergeHuntRecord,
  normalizeSaveState,
  readRecords,
  writeRecords
} from "../src/save-system.mjs";
import { DEFAULT_SETTINGS, normalizeSettings, readSettings, writeSettings } from "../src/settings.mjs";
import {
  ARENA,
  ASSET_VERSION,
  STATIC_OBSTACLES,
  WEAPON_PROFILES,
  assetUrl,
  clampToArena,
  lerpAngle,
  resolveStaticCollisions
} from "../src/constants.mjs";

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key)
  };
}

test("quest clock formats seconds as MM:SS and never goes negative", () => {
  assert.equal(formatQuestClock(900), "15:00");
  assert.equal(formatQuestClock(61.9), "01:01");
  assert.equal(formatQuestClock(-5), "00:00");
  assert.equal(formatQuestClock(NaN), "00:00");
});

test("hunt rank depends on clear time and damage taken", () => {
  assert.equal(evaluateHuntRank({ victory: true, elapsedSeconds: 150, damageTaken: 20 }), "S");
  assert.equal(evaluateHuntRank({ victory: true, elapsedSeconds: 150, damageTaken: 90 }), "A");
  assert.equal(evaluateHuntRank({ victory: true, elapsedSeconds: 400, damageTaken: 0 }), "B");
  assert.equal(evaluateHuntRank({ victory: true, elapsedSeconds: 700, damageTaken: 0 }), "C");
  assert.equal(evaluateHuntRank({ victory: false, elapsedSeconds: 10, damageTaken: 0 }), null);
});

test("closest point on a segment clamps to the endpoints", () => {
  assert.deepEqual(closestPointOnSegment2D(5, 3, 0, 0, 10, 0), { t: 0.5, x: 5, z: 0, distance: 3 });
  assert.equal(closestPointOnSegment2D(-4, 0, 0, 0, 10, 0).t, 0);
  assert.equal(closestPointOnSegment2D(20, 0, 0, 0, 10, 0).distance, 10);
});

test("monster hits resolve to head, body or tail along the spine", () => {
  const spine = { tail: { x: 0, z: -10 }, head: { x: 0, z: 6 } };
  const zones = { tailUntil: 0.4, headFrom: 0.8 };
  const radii = { head: 1.7, body: 2.3, tail: 1 };
  const hit = (x, z) => resolveMonsterHit({ strike: { x, z, radius: 2 }, spine, zones, radii });
  assert.equal(hit(0, 8).zone, "head");
  assert.equal(hit(3, 0).zone, "body");
  assert.equal(hit(2, -8).zone, "tail");
  assert.equal(hit(4, -8), null);
  assert.equal(hit(10, 0), null);
});

test("save state keeps quest progress and tolerates old saves without it", () => {
  const state = createSaveState({ quest: { elapsed: 42.5, damageDealt: 300, hits: 7, perfectDodges: 2 } });
  assert.equal(state.quest.elapsed, 42.5);
  assert.equal(state.quest.perfectDodges, 2);
  const legacy = normalizeSaveState({ version: 1, player: { hp: 50 }, monster: { hp: 400 } });
  assert.equal(legacy.quest.elapsed, 0);
  assert.equal(legacy.quest.hits, 0);
});

test("records only improve and report a new best time", () => {
  const first = mergeHuntRecord({}, { elapsedSeconds: 200, rank: "B" });
  assert.equal(first.isNewBestTime, true);
  const slower = mergeHuntRecord(first.records, { elapsedSeconds: 260, rank: "S" });
  assert.equal(slower.isNewBestTime, false);
  assert.deepEqual(slower.records, { bestTimeSeconds: 200, bestRank: "S" });
  const storage = memoryStorage();
  assert.equal(writeRecords(storage, slower.records), true);
  assert.deepEqual(readRecords(storage), slower.records);
  assert.deepEqual(readRecords(memoryStorage()), { bestTimeSeconds: null, bestRank: null });
});

test("settings reject non-numeric coercion and persist normalized values", () => {
  const settings = normalizeSettings({ masterVolume: 9, hudScale: 0.1, graphicsQuality: "ultra", showMinimap: "yes" });
  assert.equal(settings.masterVolume, 1);
  assert.equal(settings.hudScale, 0.8);
  assert.equal(settings.graphicsQuality, DEFAULT_SETTINGS.graphicsQuality);
  assert.equal(settings.showMinimap, true);

  // 空字串、布林值、文字與非有限數字不該被 Number(...) 強制轉型覆蓋預設值
  const coerced = normalizeSettings({
    masterVolume: "",
    cameraSensitivity: false,
    cameraShake: true,
    hudScale: "0.9",
    masterVolumeNaN: NaN
  });
  assert.equal(coerced.masterVolume, DEFAULT_SETTINGS.masterVolume);
  assert.equal(coerced.cameraSensitivity, DEFAULT_SETTINGS.cameraSensitivity);
  assert.equal(coerced.cameraShake, DEFAULT_SETTINGS.cameraShake);
  assert.equal(coerced.hudScale, DEFAULT_SETTINGS.hudScale);

  const storage = memoryStorage();
  writeSettings(storage, { ...settings, showMinimap: false, graphicsQuality: "low" });
  assert.equal(readSettings(storage).showMinimap, false);
  assert.equal(readSettings(storage).graphicsQuality, "low");
  assert.deepEqual(readSettings(null), { ...DEFAULT_SETTINGS });
});

test("constants expose valid weapon profiles, versioned asset URLs, and arena math", () => {
  assert.ok(WEAPON_PROFILES.greatsword.strikeRadius > 0);
  assert.ok(WEAPON_PROFILES.dualblades.strikeRadius > 0);
  const url = assetUrl("hunter");
  assert.match(url, new RegExp(`assets/models/hunter\\.glb\\?v=${ASSET_VERSION}$`));

  // lerpAngle takes the shortest path across PI / -PI wraparound
  const wrapped = lerpAngle(Math.PI - 0.1, -Math.PI + 0.1, 0.5);
  assert.ok(Math.abs(Math.sin(wrapped)) < 1e-6 && Math.cos(wrapped) < 0);

  // clampToArena pulls out-of-bounds positions onto boundary circle centered on ARENA
  const inside = { x: ARENA.centerX + 2, z: ARENA.centerZ };
  assert.equal(clampToArena(inside, ARENA.radius), false);

  const outside = { x: ARENA.centerX + ARENA.radius + 10, z: ARENA.centerZ };
  assert.equal(clampToArena(outside, ARENA.radius), true);
  assert.ok(Math.abs(outside.x - (ARENA.centerX + ARENA.radius)) < 1e-6);

  // resolveStaticCollisions pushes hunter out of ancient bone site obstacle
  const boneObs = STATIC_OBSTACLES[0];
  const colliding = { x: boneObs.ax + 0.2, z: boneObs.az + 1.0 };
  resolveStaticCollisions(colliding, 0.6);
  const distFromSpine = Math.abs(colliding.x - boneObs.ax);
  assert.ok(distFromSpine >= boneObs.radius + 0.6 - 1e-6);
});
