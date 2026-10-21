export const SAVE_KEY = "mh3d-web-save-v1";
export const STATS_KEY = "mh3d-web-stats-v1";
export const SAVE_VERSION = 1;

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function integer(value, fallback, min = 0) {
  const normalized = Math.floor(finite(value, fallback));
  return Math.max(min, normalized);
}

export function normalizeStats(stats = {}) {
  return {
    hunts: integer(stats?.hunts, 0),
    victories: integer(stats?.victories, 0),
    defeats: integer(stats?.defeats, 0)
  };
}

export function createSaveState({ player, monster, hunterPosition, monsterPosition, camera, stats = {}, weaponMode = "greatsword" }) {
  const monsterHp = finite(monster?.hp, 800);
  return {
    version: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    player: {
      hp: finite(player?.hp, 100),
      stamina: finite(player?.stamina, 100),
      sharpness: finite(player?.sharpness, 90),
      potions: integer(player?.potions, 3),
      position: {
        x: finite(hunterPosition?.x, 0),
        y: finite(hunterPosition?.y, 0),
        z: finite(hunterPosition?.z, 22)
      }
    },
    monster: {
      hp: monsterHp,
      headHp: finite(monster?.headHp, 200),
      tailHp: finite(monster?.tailHp, 180),
      isHeadBroken: Boolean(monster?.isHeadBroken),
      isTailBroken: Boolean(monster?.isTailBroken),
      hasRoared60: typeof monster?.hasRoared60 === "boolean" ? monster.hasRoared60 : monsterHp <= 800 * 0.65,
      hasRoared25: typeof monster?.hasRoared25 === "boolean" ? monster.hasRoared25 : monsterHp <= 800 * 0.28,
      position: {
        x: finite(monsterPosition?.x, 0),
        y: finite(monsterPosition?.y, 0),
        z: finite(monsterPosition?.z, -12)
      }
    },
    camera: {
      yaw: finite(camera?.yaw, 0),
      pitch: finite(camera?.pitch, 0.35)
    },
    stats: normalizeStats(stats),
    equipment: {
      weaponMode: weaponMode === "dualblades" ? "dualblades" : "greatsword"
    }
  };
}

export function normalizeSaveState(value) {
  if (!value || value.version !== SAVE_VERSION) return null;
  const state = createSaveState({
    player: value.player,
    monster: value.monster,
    hunterPosition: value.player?.position,
    monsterPosition: value.monster?.position,
    camera: value.camera,
    stats: value.stats,
    weaponMode: value.equipment?.weaponMode
  });
  state.savedAt = typeof value.savedAt === "string" ? value.savedAt : state.savedAt;
  state.player.hp = Math.min(100, Math.max(0, state.player.hp));
  state.player.stamina = Math.min(100, Math.max(0, state.player.stamina));
  state.player.sharpness = Math.min(100, Math.max(0, state.player.sharpness));
  state.player.potions = Math.min(3, state.player.potions);
  state.monster.hp = Math.min(800, Math.max(0, state.monster.hp));
  state.monster.headHp = Math.min(200, Math.max(0, state.monster.headHp));
  state.monster.tailHp = Math.min(180, Math.max(0, state.monster.tailHp));
  if (typeof value.monster?.hasRoared60 !== "boolean") {
    state.monster.hasRoared60 = state.monster.hp <= 800 * 0.65;
  }
  if (typeof value.monster?.hasRoared25 !== "boolean") {
    state.monster.hasRoared25 = state.monster.hp <= 800 * 0.28;
  }
  state.camera.pitch = Math.min(1.2, Math.max(0.1, state.camera.pitch));
  return state;
}

export function readStats(storage) {
  if (!storage) return normalizeStats();
  try {
    const raw = storage.getItem(STATS_KEY);
    if (raw) {
      return normalizeStats(JSON.parse(raw));
    }
    const fallbackSave = readSave(storage);
    return normalizeStats(fallbackSave?.stats);
  } catch {
    return normalizeStats();
  }
}

export function writeStats(storage, stats) {
  if (!storage) return false;
  try {
    const normalized = normalizeStats(stats);
    storage.setItem(STATS_KEY, JSON.stringify(normalized));
    return true;
  } catch {
    return false;
  }
}

export function readSave(storage) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(SAVE_KEY);
    return raw ? normalizeSaveState(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function writeSave(storage, state) {
  if (!storage) return false;
  try {
    const normalized = normalizeSaveState(state);
    if (!normalized || normalized.player.hp <= 0 || normalized.monster.hp <= 0) return false;
    storage.setItem(SAVE_KEY, JSON.stringify(normalized));
    writeStats(storage, normalized.stats);
    return true;
  } catch {
    return false;
  }
}

export function removeSave(storage) {
  if (!storage) return false;
  try {
    storage.removeItem(SAVE_KEY);
    return true;
  } catch {
    return false;
  }
}
