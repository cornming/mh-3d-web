export const SETTINGS_KEY = "mh3d-web-settings-v1";

export const GRAPHICS_QUALITIES = Object.freeze(["low", "medium", "high"]);

export const DEFAULT_SETTINGS = Object.freeze({
  masterVolume: 0.8,
  cameraSensitivity: 1,
  cameraShake: 1,
  hudScale: 1,
  graphicsQuality: "high",
  showDamageNumbers: true,
  showTargetHealth: true,
  showMinimap: true,
  showControlHints: true
});

const NUMBER_RANGES = Object.freeze({
  masterVolume: [0, 1],
  cameraSensitivity: [0.4, 2],
  cameraShake: [0, 1],
  hudScale: [0.8, 1.2]
});

const BOOLEAN_KEYS = Object.freeze([
  "showDamageNumbers",
  "showTargetHealth",
  "showMinimap",
  "showControlHints"
]);

/** 把任意輸入整理成完整且數值安全的設定物件。 */
export function normalizeSettings(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const settings = { ...DEFAULT_SETTINGS };
  for (const [key, [min, max]] of Object.entries(NUMBER_RANGES)) {
    const raw = source[key];
    if (typeof raw === "number" && Number.isFinite(raw)) {
      settings[key] = Math.min(max, Math.max(min, raw));
    }
  }
  for (const key of BOOLEAN_KEYS) {
    if (typeof source[key] === "boolean") settings[key] = source[key];
  }
  if (GRAPHICS_QUALITIES.includes(source.graphicsQuality)) {
    settings.graphicsQuality = source.graphicsQuality;
  }
  return settings;
}

export function readSettings(storage) {
  if (!storage) return normalizeSettings();
  try {
    const raw = storage.getItem(SETTINGS_KEY);
    return normalizeSettings(raw ? JSON.parse(raw) : {});
  } catch {
    return normalizeSettings();
  }
}

export function writeSettings(storage, settings) {
  if (!storage) return false;
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(settings)));
    return true;
  } catch {
    return false;
  }
}
