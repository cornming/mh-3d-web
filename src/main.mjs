import {
  QUEST_TIME_LIMIT_SECONDS,
  SHARPNESS_LEVELS,
  calculateAttackDamage,
  closestPointOnSegment2DInto,
  evaluateHuntRank,
  formatQuestClock,
  getChargeLevel,
  getSharpnessLevel,
  nextComboStep,
  resolveMonsterHit
} from './game-rules.mjs';
import {
  createSaveState,
  mergeHuntRecord,
  normalizeQuestProgress,
  readRecords,
  readSave,
  readStats,
  removeSave,
  writeRecords,
  writeSave,
  writeStats
} from './save-system.mjs';
import { readSettings, writeSettings } from './settings.mjs';
import { ProceduralAudio } from './audio.mjs';
import { ParticleManager } from './effects.mjs';
import {
  ARENA,
  BOSS_STATUS,
  DODGE_COST,
  FOCUS_DURATION,
  GAME,
  MONSTER_BODY,
  POTION_HEAL,
  WEAPON_PROFILES,
  clampToArena,
  lerpAngle,
  resolveStaticCollisions
} from './constants.mjs';
import { createWorldScene } from './scene.mjs';
import {
  createBladeTrail,
  createProceduralHunter,
  createProceduralMonster,
  loadVisualAssets
} from './assets.mjs';
import { createHud } from './ui/hud.mjs';
import { createMenus } from './ui/menus.mjs';
import { createTouchControls } from './ui/touch.mjs';

const runtimeError = document.getElementById('runtime-error');
const runtimeErrorMessage = document.getElementById('runtime-error-message');
const runtimeErrorClose = document.getElementById('runtime-error-close');
const showRuntimeError = (message) => {
  if (runtimeErrorMessage) runtimeErrorMessage.textContent = message;
  else runtimeError.textContent = message;
  runtimeError.hidden = false;
};
const hideRuntimeError = () => {
  runtimeError.hidden = true;
};
runtimeErrorClose?.addEventListener('click', hideRuntimeError);

window.addEventListener('error', (event) => {
  const message = event && event.error && event.error.message
    ? event.error.message
    : (event && event.message ? event.message : '未知執行錯誤');
  showRuntimeError(`遊戲執行發生錯誤：${message}`);
});
window.addEventListener('unhandledrejection', (event) => {
  const reason = event && event.reason && event.reason.message
    ? event.reason.message
    : String(event && event.reason ? event.reason : '未知非同步錯誤');
  showRuntimeError(`遊戲載入失敗：${reason}`);
});

if (!window.THREE) {
  showRuntimeError('無法載入 3D 引擎，請確認網路連線後重新整理頁面。');
  throw new Error('Three.js failed to load');
}

const THREE = window.THREE;

/* ==============================================================
   0. 設定、音效、HUD 與選單初始化
   ============================================================== */
const saveStorage = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();
const settings = readSettings(saveStorage);

const hud = createHud({ arena: ARENA });
hud.applySettings(settings);

const audio = new ProceduralAudio({
  onStatus: (message) => hud.toast(message, { icon: 'warning', tone: 'calm', duration: 5200 })
});
audio.setMasterVolume(settings.masterVolume);

let needsStaticRender = true;

const menus = createMenus({
  audio,
  settings,
  onCommand: handleMenuCommand,
  onSettingsChange: applySettings
});

/* ==============================================================
   1. 3D 世界場景與 WebGL Lifecycle
   ============================================================== */
const container = document.getElementById('canvas-container');
let world;
try {
  world = createWorldScene({
    THREE,
    container,
    settings,
    onContextLost: () => {
      if (phase === 'hunting') pauseHunt();
      else resetInputState();
      showRuntimeError('3D 繪圖裝置暫時中斷，等待瀏覽器恢復顯示…');
    },
    onContextRestored: () => {
      hideRuntimeError();
      world.applyGraphicsQuality();
      needsStaticRender = true;
    }
  });
} catch (error) {
  showRuntimeError('目前瀏覽器或裝置不支援 WebGL，無法啟動 3D 遊戲。');
  throw error;
}

const { scene, camera, renderer, skyDome, motes } = world;
const particleSystem = new ParticleManager(scene);

/* ==============================================================
   2. 獵人與魔物視覺節點（先掛載簡易備援，待 GLB 載入後平滑替換並釋放）
   ============================================================== */
const hunterGroup = new THREE.Group();
hunterGroup.position.set(0, 0, 22);
scene.add(hunterGroup);

const monsterGroup = new THREE.Group();
monsterGroup.position.set(0, 0, -12);
scene.add(monsterGroup);

const monsterMaterials = new Set();

let proceduralHunter = createProceduralHunter(THREE, hunterGroup);
let hunterBody = proceduralHunter.body;
let weaponPivot = proceduralHunter.weaponPivot;
let blade = proceduralHunter.blade;
let alternateWeaponPivot = proceduralHunter.dualWeaponPivot;
let hasLoadedHunterModel = false;

let proceduralMonster = createProceduralMonster(THREE, monsterGroup, monsterMaterials);
let headGroup = proceduralMonster.headGroup;
let tailGroup = proceduralMonster.tailGroup;
let hornLeft = proceduralMonster.hornLeft;
let hornRight = proceduralMonster.hornRight;
const { eyeLightL, eyeLightR } = proceduralMonster;

const primaryBladeTrail = createBladeTrail(THREE, scene);
const secondaryBladeTrail = createBladeTrail(THREE, scene);

let hunterVisual = null;
let monsterVisual = null;
let hunterMixer = null;
let monsterMixer = null;
let weaponMode = 'greatsword';

const hunterRig = {
  chest: null,
  head: null,
  weapon: proceduralHunter.weaponPivot,
  blade: proceduralHunter.blade,
  dualBlades: proceduralHunter.dualBlades,
  dualHands: proceduralHunter.dualHands,
  activeBlades: [proceduralHunter.blade],
  legs: [],
  shoulders: []
};
const monsterRig = {
  body: null,
  bodyBaseY: 0,
  tailEndPieces: [],
  head: headGroup,
  wings: [],
  tail: tailGroup,
  eyes: []
};

const auraRings = [0, 1, 2].map((index) => {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(3.0 + index * 0.85, 0.045 + index * 0.012, 8, 64),
    new THREE.MeshBasicMaterial({
      color: index === 1 ? 0xd66bff : 0x7c4dff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.75 + index * 1.7;
  ring.rotation.z = index * 0.65;
  monsterGroup.add(ring);
  return ring;
});

const WARNING_RING_OUTER_RADIUS = 4.05;
const monsterWarningRing = new THREE.Mesh(
  new THREE.RingGeometry(3.7, WARNING_RING_OUTER_RADIUS, 64),
  new THREE.MeshBasicMaterial({
    color: 0xff5b5b,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  })
);
monsterWarningRing.rotation.x = -Math.PI / 2;
monsterWarningRing.position.y = 0.08;
monsterGroup.add(monsterWarningRing);

let lastWeaponEmissive = -1;
function setWeaponEmissive(hexColor) {
  if (hexColor === lastWeaponEmissive) return;
  lastWeaponEmissive = hexColor;
  const blades = hunterRig.activeBlades.length > 0 ? hunterRig.activeBlades : [blade];
  blades.forEach((mesh) => {
    if (mesh && mesh.material && mesh.material.emissive) {
      mesh.material.emissive.setHex(hexColor);
    }
  });
}

let lastBodyEmissive = -1;
function setHunterBodyEmissive(hexColor) {
  if (hexColor === lastBodyEmissive) return;
  lastBodyEmissive = hexColor;
  if (hunterBody && hunterBody.material && hunterBody.material.emissive) {
    hunterBody.material.emissive.setHex(hexColor);
  }
}

let lastMonsterEmissive = -1;
function setMonsterEmissive(color) {
  if (color === lastMonsterEmissive) return;
  lastMonsterEmissive = color;
  monsterMaterials.forEach((material) => {
    if (!material || !material.emissive) return;
    const baseEmissive = material.userData?.baseEmissive;
    const baseIntensity = material.userData?.baseEmissiveIntensity ?? 1;
    const hasInherentGlow = baseEmissive && (baseEmissive.r + baseEmissive.g + baseEmissive.b > 0.05);
    if (color === 0x000000) {
      if (baseEmissive) material.emissive.copy(baseEmissive);
      else material.emissive.setHex(0x000000);
      material.emissiveIntensity = baseIntensity;
    } else if (color === 0x3a002d && hasInherentGlow) {
      material.emissive.copy(baseEmissive);
      material.emissiveIntensity = baseIntensity * 1.4;
    } else {
      material.emissive.setHex(color);
      material.emissiveIntensity = 1;
    }
  });
}

function applyWeaponMode() {
  const usingDualBlades = weaponMode === 'dualblades' && alternateWeaponPivot;
  if (hunterRig.weapon) hunterRig.weapon.visible = !usingDualBlades;
  if (alternateWeaponPivot) alternateWeaponPivot.visible = Boolean(usingDualBlades);
  weaponPivot = usingDualBlades
    ? alternateWeaponPivot
    : (hunterRig.weapon || weaponPivot);
  blade = usingDualBlades
    ? (hunterRig.dualBlades[0] || blade)
    : (hunterRig.blade || blade);
  hunterRig.activeBlades = usingDualBlades && hunterRig.dualBlades.length > 0
    ? hunterRig.dualBlades
    : [hunterRig.blade || blade].filter(Boolean);
  lastWeaponEmissive = -1;
  setWeaponEmissive(0x000000);
}

/** 直接換上指定武器（出發前的裝備選擇、讀取存檔），不受狩獵狀態限制。 */
function equipWeapon(mode) {
  weaponMode = WEAPON_PROFILES[mode] ? mode : 'greatsword';
  applyWeaponMode();
  menus.setWeaponChoice(weaponMode);
}

/** 狩獵中切換武器：只有在待機狀態才能換。 */
function setWeaponMode(mode) {
  if (!WEAPON_PROFILES[mode] || phase !== 'hunting' || weaponMode === mode) return;
  if (player.state !== 'idle') {
    audio.playUiDeny();
    return;
  }
  equipWeapon(mode);
  audio.playUiConfirm();
  hud.weaponSwapped();
  hud.toast(`換上${WEAPON_PROFILES[mode].label}`, { icon: 'weapon' });
}

const assetLoader = THREE.GLTFLoader ? new THREE.GLTFLoader() : null;
loadVisualAssets({
  THREE,
  assetLoader,
  world,
  hunterGroup,
  monsterGroup,
  monsterMaterials,
  onProgress: (fraction, status) => menus.setLoading(fraction, status),
  onHunterLoaded: (loaded) => {
    proceduralHunter?.dispose();
    proceduralHunter = null;
    hasLoadedHunterModel = true;
    hunterVisual = loaded.model;
    hunterMixer = loaded.mixer;
    hunterBody = loaded.chest || hunterBody;
    blade = loaded.blade || blade;
    weaponPivot = loaded.weaponPivot || weaponPivot;
    alternateWeaponPivot = loaded.alternateWeaponPivot;
    hunterRig.chest = loaded.chest;
    hunterRig.head = loaded.head;
    hunterRig.weapon = loaded.weaponPivot;
    hunterRig.blade = loaded.blade;
    hunterRig.dualBlades = loaded.dualBlades;
    hunterRig.dualHands = loaded.dualHands;
    hunterRig.legs = loaded.legs;
    hunterRig.shoulders = loaded.shoulders;
    lastBodyEmissive = -1;
    applyWeaponMode();
    needsStaticRender = true;
  },
  onMonsterLoaded: (loaded) => {
    proceduralMonster?.dispose(loaded.head);
    proceduralMonster = null;
    monsterVisual = loaded.model;
    monsterMixer = loaded.mixer;
    headGroup = loaded.head || headGroup;
    tailGroup = loaded.tail || tailGroup;
    hornLeft = loaded.hornL || hornLeft;
    hornRight = loaded.hornR || hornRight;
    monsterRig.body = loaded.body;
    monsterRig.bodyBaseY = loaded.body ? loaded.body.position.y : 0;
    monsterRig.head = headGroup;
    monsterRig.tail = tailGroup;
    monsterRig.wings = loaded.wings;
    monsterRig.eyes = loaded.eyes;
    monsterRig.tailEndPieces = loaded.tailEndPieces;
    lastMonsterEmissive = -1;
    syncMonsterPartBreakVisuals();
    needsStaticRender = true;
  },
  onEnvironmentLoaded: () => {
    needsStaticRender = true;
  },
  onAssetError: (message, error) => {
    showRuntimeError(message);
    console.warn(message, error);
  },
  onAllReady: onAssetsReady
});

/* ==============================================================
   3. 視覺動畫與刀光更新
   ============================================================== */
let simElapsed = 0;
let hunterStepPhase = 0;
const moveInputForVisual = { x: 0, z: 0 };
const HUNTER_ROLL_PIVOT = 0.95;

const animateHunterVisual = (dt, moving, rollAngle = 0) => {
  if (!hunterVisual) return;
  const speed = moving ? 10.5 : 2.4;
  const stride = moving ? Math.sin(simElapsed * speed) : 0;
  const breathe = Math.sin(simElapsed * 2.4) * 0.012;
  if (moving) {
    const previousStep = Math.floor(hunterStepPhase / Math.PI);
    hunterStepPhase += dt * speed;
    if (Math.floor(hunterStepPhase / Math.PI) !== previousStep) audio.playFootstep();
  } else {
    hunterStepPhase = 0;
  }

  if (rollAngle !== 0) {
    // 翻滾：以腰部高度為軸心前滾，而不是繞著腳底轉
    hunterVisual.rotation.x = rollAngle;
    hunterVisual.rotation.z = 0;
    hunterVisual.position.y = HUNTER_ROLL_PIVOT * (1 - Math.cos(rollAngle)) * 0.62;
    hunterVisual.position.z = -HUNTER_ROLL_PIVOT * Math.sin(rollAngle);
  } else {
    hunterVisual.rotation.x = 0;
    hunterVisual.position.z = 0;
    hunterVisual.position.y = moving ? Math.abs(stride) * 0.035 : breathe;
    const yaw = hunterGroup.rotation.y;
    const localLateral = moveInputForVisual.x * Math.cos(yaw) - moveInputForVisual.z * Math.sin(yaw);
    hunterVisual.rotation.z = player.state === 'charging' ? -0.055 : (moving ? -localLateral * 0.045 : 0);
  }

  if (hunterRig.chest) {
    hunterRig.chest.scale.y = 1 + breathe * 0.8;
  }
  hunterRig.legs.forEach((leg, index) => {
    leg.rotation.x = moving ? stride * (index === 0 ? 0.22 : -0.22) : 0;
    leg.rotation.z = moving ? stride * (index === 0 ? 0.035 : -0.035) : 0;
  });
  hunterRig.shoulders.forEach((shoulder, index) => {
    shoulder.rotation.z = moving ? stride * (index === 0 ? 0.06 : -0.06) : 0;
  });
};

const TRAIL_SAMPLES = primaryBladeTrail.bases.length;
const trailTint = new THREE.Color();
const updateSingleTrail = (trail, targetBlade, baseY, tipY, isSwinging, colorHex, intensity, dt) => {
  if (isSwinging && targetBlade && targetBlade.parent) {
    const base = trail.bases[TRAIL_SAMPLES - 1];
    const tip = trail.tips[TRAIL_SAMPLES - 1];
    for (let index = TRAIL_SAMPLES - 1; index > 0; index--) {
      trail.bases[index] = trail.bases[index - 1];
      trail.tips[index] = trail.tips[index - 1];
    }
    trail.bases[0] = targetBlade.localToWorld(base.set(0, baseY, 0));
    trail.tips[0] = targetBlade.localToWorld(tip.set(0, tipY, 0));
    if (!trail.recording) {
      for (let index = 1; index < TRAIL_SAMPLES; index++) {
        trail.bases[index].copy(trail.bases[0]);
        trail.tips[index].copy(trail.tips[0]);
      }
      trail.recording = true;
    }
    trail.strength = 1;
  } else {
    trail.recording = false;
    trail.strength = Math.max(0, trail.strength - dt * 6);
  }

  if (trail.strength <= 0) {
    trail.mesh.visible = false;
    return;
  }

  trailTint.setHex(colorHex);
  for (let index = 0; index < TRAIL_SAMPLES; index++) {
    const fade = Math.pow(1 - index / (TRAIL_SAMPLES - 1), 1.7) * trail.strength * intensity;
    const offset = index * 6;
    const base = trail.bases[index];
    const tip = trail.tips[index];
    trail.positions[offset] = base.x;
    trail.positions[offset + 1] = base.y;
    trail.positions[offset + 2] = base.z;
    trail.positions[offset + 3] = tip.x;
    trail.positions[offset + 4] = tip.y;
    trail.positions[offset + 5] = tip.z;
    trail.colors[offset] = trailTint.r * fade * 0.18;
    trail.colors[offset + 1] = trailTint.g * fade * 0.18;
    trail.colors[offset + 2] = trailTint.b * fade * 0.18;
    trail.colors[offset + 3] = trailTint.r * fade;
    trail.colors[offset + 4] = trailTint.g * fade;
    trail.colors[offset + 5] = trailTint.b * fade;
  }
  trail.geometry.attributes.position.needsUpdate = true;
  trail.geometry.attributes.color.needsUpdate = true;
  trail.mesh.visible = true;
};

const updateBladeTrail = (dt) => {
  const isHeavy = player.state === 'attack_heavy';
  const isSwinging = player.state === 'attack_light' || isHeavy;
  const colorHex = isHeavy ? 0xffc46a : 0xbfeaff;
  const intensity = isHeavy ? 0.95 : 0.6;
  const usingDual = weaponMode === 'dualblades' && hunterRig.dualBlades.length >= 2;
  // 刀身在 GLB 模型局部座標沿 +Y 延伸；簡易備援網格則以幾何中心為原點。
  const [baseY, tipY] = hasLoadedHunterModel
    ? (usingDual ? [0.5, 2.1] : [1.0, 3.55])
    : (usingDual ? [-0.8, 0.8] : [-1.5, 1.9]);

  updateSingleTrail(primaryBladeTrail, blade, baseY, tipY, isSwinging, colorHex, intensity, dt);
  updateSingleTrail(
    secondaryBladeTrail,
    usingDual ? hunterRig.dualBlades[1] : null,
    baseY,
    tipY,
    isSwinging && usingDual,
    colorHex,
    intensity,
    dt
  );
};

const animateMonsterVisual = () => {
  if (!monsterVisual) return;
  const alive = monster.state !== 'dead';
  const enraged = monster.isEnraged && alive;
  const pulse = alive ? 1 + Math.sin(simElapsed * (enraged ? 11 : 2.2)) * (enraged ? 0.035 : 0.012) : 1;
  const breathing = alive ? Math.sin(simElapsed * 2.1) * 0.04 : 0;
  const isMoving = monster.state === 'chase' || monster.state === 'charge';
  const gait = isMoving ? Math.sin(simElapsed * (enraged ? 9.5 : 7.0)) : 0;
  const hitReaction = monster.hitFlashTimer > 0
    ? Math.sin(simElapsed * 46) * Math.min(1, monster.hitFlashTimer * 8)
    : 0;

  if (monsterRig.body) {
    monsterRig.body.scale.set(1 + Math.abs(hitReaction) * 0.025, pulse + Math.abs(hitReaction) * 0.045, 1);
    monsterRig.body.position.y = monsterRig.bodyBaseY + breathing - Math.abs(hitReaction) * 0.06;
    monsterRig.body.rotation.z = hitReaction * 0.035;
  }
  if (monsterRig.head) {
    monsterRig.head.rotation.x = monster.state === 'roar'
      ? -0.34 - Math.sin(simElapsed * 14) * 0.05
      : (alive ? Math.sin(simElapsed * 2.2) * 0.018 - hitReaction * 0.035 : 0.3);
  }
  monsterRig.wings.forEach((wing, index) => {
    const phaseOffset = index === 0 ? 0 : Math.PI;
    const flap = isMoving ? Math.sin(simElapsed * (enraged ? 8.5 : 6.2) + phaseOffset) : Math.sin(simElapsed * 2.1 + phaseOffset) * 0.3;
    wing.rotation.z = alive ? flap * (enraged ? 0.16 : 0.08) : 0;
    wing.rotation.x = monster.state === 'roar' ? -0.18 : 0;
  });
  if (monsterRig.tail) {
    monsterRig.tail.rotation.y = monster.state === 'spin' || !alive
      ? 0
      : Math.sin(simElapsed * (enraged ? 5.2 : 3.0)) * 0.08;
    monsterRig.tail.rotation.x = gait * 0.035;
  }
  monsterRig.eyes.forEach((eye) => {
    eye.scale.setScalar(enraged ? 1.16 + Math.sin(simElapsed * 12) * 0.06 : 1);
  });
};

const updateEnrageAura = (dt) => {
  const targetOpacity = monster.isEnraged && monster.state !== 'dead' ? 0.42 : 0;
  auraRings.forEach((ring, index) => {
    ring.material.opacity = THREE.MathUtils.lerp(ring.material.opacity, targetOpacity * (1 - index * 0.18), 5 * dt);
    if (ring.material.opacity < 0.002) {
      ring.visible = false;
      return;
    }
    ring.visible = true;
    ring.rotation.y += dt * (index % 2 === 0 ? 0.9 : -1.2);
    ring.rotation.z += dt * (index % 2 === 0 ? -0.7 : 0.6);
    ring.scale.setScalar(1 + Math.sin(simElapsed * 5 + index) * 0.035);
  });
};

const updateMonsterTelegraph = (dt) => {
  const isCharge = phase === 'hunting' && monster.state === 'telegraph_charge';
  const isSpin = phase === 'hunting' && monster.state === 'telegraph_spin';
  const isRoar = phase === 'hunting' && monster.state === 'roar';
  const isTelegraphing = isCharge || isSpin || isRoar;
  const targetOpacity = isTelegraphing ? (monster.isEnraged ? 0.62 : 0.44) : 0;
  monsterWarningRing.material.opacity = THREE.MathUtils.lerp(
    monsterWarningRing.material.opacity,
    targetOpacity,
    10 * dt
  );

  if (!isTelegraphing) {
    monsterWarningRing.visible = monsterWarningRing.material.opacity > 0.004;
    return;
  }
  monsterWarningRing.visible = true;

  const color = isCharge ? 0xff4d4d : (isSpin ? 0xffa726 : 0xb26cff);
  monsterWarningRing.material.color.setHex(color);
  const pulse = 0.97 + Math.sin(simElapsed * (isRoar ? 12 : 18)) * 0.03;
  // 甩尾預警圈對齊實際判定半徑（斷尾 5.8m / 完整 8.2m），避免視覺誤導
  const spinHitRadius = monster.isTailBroken ? 5.8 : 8.2;
  const baseScale = isSpin ? (spinHitRadius / WARNING_RING_OUTER_RADIUS) : (isCharge ? 1.05 : 0.85);
  monsterWarningRing.scale.setScalar(baseScale * pulse);
};

/* ==============================================================
   4. 狀態系統與數值 (Player & Boss Data)
   ============================================================== */
// 遊戲流程階段：loading → title → intro → hunting ⇄ paused → finishing → result
let phase = 'loading';
let hitstopTimer = 0; // 卡肉頓幀計時器
let screenShakeTimer = 0; // 鏡頭微震
let screenShakeIntensity = 0;
let isLockOn = false;
let timeScale = 1;
let introTimer = 0;
let finishTimer = 0;
let finishOutcome = null;
let hintsCollapseTimer = 0;
let slowMotionTimer = 0;
let questClearTimer = 0;

const player = {
  hp: 100,
  maxHp: 100,
  stamina: 100,
  maxStamina: 100,
  sharpness: 90, // 0~100
  potions: 3,
  maxPotions: 3,
  speed: 11.5,
  // idle, dodge, charging, attack_light, attack_heavy, ear_cover, potion, sharpen, flinch, down
  state: 'idle',
  comboStep: 0,  // 0: 縱斬, 1: 橫掃, 2: 上撈
  timer: 0,
  actionDuration: 0,
  invincible: 0,
  chargeTime: 0,
  isCharging: false,
  chargeLevel: 1,
  comboTimer: 0,
  hasHitThisSwing: false,
  pendingHeal: 0,
  sharpenStrokes: 0,
  sharpenFlashTimer: 0,
  focusTimer: 0,
  knockback: new THREE.Vector3()
};

const monster = {
  hp: 800,
  maxHp: 800,
  // chase, telegraph_charge, charge, telegraph_spin, spin, roar, cooldown, stagger, dead
  state: 'chase',
  timer: 1.5,
  isEnraged: false,
  enrageTimer: 0,
  chargeDir: new THREE.Vector3(),
  hasDealtDamage: false,
  staggerBuildUp: 0,
  hitFlashTimer: 0,
  // 部位破壞狀態
  headHp: 200,
  isHeadBroken: false,
  tailHp: 180,
  isTailBroken: false,
  hasRoared25: false,
  hasRoared60: false
};

// 單場狩獵的計時與結算統計
const hunt = normalizeQuestProgress();
const gameStats = readStats(saveStorage);
let records = readRecords(saveStorage);

function setPhase(next) {
  phase = next;
  document.body.dataset.phase = next;
  audio.setPaused(next === 'paused' || next === 'loading' || next === 'result');
  if (next === 'paused' || next === 'result' || next === 'loading') {
    needsStaticRender = true;
  }
}

const remainingQuestSeconds = () => Math.max(0, QUEST_TIME_LIMIT_SECONDS - hunt.elapsed);

/* ---------- 部位破壞的外觀 ---------- */
let severedTail = null;

function removeSeveredTail() {
  if (!severedTail) return;
  scene.remove(severedTail.group);
  severedTail.group.traverse((child) => {
    if (child.isMesh) child.material?.dispose?.();
  });
  severedTail = null;
}

function syncMonsterPartBreakVisuals() {
  if (hornLeft) hornLeft.visible = !monster.isHeadBroken;
  if (hornRight) hornRight.visible = !monster.isHeadBroken;
  if (monsterRig.tailEndPieces.length > 0) {
    monsterRig.tailEndPieces.forEach((piece) => {
      piece.visible = !monster.isTailBroken;
    });
  } else if (tailGroup) {
    const tailScale = monster.isTailBroken ? 0.45 : 1;
    tailGroup.scale.set(tailScale, tailScale, tailScale);
  }
  if (!monster.isTailBroken) removeSeveredTail();
}

/** 斷尾瞬間：把被切離的尾段複製成獨立物件，拋飛後落在地面。 */
function spawnSeveredTail() {
  if (monsterRig.tailEndPieces.length === 0) return;
  removeSeveredTail();
  monsterGroup.updateWorldMatrix(true, true);
  const anchor = monsterRig.tailEndPieces[0].getWorldPosition(new THREE.Vector3());
  const group = new THREE.Group();
  group.position.copy(anchor);
  monsterRig.tailEndPieces.forEach((piece) => {
    const clone = piece.clone();
    clone.material = piece.material.clone();
    if (clone.material.emissive && clone.material.userData?.baseEmissive) {
      clone.material.emissive.copy(clone.material.userData.baseEmissive);
      clone.material.emissiveIntensity = clone.material.userData.baseEmissiveIntensity ?? 1;
    }
    clone.visible = true;
    piece.matrixWorld.decompose(clone.position, clone.quaternion, clone.scale);
    clone.position.sub(anchor);
    group.add(clone);
  });
  scene.add(group);
  const yaw = monsterGroup.rotation.y;
  severedTail = {
    group,
    velocity: new THREE.Vector3(-Math.sin(yaw) * 5.5, 7.5, -Math.cos(yaw) * 5.5),
    landed: false
  };
}

function updateSeveredTail(dt) {
  if (!severedTail || severedTail.landed) return;
  const { group, velocity } = severedTail;
  velocity.y -= 24 * dt;
  group.position.addScaledVector(velocity, dt);
  group.rotation.x += 3.2 * dt;
  if (group.position.y <= 0.55 && velocity.y < 0) {
    group.position.y = 0.55;
    group.rotation.x = 0;
    group.rotation.z = 0.1;
    clampToArena(group.position, ARENA.radius + 2);
    severedTail.landed = true;
    particleSystem.spawnHitSparks(group.position, 10, false);
    audio.playFootstep(true);
  }
}

/* ---------- 狩獵狀態的重設、存檔與讀取 ---------- */
function resetHuntState() {
  clearTimeout(questClearTimer);
  questClearTimer = 0;
  resetInputState();
  Object.assign(player, {
    hp: player.maxHp,
    stamina: player.maxStamina,
    sharpness: 90,
    potions: player.maxPotions,
    state: 'idle',
    comboStep: 0,
    timer: 0,
    actionDuration: 0,
    invincible: 0,
    chargeTime: 0,
    isCharging: false,
    chargeLevel: 1,
    comboTimer: 0,
    hasHitThisSwing: false,
    pendingHeal: 0,
    sharpenStrokes: 0,
    sharpenFlashTimer: 0,
    focusTimer: 0
  });
  player.knockback.set(0, 0, 0);

  Object.assign(monster, {
    hp: monster.maxHp,
    state: 'chase',
    timer: 1.5,
    isEnraged: false,
    enrageTimer: 0,
    hasDealtDamage: false,
    staggerBuildUp: 0,
    hitFlashTimer: 0,
    headHp: 200,
    isHeadBroken: false,
    tailHp: 180,
    isTailBroken: false,
    hasRoared25: false,
    hasRoared60: false
  });
  Object.assign(hunt, normalizeQuestProgress());

  eyeLightL.intensity = 0;
  eyeLightR.intensity = 0;
  monsterGroup.position.set(0, 0, -12);
  monsterGroup.rotation.set(0, 0, 0);
  hunterGroup.position.set(0, 0, 22);
  hunterGroup.rotation.set(0, Math.PI, 0);
  lastMonsterEmissive = -1;
  lastWeaponEmissive = -1;
  lastBodyEmissive = -1;
  setMonsterEmissive(0x000000);
  setWeaponEmissive(0x000000);
  setHunterBodyEmissive(0x000000);
  syncMonsterPartBreakVisuals();

  hitstopTimer = 0;
  screenShakeTimer = 0;
  slowMotionTimer = 0;
  timeScale = 1;
  finishOutcome = null;
  setLockOn(false);
  cameraYaw = 0;
  cameraPitch = 0.35;
  cameraDistance = 18;
  hud.clearTransient();
}

function applySaveState(save) {
  if (!save || save.player.hp <= 0 || save.monster.hp <= 0) return false;
  resetHuntState();
  player.hp = save.player.hp;
  player.stamina = save.player.stamina;
  player.sharpness = save.player.sharpness;
  player.potions = save.player.potions;
  monster.hp = save.monster.hp;
  monster.headHp = save.monster.headHp;
  monster.tailHp = save.monster.tailHp;
  monster.isHeadBroken = save.monster.isHeadBroken;
  monster.isTailBroken = save.monster.isTailBroken;
  monster.hasRoared60 = Boolean(save.monster.hasRoared60);
  monster.hasRoared25 = Boolean(save.monster.hasRoared25);
  Object.assign(hunt, normalizeQuestProgress(save.quest));
  hunt.elapsed = Math.min(hunt.elapsed, QUEST_TIME_LIMIT_SECONDS - 30);
  hunterGroup.position.set(save.player.position.x, 0, save.player.position.z);
  monsterGroup.position.set(save.monster.position.x, 0, save.monster.position.z);
  // 舊版存檔的位置可能落在現在的獵場邊界之外
  clampToArena(hunterGroup.position, ARENA.radius);
  clampToArena(monsterGroup.position, ARENA.monsterRadius);
  cameraYaw = save.camera.yaw;
  cameraPitch = save.camera.pitch;
  equipWeapon(save.equipment?.weaponMode);
  syncMonsterPartBreakVisuals();
  return true;
}

function buildSaveState() {
  return createSaveState({
    player,
    monster,
    hunterPosition: hunterGroup.position,
    monsterPosition: monsterGroup.position,
    camera: { yaw: cameraYaw, pitch: cameraPitch },
    stats: gameStats,
    weaponMode,
    quest: hunt
  });
}

function describeSave(save) {
  const monsterPercent = Math.max(1, Math.round((save.monster.hp / monster.maxHp) * 100));
  const remaining = formatQuestClock(QUEST_TIME_LIMIT_SECONDS - save.quest.elapsed);
  return `獵人 ${Math.ceil(save.player.hp)}｜目標 ${monsterPercent}%｜剩餘 ${remaining}`;
}

function refreshMenuState() {
  const save = readSave(saveStorage);
  menus.setTitleState({
    hasSave: Boolean(save),
    saveSummary: save ? describeSave(save) : '',
    stats: gameStats,
    records
  });
  menus.setPauseState({
    remainingSeconds: remainingQuestSeconds(),
    weaponMode,
    hasSave: Boolean(save)
  });
  if (!save) menus.setSaveStatus('尚無存檔');
}

function saveProgress() {
  if (phase !== 'paused' || player.hp <= 0 || monster.hp <= 0) {
    menus.setSaveStatus('目前無法儲存');
    return;
  }
  const saved = writeSave(saveStorage, buildSaveState());
  refreshMenuState();
  menus.setSaveStatus(saved
    ? `已儲存（${new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}）`
    : '瀏覽器拒絕存檔');
}

function loadProgress() {
  if (!applySaveState(readSave(saveStorage))) {
    menus.setSaveStatus('沒有可讀取的有效存檔');
    return;
  }
  menus.showOnly(null);
  setPhase('hunting');
  hud.toast('已讀取狩獵進度', { icon: 'info' });
}

function clearProgress() {
  const removed = removeSave(saveStorage);
  refreshMenuState();
  menus.setSaveStatus(removed ? '存檔已清除' : '無法清除存檔');
}

/* ---------- 畫面流程 ---------- */
function onAssetsReady() {
  resetHuntState();
  refreshMenuState();
  setPhase('title');
  menus.showOnly('title');
}

function beginIntro(eyebrow) {
  menus.showOnly(null);
  setPhase('intro');
  introTimer = 2.4;
  hintsCollapseTimer = 14;
  hud.setHintsCollapsed(false);
  hud.callout({
    eyebrow,
    title: GAME.questName,
    sub: `討伐　${GAME.monsterName}`,
    duration: 2500
  });
  audio.playQuestStart();
}

function startHunt(weapon) {
  resetHuntState();
  equipWeapon(weapon);
  beginIntro('QUEST START');
}

function continueHunt() {
  if (!applySaveState(readSave(saveStorage))) {
    refreshMenuState();
    return;
  }
  beginIntro('QUEST RESUMED');
}

function pauseHunt() {
  if (phase !== 'hunting') return;
  resetInputState();
  setPhase('paused');
  refreshMenuState();
  menus.showOnly('pause');
  audio.playUiConfirm();
}

function resumeHunt() {
  if (phase !== 'paused') return;
  menus.showOnly(null);
  setPhase('hunting');
}

function returnToTitle() {
  resetHuntState();
  equipWeapon(weaponMode);
  refreshMenuState();
  setPhase('title');
  menus.showOnly('title');
}

function finishHunt(victory, reason) {
  if (phase !== 'hunting') return;
  setPhase('finishing');
  finishOutcome = { victory, reason };
  finishTimer = victory ? 3.6 : 2.8;
  timeScale = victory ? 0.2 : 0.55;
  resetInputState();
  setLockOn(false);
  gameStats.hunts += 1;
  if (victory) gameStats.victories += 1;
  else gameStats.defeats += 1;
  writeStats(saveStorage, gameStats);

  clearTimeout(questClearTimer);
  questClearTimer = 0;

  if (victory) {
    monster.state = 'dead';
    monster.timer = 0;
    monster.isEnraged = false;
    eyeLightL.intensity = 0;
    eyeLightR.intensity = 0;
    audio.playRoar();
    questClearTimer = setTimeout(() => {
      questClearTimer = 0;
      audio.playQuestClear();
    }, 900);
    hud.callout({ eyebrow: 'TARGET SLAIN', title: '討伐完成', sub: GAME.monsterName, duration: 3300 });
  } else {
    audio.playQuestFailed();
    hud.callout({
      eyebrow: 'QUEST FAILED',
      title: reason === 'timeout' ? '時間結束' : '力盡倒下',
      tone: 'danger',
      duration: 2600
    });
  }
}

function presentResult() {
  const { victory, reason } = finishOutcome;
  const rank = evaluateHuntRank({ victory, elapsedSeconds: hunt.elapsed, damageTaken: hunt.damageTaken });
  let isNewBestTime = false;
  if (victory) {
    const merged = mergeHuntRecord(records, { elapsedSeconds: hunt.elapsed, rank });
    records = merged.records;
    isNewBestTime = merged.isNewBestTime;
    writeRecords(saveStorage, records);
  }
  const partsBroken = Number(monster.isHeadBroken) + Number(monster.isTailBroken);
  const rows = [
    { label: victory ? '討伐時間' : '經過時間', value: formatQuestClock(hunt.elapsed) },
    { label: '造成傷害', value: String(hunt.damageDealt) },
    { label: '命中次數', value: String(hunt.hits), unit: '次' },
    { label: '弱點命中', value: String(hunt.weakpointHits), unit: '次' },
    { label: '最大單擊', value: String(hunt.maxHit) },
    { label: '部位破壞', value: `${partsBroken} / 2`, tone: partsBroken === 2 ? 'good' : '' },
    { label: '承受傷害', value: String(hunt.damageTaken), tone: hunt.damageTaken === 0 ? 'good' : (hunt.damageTaken >= 80 ? 'bad' : '') },
    { label: '回復藥使用', value: String(hunt.potionsUsed), unit: '瓶' }
  ];
  const recordItems = [
    ['累計 ', { tag: 'b', text: String(gameStats.victories) }, ' 勝 ', { tag: 'b', text: String(gameStats.defeats) }, ' 敗']
  ];
  if (records.bestTimeSeconds !== null) {
    recordItems.push(['最快討伐 ', { tag: 'b', text: formatQuestClock(records.bestTimeSeconds) }]);
  }
  const reasonText = victory
    ? `成功討伐${GAME.monsterName}`
    : (reason === 'timeout' ? '未能在時限內完成討伐' : '獵人體力耗盡，被迫撤退');
  setPhase('result');
  menus.showResult({
    victory,
    reason: reasonText,
    rank,
    rows,
    recordItems,
    isNewBestTime
  });
}

function handleMenuCommand(command, detail) {
  switch (command) {
    case 'depart':
      startHunt(detail.weapon);
      break;
    case 'continue':
      continueHunt();
      break;
    case 'resume':
      resumeHunt();
      break;
    case 'save':
      saveProgress();
      break;
    case 'load':
      menus.confirm({
        title: '讀取進度',
        text: '讀取存檔會捨棄目前這場狩獵的進度，確定要讀取嗎？',
        confirmLabel: '讀取'
      }).then((accepted) => {
        if (accepted) loadProgress();
      });
      break;
    case 'abandon':
      menus.confirm({
        title: '放棄任務',
        text: '確定要放棄任務並返回標題嗎？未儲存的進度將會遺失。',
        confirmLabel: '放棄任務'
      }).then((accepted) => {
        if (accepted) returnToTitle();
      });
      break;
    case 'retry':
      startHunt(weaponMode);
      break;
    case 'to-title':
      returnToTitle();
      break;
    case 'clear-save':
      menus.confirm({
        title: '清除存檔',
        text: '確定要刪除已儲存的狩獵進度嗎？狩獵紀錄與設定不會受到影響。',
        confirmLabel: '清除'
      }).then((accepted) => {
        if (accepted) clearProgress();
      });
      break;
    default:
      break;
  }
}

const upAxis = new THREE.Vector3(0, 1, 0);
const forwardAxis = new THREE.Vector3(0, 0, 1);
const tempVectors = {
  moveInput: new THREE.Vector3(),
  moveVector: new THREE.Vector3(),
  forward: new THREE.Vector3(),
  toBoss: new THREE.Vector3(),
  toHunter: new THREE.Vector3(),
  hitCenter: new THREE.Vector3(),
  headWorld: new THREE.Vector3(),
  tailWorld: new THREE.Vector3(),
  screen: new THREE.Vector3(),
  targetCamera: new THREE.Vector3(),
  lookTarget: new THREE.Vector3()
};

/* ==============================================================
   5. 操作輸入監聽 (Controls & Keyboard / Mouse / Touch)
   ============================================================== */
const keys = Object.create(null);
let isRightMouseDown = false;
let cameraYaw = 0;
let cameraPitch = 0.35;
let cameraDistance = 18;
let titleOrbit = 2.5;

const canvas = renderer.domElement;
const lockButton = document.querySelector('#touch-controls [data-action="lock"]');

function setInputMode(mode) {
  if (document.body.dataset.input !== mode) document.body.dataset.input = mode;
}
if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) setInputMode('touch');

function rotateCamera(deltaX, deltaY, scale) {
  if (phase !== 'hunting') return;
  const sensitivity = scale * settings.cameraSensitivity;
  if (!isLockOn) cameraYaw -= deltaX * sensitivity;
  cameraPitch = Math.max(0.1, Math.min(1.2, cameraPitch + deltaY * sensitivity * 0.75));
}

window.addEventListener('keydown', (e) => {
  audio.init();
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  setInputMode('keyboard');
  const k = e.key.toLowerCase();
  if (phase === 'paused' && k === 'p' && !e.repeat && !menus.hasDialog()) {
    e.preventDefault();
    audio.playUiBack();
    resumeHunt();
    return;
  }
  if (menus.isOpen()) {
    menus.handleKey(e);
    return;
  }
  if (phase !== 'hunting') return;
  if (k === 'escape' || k === 'p') {
    e.preventDefault();
    if (!e.repeat) pauseHunt();
    return;
  }
  if (k === ' ' || k === 'tab') e.preventDefault();
  keys[k] = true;
  if (e.repeat) return;
  if (k === ' ') triggerDodge();
  else if (k === 'j') handleLightAttack();
  else if (k === 'k') startCharge();
  else if (k === 'e') usePotion();
  else if (k === 'r') useSharpen();
  else if (k === '1') setWeaponMode('greatsword');
  else if (k === '2') setWeaponMode('dualblades');
  else if (k === 'tab' || k === 'f') toggleLockOn();
  else if (k === 'h') toggleHints();
});

window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  keys[k] = false;
  if (k === 'k' && player.isCharging) releaseCharge();
});

// 滑鼠改以 pointerType === 'mouse' 過濾，避免觸控合成 mousedown 誤觸斬擊。
canvas.addEventListener('pointerdown', (e) => {
  audio.init();
  if (e.pointerType !== 'mouse') return;
  setInputMode('keyboard');
  if (phase !== 'hunting') return;
  if (e.button === 0 && !player.isCharging) handleLightAttack();
  if (e.button === 2) isRightMouseDown = true;
});
window.addEventListener('pointerup', (e) => {
  if (e.pointerType === 'mouse' && e.button === 2) isRightMouseDown = false;
});
window.addEventListener('pointercancel', (e) => {
  if (e.pointerType === 'mouse') isRightMouseDown = false;
});
window.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse' || !isRightMouseDown) return;
  rotateCamera(e.movementX, e.movementY, 0.004);
});
canvas.addEventListener('wheel', (e) => {
  if (phase !== 'hunting') return;
  e.preventDefault();
  cameraDistance = THREE.MathUtils.clamp(cameraDistance + Math.sign(e.deltaY) * 1.2, 11, 24);
}, { passive: false });
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('pointerdown', (e) => {
  audio.init();
  if (e.pointerType === 'touch') setInputMode('touch');
  else if (e.pointerType === 'mouse') setInputMode('keyboard');
}, { capture: true });

const touch = createTouchControls({
  surface: canvas,
  isHunting: () => phase === 'hunting',
  onAction: (action) => {
    if (action === 'light') handleLightAttack();
    else if (action === 'dodge') triggerDodge();
    else if (action === 'charge') startCharge();
    else if (action === 'lock') toggleLockOn();
  },
  onActionEnd: (action) => {
    if (action === 'charge') releaseCharge();
  },
  onLook: (deltaX, deltaY) => rotateCamera(deltaX, deltaY, 0.0058)
});

function applySettings() {
  writeSettings(saveStorage, settings);
  audio.setMasterVolume(settings.masterVolume);
  hud.applySettings(settings);
  touch.refreshLayout();
  world.applyGraphicsQuality();
  needsStaticRender = true;
}

// HUD 上可點擊的元件；點完立刻移除焦點，避免空白鍵（翻滾）又觸發一次按鈕。
const bindHudButton = (id, handler) => {
  document.getElementById(id)?.addEventListener('click', (event) => {
    event.currentTarget.blur();
    handler();
  });
};
bindHudButton('weapon-emblem', () => setWeaponMode(weaponMode === 'greatsword' ? 'dualblades' : 'greatsword'));
bindHudButton('slot-potion', usePotion);
bindHudButton('slot-whetstone', useSharpen);
bindHudButton('pause-button', pauseHunt);
bindHudButton('hints-toggle', toggleHints);

function resetInputState() {
  for (const key of Object.keys(keys)) keys[key] = false;
  isRightMouseDown = false;
  touch.reset();
  if (player.isCharging) {
    player.isCharging = false;
    player.chargeTime = 0;
    player.chargeLevel = 1;
    player.state = 'idle';
  }
}

window.addEventListener('blur', resetInputState);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  resetInputState();
  // 切到其他分頁時自動暫停，回來不會發現獵人已經倒地
  if (phase === 'hunting') pauseHunt();
});

function setLockOn(active) {
  isLockOn = active;
  if (lockButton) lockButton.setAttribute('aria-pressed', String(active));
  hud.lockOnChanged(active);
}

function toggleLockOn() {
  if (phase !== 'hunting' || monster.state === 'dead') return;
  setLockOn(!isLockOn);
  audio.playUiMove();
}

function toggleHints() {
  hintsCollapseTimer = 0;
  hud.setHintsCollapsed(!hud.areHintsCollapsed());
}

/* ==============================================================
   6. 獵人招式與動作機制 (Combos, Dodges, Items)
   ============================================================== */
function denyStamina() {
  hud.denyStamina();
  audio.playUiDeny();
}

/** 出招或翻滾前先決定面向：鎖定時朝向魔物，否則沿著目前的移動輸入。 */
function faceActionDirection(preferTarget) {
  if (preferTarget && isLockOn) {
    const toBoss = tempVectors.toBoss.subVectors(monsterGroup.position, hunterGroup.position);
    if (toBoss.lengthSq() > 0.01) hunterGroup.rotation.y = Math.atan2(toBoss.x, toBoss.z);
    return;
  }
  if (moveInputForVisual.x * moveInputForVisual.x + moveInputForVisual.z * moveInputForVisual.z > 0.01) {
    hunterGroup.rotation.y = Math.atan2(moveInputForVisual.x, moveInputForVisual.z);
  }
}

function triggerDodge() {
  if (phase !== 'hunting' || player.state !== 'idle') return;
  if (player.stamina < DODGE_COST) {
    denyStamina();
    return;
  }
  player.stamina -= DODGE_COST;
  player.state = 'dodge';
  player.timer = 0.44;
  player.actionDuration = 0.44;
  player.invincible = 0.38; // 380ms 無敵翻滾幀
  faceActionDirection(false);
  audio.playRoll();
}

function handleLightAttack() {
  const profile = WEAPON_PROFILES[weaponMode];
  if (phase !== 'hunting' || player.state !== 'idle') return;
  if (player.stamina < profile.lightCost) {
    denyStamina();
    return;
  }
  player.stamina -= profile.lightCost;
  player.comboStep = nextComboStep(player.comboStep, player.comboTimer > 0);
  player.comboTimer = profile.lightDuration + 0.45;
  player.state = 'attack_light';
  player.timer = profile.lightDuration;
  player.actionDuration = profile.lightDuration;
  player.hasHitThisSwing = false;
  faceActionDirection(true);
  audio.playSlash(false);
}

function startCharge() {
  const profile = WEAPON_PROFILES[weaponMode];
  if (phase !== 'hunting' || player.state !== 'idle') return;
  if (player.stamina < profile.chargeCost) {
    denyStamina();
    return;
  }
  player.isCharging = true;
  player.chargeTime = 0;
  player.chargeLevel = getChargeLevel(0);
  player.state = 'charging';
  faceActionDirection(true);
}

function releaseCharge() {
  if (phase !== 'hunting' || !player.isCharging) return;
  const profile = WEAPON_PROFILES[weaponMode];
  player.isCharging = false;
  player.stamina = Math.max(0, player.stamina - profile.chargeCost);
  player.state = 'attack_heavy';
  player.timer = profile.heavyDuration;
  player.actionDuration = profile.heavyDuration;
  player.hasHitThisSwing = false;
  audio.playSlash(true);
}

function usePotion() {
  if (phase !== 'hunting' || player.state !== 'idle') return;
  if (player.potions <= 0 || player.hp >= player.maxHp) {
    hud.denyItem('potion');
    audio.playUiDeny();
    return;
  }
  // 喝藥需要時間：體力在動作期間逐步回復，途中被擊中就會中斷
  player.state = 'potion';
  player.timer = 1.25;
  player.actionDuration = 1.25;
  player.potions--;
  player.pendingHeal = POTION_HEAL;
  hunt.potionsUsed += 1;
  audio.playHeal();
  hud.itemUsed('potion');
}

function useSharpen() {
  if (phase !== 'hunting' || player.state !== 'idle') return;
  if (player.sharpness >= 100) {
    hud.denyItem('whetstone');
    audio.playUiDeny();
    return;
  }
  // 磨刀要磨完三下才會生效，挑魔物喘息的空檔再磨
  player.state = 'sharpen';
  player.timer = 1.5;
  player.actionDuration = 1.5;
  player.sharpenStrokes = 0;
  player.sharpenFlashTimer = 0;
  hud.itemUsed('whetstone');
}

function getCurrentSharpness() {
  return getSharpnessLevel(player.sharpness, SHARPNESS_LEVELS);
}

function triggerHitstop(duration = 0.08) {
  hitstopTimer = duration;
}

function triggerScreenShake(intensity = 0.5, duration = 0.25) {
  screenShakeIntensity = intensity * settings.cameraShake;
  screenShakeTimer = duration;
}

/** 世界座標 → 螢幕像素；點落在鏡頭後方時回傳 false。 */
function projectToScreen(position, heightOffset, out) {
  const projected = tempVectors.screen.copy(position);
  projected.y += heightOffset;
  projected.project(camera);
  out.x = (projected.x * 0.5 + 0.5) * window.innerWidth;
  out.y = (-(projected.y * 0.5) + 0.5) * window.innerHeight;
  return projected.z < 1;
}

/** 魔物相對於鏡頭正前方的方位角（順時針為正），用於受擊方向與畫面外指標。 */
function bearingToMonster() {
  const dx = monsterGroup.position.x - hunterGroup.position.x;
  const dz = monsterGroup.position.z - hunterGroup.position.z;
  const sin = Math.sin(cameraYaw);
  const cos = Math.cos(cameraYaw);
  return Math.atan2(dx * cos - dz * sin, -(dx * sin + dz * cos));
}

const floatingPoint = { x: 0, y: 0 };
function spawnFloatingText(worldPos, text, kind, heightOffset = 0, always = false) {
  if (!projectToScreen(worldPos, heightOffset, floatingPoint)) return;
  hud.damageNumber({ x: floatingPoint.x, y: floatingPoint.y, text, kind, always });
}

/* ---------- 魔物身體的幾何近似 ---------- */
const monsterSpine = {
  tail: { x: 0, z: 0 },
  head: { x: 0, z: 0 },
  zones: { tailUntil: 0, headFrom: 1 }
};
const monsterGapClosest = { t: 0, x: 0, z: 0, distance: 0 };

function getMonsterSpine() {
  const yaw = monsterGroup.rotation.y;
  const forwardX = Math.sin(yaw);
  const forwardZ = Math.cos(yaw);
  const tailZ = monster.isTailBroken ? MONSTER_BODY.severedTailZ : MONSTER_BODY.tailZ;
  const length = MONSTER_BODY.headZ - tailZ;
  monsterSpine.tail.x = monsterGroup.position.x + forwardX * tailZ;
  monsterSpine.tail.z = monsterGroup.position.z + forwardZ * tailZ;
  monsterSpine.head.x = monsterGroup.position.x + forwardX * MONSTER_BODY.headZ;
  monsterSpine.head.z = monsterGroup.position.z + forwardZ * MONSTER_BODY.headZ;
  monsterSpine.zones.tailUntil = (MONSTER_BODY.tailUntilZ - tailZ) / length;
  monsterSpine.zones.headFrom = (MONSTER_BODY.headFromZ - tailZ) / length;
  return monsterSpine;
}

const spineZone = (t, zones) => (t >= zones.headFrom ? 'head' : (t <= zones.tailUntil ? 'tail' : 'body'));

/** 獵人與魔物身體表面之間的空隙；小於 0 代表重疊。 */
function measureMonsterGap() {
  const spine = getMonsterSpine();
  const position = hunterGroup.position;
  const closest = closestPointOnSegment2DInto(
    position.x, position.z,
    spine.tail.x, spine.tail.z,
    spine.head.x, spine.head.z,
    monsterGapClosest
  );
  const minDistance = MONSTER_BODY.collisionRadii[spineZone(closest.t, spine.zones)] + 0.6;
  return { closest, minDistance, gap: closest.distance - minDistance };
}

/** 獵人不能穿過魔物的身體：重疊時沿最近點的法線方向推開。 */
function resolveMonsterCollision() {
  if (monster.state === 'dead' || player.state === 'down') return;
  const { closest, minDistance, gap } = measureMonsterGap();
  if (gap >= 0) return;
  const position = hunterGroup.position;
  let normalX = position.x - closest.x;
  let normalZ = position.z - closest.z;
  const length = Math.hypot(normalX, normalZ);
  if (length < 1e-4) {
    normalX = Math.cos(monsterGroup.rotation.y);
    normalZ = -Math.sin(monsterGroup.rotation.y);
  } else {
    normalX /= length;
    normalZ /= length;
  }
  position.x = closest.x + normalX * minDistance;
  position.z = closest.z + normalZ * minDistance;
  clampToArena(position, ARENA.radius);
}

/* ==============================================================
   7. 獵人更新邏輯 (Player Update)
   ============================================================== */
/** 武器待機姿勢：大劍斜靠在肩後，雙劍自然垂持。 */
function easeWeaponToRest(dt) {
  const alpha = Math.min(1, 14 * dt);
  const restX = weaponMode === 'dualblades' ? 0 : -0.42;
  const restZ = weaponMode === 'dualblades' ? 0 : -0.1;
  weaponPivot.rotation.x = THREE.MathUtils.lerp(weaponPivot.rotation.x, restX, alpha);
  weaponPivot.rotation.z = THREE.MathUtils.lerp(weaponPivot.rotation.z, restZ, alpha);
  hunterRig.dualHands.forEach((hand, idx) => {
    hand.rotation.set(0.175, 0, idx === 0 ? 0.14 : -0.14);
  });
}

function updatePlayer(dt) {
  if (player.comboTimer > 0) {
    player.comboTimer = Math.max(0, player.comboTimer - dt);
  } else {
    player.comboStep = 0;
  }
  if (player.invincible > 0) player.invincible = Math.max(0, player.invincible - dt);
  if (player.focusTimer > 0) player.focusTimer = Math.max(0, player.focusTimer - dt);

  // 翻滾無敵時胸甲泛藍光
  setHunterBodyEmissive(player.state === 'dodge' && player.invincible > 0 ? 0x2b6f9c : 0x000000);

  // 移動向量：鍵盤與觸控搖桿合併後，依鏡頭 Yaw 轉成世界方向
  const moveInput = tempVectors.moveInput.set(touch.move.x, 0, touch.move.y);
  if (keys['w'] || keys['arrowup']) moveInput.z -= 1;
  if (keys['s'] || keys['arrowdown']) moveInput.z += 1;
  if (keys['a'] || keys['arrowleft']) moveInput.x -= 1;
  if (keys['d'] || keys['arrowright']) moveInput.x += 1;

  let moveAmount = Math.min(1, moveInput.length());
  const moveVec = tempVectors.moveVector.set(0, 0, 0);
  if (moveAmount > 0.05 && player.state !== 'down') {
    moveVec.copy(moveInput).normalize().applyAxisAngle(upAxis, cameraYaw);
  } else {
    moveAmount = 0;
  }
  moveInputForVisual.x = moveVec.x;
  moveInputForVisual.z = moveVec.z;

  let walking = false;
  let rollAngle = 0;
  let bodyPitch = 0;

  if (player.state === 'idle') {
    player.stamina = Math.min(player.maxStamina, player.stamina + 24 * dt);
    easeWeaponToRest(dt);
    setWeaponEmissive(player.focusTimer > 0 ? 0x2a6a8a : 0x000000);
    if (moveAmount > 0) {
      hunterGroup.position.addScaledVector(moveVec, player.speed * moveAmount * dt);
      hunterGroup.rotation.y = lerpAngle(hunterGroup.rotation.y, Math.atan2(moveVec.x, moveVec.z), Math.min(1, 16 * dt));
      walking = true;
    }
  } else if (player.state === 'charging') {
    const previousLevel = player.chargeLevel;
    player.chargeTime = Math.min(1.65, player.chargeTime + dt);
    player.chargeLevel = getChargeLevel(player.chargeTime);
    if (player.chargeLevel > previousLevel) {
      audio.playChargeTick(player.chargeLevel);
      hud.chargeLevelUp();
    }
    const chargeColor = player.chargeLevel >= 3 ? 0xff4757 : (player.chargeLevel === 2 ? 0xf39c12 : 0xe67e22);
    setWeaponEmissive(chargeColor);
    weaponPivot.rotation.x = THREE.MathUtils.lerp(weaponPivot.rotation.x, -Math.PI * 0.7, Math.min(1, 12 * dt));
    weaponPivot.rotation.z = 0;

    // 蓄力時可緩慢調整面向：鎖定或沒有輸入時朝向魔物，否則跟著移動輸入
    const toBoss = tempVectors.toBoss.subVectors(monsterGroup.position, hunterGroup.position);
    const aim = (isLockOn || moveAmount === 0)
      ? Math.atan2(toBoss.x, toBoss.z)
      : Math.atan2(moveVec.x, moveVec.z);
    hunterGroup.rotation.y = lerpAngle(hunterGroup.rotation.y, aim, Math.min(1, 4 * dt));
  } else if (player.state === 'dodge') {
    player.timer -= dt;
    const forward = tempVectors.forward.copy(forwardAxis).applyAxisAngle(upAxis, hunterGroup.rotation.y);
    hunterGroup.position.addScaledVector(forward, player.speed * 2.0 * dt);
    rollAngle = (1 - Math.max(0, player.timer) / player.actionDuration) * Math.PI * 2;
    if (player.timer <= 0) {
      player.state = 'idle';
      rollAngle = 0;
    }
  } else if (player.state === 'ear_cover') {
    // 咆哮掩耳硬直
    player.timer -= dt;
    weaponPivot.rotation.x = THREE.MathUtils.lerp(weaponPivot.rotation.x, -Math.PI * 0.3, Math.min(1, 12 * dt));
    bodyPitch = 0.16;
    if (player.timer <= 0) player.state = 'idle';
  } else if (player.state === 'potion') {
    player.timer -= dt;
    easeWeaponToRest(dt);
    // 邊喝邊走：移動速度降低，體力在動作中段逐步回復
    if (moveAmount > 0) {
      hunterGroup.position.addScaledVector(moveVec, player.speed * 0.38 * moveAmount * dt);
      hunterGroup.rotation.y = lerpAngle(hunterGroup.rotation.y, Math.atan2(moveVec.x, moveVec.z), Math.min(1, 10 * dt));
      walking = true;
    }
    const progress = 1 - player.timer / player.actionDuration;
    if (progress > 0.22 && player.pendingHeal > 0) {
      const step = Math.min(player.pendingHeal, (POTION_HEAL / (player.actionDuration * 0.62)) * dt);
      player.pendingHeal -= step;
      player.hp = Math.min(player.maxHp, player.hp + step);
    }
    if (player.timer <= 0) {
      player.hp = Math.min(player.maxHp, player.hp + player.pendingHeal);
      player.pendingHeal = 0;
      player.state = 'idle';
    }
  } else if (player.state === 'sharpen') {
    player.timer -= dt;
    const progress = 1 - player.timer / player.actionDuration;
    weaponPivot.rotation.x = THREE.MathUtils.lerp(weaponPivot.rotation.x, 1.15, Math.min(1, 10 * dt));
    bodyPitch = 0.2;
    if (progress > 0.16 + player.sharpenStrokes * 0.27 && player.sharpenStrokes < 3) {
      player.sharpenStrokes += 1;
      player.sharpenFlashTimer = 0.16;
      audio.playSharpen();
    } else if (player.sharpenFlashTimer > 0) {
      player.sharpenFlashTimer = Math.max(0, player.sharpenFlashTimer - dt);
    }
    setWeaponEmissive(player.sharpenFlashTimer > 0 ? 0x9fdcff : 0x000000);
    if (player.timer <= 0) {
      player.sharpness = 100;
      player.sharpenFlashTimer = 0;
      player.state = 'idle';
      setWeaponEmissive(0x000000);
      hud.toast('斬味已回復至最佳狀態', { icon: 'edge', tone: 'good' });
    }
  } else if (player.state === 'flinch') {
    // 受擊踉蹌：被震退並短暫失去控制
    player.timer -= dt;
    hunterGroup.position.addScaledVector(player.knockback, dt);
    player.knockback.multiplyScalar(Math.max(0, 1 - 7 * dt));
    bodyPitch = -0.3 * Math.sin(Math.max(0, player.timer / player.actionDuration) * Math.PI);
    easeWeaponToRest(dt);
    if (player.timer <= 0) player.state = 'idle';
  } else if (player.state === 'down') {
    bodyPitch = -1.45;
    setWeaponEmissive(0x000000);
  } else if (player.state === 'attack_light' || player.state === 'attack_heavy') {
    const isHeavy = player.state === 'attack_heavy';
    const profile = WEAPON_PROFILES[weaponMode];
    const duration = isHeavy ? profile.heavyDuration : profile.lightDuration;
    player.timer -= dt;
    const progress = 1 - (player.timer / duration);

    const comboAngle = !isHeavy ? [0, 0.12, -0.12][player.comboStep] : 0;
    weaponPivot.rotation.x = -Math.PI * 0.7 + Math.PI * 1.55 * Math.min(1, progress * 1.4);
    weaponPivot.rotation.z = comboAngle;
    if (weaponMode === 'dualblades') {
      hunterRig.dualHands.forEach((hand, idx) => {
        const sideDir = idx === 0 ? -1 : 1;
        hand.rotation.z = sideDir * (0.28 * Math.sin(progress * Math.PI * 2));
      });
    }

    // 出招時踏步前進，讓揮擊帶有重量與追擊距離
    if (progress > 0.08 && progress < 0.5) {
      const forward = tempVectors.forward.copy(forwardAxis).applyAxisAngle(upAxis, hunterGroup.rotation.y);
      hunterGroup.position.addScaledVector(forward, (profile.lunge / (duration * 0.42)) * dt);
    }
    bodyPitch = 0.14 * Math.sin(Math.min(1, progress) * Math.PI);

    if (!player.hasHitThisSwing && progress > 0.3 && progress < 0.7) {
      checkHunterAttackHit(isHeavy, player.chargeLevel, !isHeavy ? [1, 1.08, 1.2][player.comboStep] : 1);
    }

    if (player.timer <= 0) {
      player.state = 'idle';
      player.chargeLevel = 1;
      setWeaponEmissive(0x000000);
    }
  }

  // 身體前後傾：有 GLB 模型時翻滾由模型處理，簡易模型則整個群組一起轉
  if (hunterVisual) {
    hunterGroup.rotation.x = THREE.MathUtils.lerp(hunterGroup.rotation.x, bodyPitch, Math.min(1, (player.state === 'down' ? 4 : 14) * dt));
  } else {
    hunterGroup.rotation.x = rollAngle !== 0 ? rollAngle : bodyPitch;
  }
  animateHunterVisual(dt, walking, rollAngle);

  // 獵場邊界：被巨石與樹木圍住的圓形空地，骨骸與倒木無法穿越
  resolveStaticCollisions(hunterGroup.position, 0.6);
  clampToArena(hunterGroup.position, ARENA.radius);
}

/* ==============================================================
   8. 獵人判定命中魔物 (弱點與部位破壞、斬味消耗)
   ============================================================== */
function checkHunterAttackHit(isHeavy, chargeLevel = 1, comboMultiplier = 1) {
  if (monster.state === 'dead') return;
  const profile = WEAPON_PROFILES[weaponMode];
  const forward = tempVectors.forward.copy(forwardAxis).applyAxisAngle(upAxis, hunterGroup.rotation.y);
  const spine = getMonsterSpine();
  const hit = resolveMonsterHit({
    strike: {
      x: hunterGroup.position.x + forward.x * profile.strikeOffset,
      z: hunterGroup.position.z + forward.z * profile.strikeOffset,
      radius: profile.strikeRadius
    },
    spine,
    zones: spine.zones,
    radii: MONSTER_BODY.radii
  });
  if (!hit) return;
  player.hasHitThisSwing = true;

  // 斬味倍率
  const sharpness = getCurrentSharpness();
  player.sharpness = Math.max(0, player.sharpness - (isHeavy ? 2.5 : 1.2));
  const sharpnessAfter = getCurrentSharpness();
  if (sharpnessAfter.name !== sharpness.name) {
    hud.toast(`斬味下降：${sharpnessAfter.name}`, { icon: 'edge', tone: 'danger' });
  }

  const baseDamage = isHeavy
    ? profile.heavyDamageMin + Math.random() * (profile.heavyDamageMax - profile.heavyDamageMin)
    : profile.lightDamageMin + Math.random() * (profile.lightDamageMax - profile.lightDamageMin);
  const chargeMultiplier = isHeavy ? [1, 1.15, 1.35, 1.6][Math.max(1, Math.min(3, chargeLevel))] : 1;

  // 命中部位：頭部為弱點，尾部可被切斷
  const hitWeakpoint = hit.zone === 'head';
  const focusMultiplier = player.focusTimer > 0 ? 1.25 : 1;
  const finalDamage = calculateAttackDamage({
    baseDamage,
    sharpnessMultiplier: sharpness.mult,
    weakpointMultiplier: hitWeakpoint ? 1.35 : 1,
    chargeMultiplier,
    comboMultiplier: comboMultiplier * focusMultiplier
  });

  // 特效位置：命中點往獵人方向退到身體表面
  const surface = MONSTER_BODY.radii[hit.zone] * 0.85;
  const toHunterX = hunterGroup.position.x - hit.point.x;
  const toHunterZ = hunterGroup.position.z - hit.point.z;
  const toHunterLength = Math.hypot(toHunterX, toHunterZ) || 1;
  const hitCenter = tempVectors.hitCenter.set(
    hit.point.x + (toHunterX / toHunterLength) * surface,
    hit.zone === 'head' ? 2.9 : (hit.zone === 'tail' ? 1.9 : 2.3),
    hit.point.z + (toHunterZ / toHunterLength) * surface
  );

  if (hitWeakpoint) {
    monster.headHp -= finalDamage;
    if (monster.headHp <= 0 && !monster.isHeadBroken) {
      monster.isHeadBroken = true;
      syncMonsterPartBreakVisuals();
      particleSystem.spawnHitSparks(headGroup.getWorldPosition(tempVectors.headWorld), 32, true);
      audio.playPartBreak();
      triggerScreenShake(0.9, 0.4);
      hud.partBroken('head');
      hud.callout({ eyebrow: 'PART BROKEN', title: '頭角破壞', duration: 1900 });
    }
  } else if (hit.zone === 'tail' && !monster.isTailBroken) {
    monster.tailHp -= finalDamage;
    if (monster.tailHp <= 0) {
      monster.isTailBroken = true;
      spawnSeveredTail();
      syncMonsterPartBreakVisuals();
      particleSystem.spawnHitSparks(tailGroup.getWorldPosition(tempVectors.tailWorld), 28, true);
      audio.playPartBreak();
      triggerScreenShake(0.9, 0.4);
      hud.partBroken('tail');
      hud.callout({ eyebrow: 'PART SEVERED', title: '尾部切斷', duration: 1900 });
    }
  }

  const dealt = Math.min(monster.hp, finalDamage);
  monster.hp = Math.max(0, monster.hp - finalDamage);
  monster.staggerBuildUp += finalDamage;
  monster.hitFlashTimer = isHeavy ? 0.18 : 0.11;
  hunt.damageDealt += dealt;
  hunt.hits += 1;
  hunt.maxHit = Math.max(hunt.maxHit, finalDamage);
  if (hitWeakpoint) hunt.weakpointHits += 1;

  // 核心打擊反饋：Hitstop (卡肉感) + ScreenShake (震屏) + 火花粒子
  triggerHitstop(isHeavy ? 0.1 : (hitWeakpoint ? 0.07 : 0.05));
  triggerScreenShake(isHeavy ? 0.65 : 0.35, 0.22);
  hud.impactFlash(isHeavy);
  particleSystem.spawnHitSparks(hitCenter, isHeavy ? 24 : 14, isHeavy || hitWeakpoint);
  audio.playHit(isHeavy);
  spawnFloatingText(hitCenter, String(finalDamage), hitWeakpoint ? 'weak' : (isHeavy ? 'heavy' : 'normal'), 0.9);

  if (monster.hp <= 0) {
    finishHunt(true, 'slain');
    return;
  }

  // 硬直倒地 (Stagger)
  if (monster.staggerBuildUp >= 200 && monster.state !== 'stagger' && monster.state !== 'roar') {
    monster.staggerBuildUp = 0;
    monster.state = 'stagger';
    monster.timer = 2.8;
    setMonsterEmissive(0x000000);
    hud.toast(`${GAME.monsterName}失衡倒地`, { icon: 'down', tone: 'good' });
  }
}

/** 精準迴避：在攻擊命中的瞬間以翻滾無敵穿過，獎勵短暫的慢動作、耐力與會心狀態。 */
function triggerPerfectDodge() {
  slowMotionTimer = 0.42;
  player.stamina = Math.min(player.maxStamina, player.stamina + 30);
  player.focusTimer = FOCUS_DURATION;
  hunt.perfectDodges += 1;
  audio.playChargeTick(3);
  hud.impactFlash(false);
  hud.toast('精準迴避！進入會心狀態', { icon: 'target', tone: 'good', duration: 2600 });
}

/** 魔物的攻擊判定成立時呼叫：依獵人狀態決定是受傷、被精準迴避，還是暫時無效。 */
function resolveMonsterAttack(damage) {
  if (phase !== 'hunting' || monster.hasDealtDamage) return;
  if (player.invincible > 0) {
    if (player.state === 'dodge') {
      monster.hasDealtDamage = true;
      triggerPerfectDodge();
    }
    return;
  }
  monster.hasDealtDamage = true;
  damagePlayer(damage);
}

/* ==============================================================
   9. 魔物 AI 與行為狀態機 (Monster AI, Roar, Enrage)
   ============================================================== */
function updateMonster(dt) {
  animateMonsterVisual();
  updateEnrageAura(dt);
  updateMonsterTelegraph(dt);

  if (monster.state === 'dead') {
    // 討伐完成：側身倒下後不再行動
    monster.timer += dt;
    monsterGroup.rotation.z = THREE.MathUtils.lerp(monsterGroup.rotation.z, 1.3, Math.min(1, 3 * dt));
    monsterGroup.rotation.x = THREE.MathUtils.lerp(monsterGroup.rotation.x, 0, Math.min(1, 6 * dt));
    if (monster.hitFlashTimer > 0) {
      monster.hitFlashTimer = Math.max(0, monster.hitFlashTimer - dt);
      setMonsterEmissive(0xffffff);
    } else {
      setMonsterEmissive(0x000000);
    }
    return;
  }

  // 力盡敗北進入結算慢動作時，魔物停止觸發新咆哮、攻擊與傷害判定。
  if (phase !== 'hunting') {
    monsterGroup.rotation.z = THREE.MathUtils.lerp(monsterGroup.rotation.z, 0, Math.min(1, 6 * dt));
    monsterGroup.rotation.x = THREE.MathUtils.lerp(monsterGroup.rotation.x, 0, Math.min(1, 6 * dt));
    if (monster.hitFlashTimer > 0) {
      monster.hitFlashTimer = Math.max(0, monster.hitFlashTimer - dt);
    }
    setMonsterEmissive(monster.isEnraged ? 0x3a002d : 0x000000);
    return;
  }

  const toHunter = tempVectors.toHunter.subVectors(hunterGroup.position, monsterGroup.position);
  toHunter.y = 0;
  const dist = toHunter.length();

  // 檢查血量觸發憤怒咆哮 (Enrage Roar at 65% and 28% HP)
  if ((monster.hp <= monster.maxHp * 0.65 && !monster.hasRoared60) ||
      (monster.hp <= monster.maxHp * 0.28 && !monster.hasRoared25)) {
    if (!monster.hasRoared60) monster.hasRoared60 = true;
    else monster.hasRoared25 = true;

    triggerMonsterRoar();
    return;
  }

  // 怒氣計時
  if (monster.isEnraged) {
    monster.enrageTimer -= dt;
    eyeLightL.intensity = 2.5;
    eyeLightR.intensity = 2.5;
    if (monster.enrageTimer <= 0) {
      monster.isEnraged = false;
      eyeLightL.intensity = 0;
      eyeLightR.intensity = 0;
      hud.toast(`${GAME.monsterName}的狂暴平息了`, { icon: 'rage', tone: 'calm' });
    }
  }

  const speedMult = monster.isEnraged ? 1.35 : 1.0;
  let targetRoll = 0;

  // 狀態機處理
  if (monster.state === 'roar') {
    monster.timer -= dt;
    monsterGroup.rotation.x = Math.sin(monster.timer * 20) * 0.05; // 仰天長嘯時全身震顫
    if (monster.timer <= 0) {
      monsterGroup.rotation.x = 0;
      monster.state = 'chase';
      monster.timer = 1.0;
    }
  } else if (monster.state === 'chase') {
    monster.timer -= dt;

    if (dist > 0.2) {
      const targetAngle = Math.atan2(toHunter.x, toHunter.z);
      monsterGroup.rotation.y = lerpAngle(monsterGroup.rotation.y, targetAngle, Math.min(1, 5 * dt));
      // 逼近到攻擊距離就停步，不會把獵人一路推著走
      if (dist > 6.6) {
        monsterGroup.position.addScaledVector(toHunter.normalize(), 7.2 * speedMult * dt);
      }
    }

    // 距離近時出迴旋甩尾，距離遠出衝撞
    if (dist < 7.6 && monster.timer <= 0.4) {
      monster.state = 'telegraph_spin';
      monster.timer = monster.isEnraged ? 0.45 : 0.7;
      audio.playTelegraph('spin', monster.isEnraged);
    } else if (monster.timer <= 0) {
      monster.state = 'telegraph_charge';
      monster.timer = monster.isEnraged ? 0.6 : 0.85;
      monster.chargeDir.copy(toHunter.lengthSq() > 0 ? toHunter.normalize() : forwardAxis);
      audio.playTelegraph('charge', monster.isEnraged);
    }
  } else if (monster.state === 'telegraph_charge') {
    monster.timer -= dt;
    // 蓄力前搖後縮，並把身體對準衝撞方向
    monsterGroup.position.addScaledVector(monster.chargeDir, -2.8 * dt);
    monsterGroup.rotation.y = lerpAngle(
      monsterGroup.rotation.y,
      Math.atan2(monster.chargeDir.x, monster.chargeDir.z),
      Math.min(1, 9 * dt)
    );
    setMonsterEmissive((Math.floor(monster.timer * 18) % 2 === 0) ? 0xff0000 : 0x000000);

    if (monster.timer <= 0) {
      setMonsterEmissive(0x000000);
      monster.state = 'charge';
      monster.timer = 1.1;
      monster.hasDealtDamage = false;
      audio.playWingWhoosh(monster.isEnraged);
    }
  } else if (monster.state === 'charge') {
    monster.timer -= dt;
    monsterGroup.position.addScaledVector(monster.chargeDir, 28 * speedMult * dt);

    if (!monster.hasDealtDamage && measureMonsterGap().gap < 0.9) {
      resolveMonsterAttack(32);
    }

    // 撞上獵場邊緣的岩壁就停下來，留下較長的破綻
    const hitBoundary = clampToArena(monsterGroup.position, ARENA.monsterRadius);
    if (hitBoundary) {
      triggerScreenShake(0.5, 0.25);
      audio.playFootstep(true);
    }
    if (monster.timer <= 0 || hitBoundary) {
      monster.state = 'cooldown';
      monster.timer = (monster.isEnraged ? 0.6 : 1.3) + (hitBoundary ? 0.5 : 0);
    }
  } else if (monster.state === 'telegraph_spin') {
    monster.timer -= dt;
    setMonsterEmissive((Math.floor(monster.timer * 18) % 2 === 0) ? 0xf39c12 : 0x000000);

    if (monster.timer <= 0) {
      setMonsterEmissive(0x000000);
      monster.state = 'spin';
      monster.timer = 0.52;
      monster.hasDealtDamage = false;
      audio.playWingWhoosh(monster.isEnraged);
    }
  } else if (monster.state === 'spin') {
    monster.timer -= dt;
    monsterGroup.rotation.y += (monster.isTailBroken ? 12 : 16) * dt;

    // 若尾巴被切斷，甩尾半徑縮小
    const spinRadius = monster.isTailBroken ? 5.8 : 8.2;
    const currentDist = hunterGroup.position.distanceTo(monsterGroup.position);
    if (!monster.hasDealtDamage && currentDist < spinRadius) {
      resolveMonsterAttack(monster.isTailBroken ? 18 : 26);
    }

    if (monster.timer <= 0) {
      monster.state = 'cooldown';
      monster.timer = monster.isEnraged ? 0.5 : 1.2;
    }
  } else if (monster.state === 'cooldown') {
    monster.timer -= dt;
    if (monster.timer <= 0) {
      monster.state = 'chase';
      monster.timer = 1.5;
    }
  } else if (monster.state === 'stagger') {
    monster.timer -= dt;
    targetRoll = Math.PI / 4.5;
    if (monster.timer <= 0) {
      monster.state = 'chase';
      monster.timer = 1.0;
    }
  }

  monsterGroup.rotation.z = THREE.MathUtils.lerp(monsterGroup.rotation.z, targetRoll, Math.min(1, 8 * dt));

  if (monster.hitFlashTimer > 0) {
    monster.hitFlashTimer = Math.max(0, monster.hitFlashTimer - dt);
    setMonsterEmissive(0xffffff);
  } else if (monster.state !== 'telegraph_charge' && monster.state !== 'telegraph_spin') {
    setMonsterEmissive(monster.isEnraged ? 0x3a002d : 0x000000);
  }

  // 獵場邊界
  clampToArena(monsterGroup.position, ARENA.monsterRadius);
}

function triggerMonsterRoar() {
  monster.state = 'roar';
  monster.timer = 1.6;
  monster.isEnraged = true;
  monster.enrageTimer = 18.0; // 憤怒 18 秒

  audio.playRoar();
  audio.playEnragePulse();
  triggerScreenShake(0.8, 1.2);
  particleSystem.spawnShockwave(monsterGroup.position, 28, 0xff7675);
  hud.toast(`${GAME.monsterName}發出咆哮，陷入狂暴`, { icon: 'rage', tone: 'danger', duration: 3600 });

  // 若獵人距離近且未處於無敵翻滾，則被咆哮震懾掩耳
  const dist = hunterGroup.position.distanceTo(monsterGroup.position);
  if (dist < 26 && player.invincible <= 0 && player.state !== 'down') {
    player.isCharging = false;
    player.chargeTime = 0;
    player.chargeLevel = 1;
    player.pendingHeal = 0;
    player.state = 'ear_cover';
    player.timer = 1.5;
    setWeaponEmissive(0x000000);
    spawnFloatingText(hunterGroup.position, '震懾', 'note', 3.6, true);
  }
}

function damagePlayer(amount) {
  if (phase !== 'hunting' || player.state === 'down') return;
  player.hp = Math.max(0, player.hp - amount);
  hunt.damageTaken += amount;
  hunt.timesHit += 1;
  audio.playHit(true);
  hud.playerHit();
  hud.damageDirection(bearingToMonster());
  triggerScreenShake(0.85, 0.35);

  // 受擊會打斷蓄力、喝藥與磨刀
  player.isCharging = false;
  player.chargeTime = 0;
  player.chargeLevel = 1;
  player.pendingHeal = 0;
  player.sharpenFlashTimer = 0;
  player.focusTimer = 0;
  setWeaponEmissive(0x000000);

  if (player.hp <= 0) {
    player.state = 'down';
    finishHunt(false, 'fainted');
    return;
  }
  player.state = 'flinch';
  player.timer = 0.45;
  player.actionDuration = 0.45;
  player.invincible = 0.9;
  player.knockback.subVectors(hunterGroup.position, monsterGroup.position).setY(0);
  if (player.knockback.lengthSq() < 0.01) player.knockback.set(0, 0, 1);
  player.knockback.normalize().multiplyScalar(13);
}

/* ==============================================================
   10. 相機系統 (Third-Person Chase / Target Lock-on / Free Look)
   ============================================================== */
function updateCamera(dt) {
  skyDome.position.copy(camera.position);

  if (phase === 'loading' || phase === 'title') {
    // 標題畫面：鏡頭繞著獵場緩慢盤旋
    titleOrbit += dt * 0.05;
    camera.position.set(
      ARENA.centerX + Math.sin(titleOrbit) * 25,
      6.4 + Math.sin(titleOrbit * 0.7) * 0.9,
      ARENA.centerZ + Math.cos(titleOrbit) * 25
    );
    camera.lookAt(ARENA.centerX, 3.4, ARENA.centerZ - 3);
    world.updateOccluders(dt, false, hunterGroup.position);
    return;
  }

  if (isLockOn) {
    // 鎖定模式：相機平滑朝向獵人與魔物連線
    const toBoss = tempVectors.toBoss.subVectors(monsterGroup.position, hunterGroup.position);
    toBoss.y = 0;
    if (toBoss.lengthSq() > 0) {
      const targetYaw = Math.atan2(toBoss.x, toBoss.z) + Math.PI;
      cameraYaw = lerpAngle(cameraYaw, targetYaw, Math.min(1, 6 * dt));
    }
  }

  // 相機球形座標計算
  const lockDistance = hunterGroup.position.distanceTo(monsterGroup.position);
  const isFinishing = phase === 'finishing' || phase === 'result';
  let camDist = isLockOn
    ? THREE.MathUtils.clamp(cameraDistance * 0.68 + lockDistance * 0.22, cameraDistance * 0.78, cameraDistance * 1.34)
    : cameraDistance;
  if (isFinishing) camDist *= 0.8;
  const camY = Math.sin(cameraPitch) * camDist + 3.2;
  const horizDist = Math.cos(cameraPitch) * camDist;

  const targetCamPos = tempVectors.targetCamera.set(
    hunterGroup.position.x + Math.sin(cameraYaw) * horizDist,
    hunterGroup.position.y + camY,
    hunterGroup.position.z + Math.cos(cameraYaw) * horizDist
  );

  // 鏡頭不穿出獵場外圍的巨石與樹林：超出範圍時沿著視線拉近
  const offsetX = targetCamPos.x - ARENA.centerX;
  const offsetZ = targetCamPos.z - ARENA.centerZ;
  const cameraRadius = Math.hypot(offsetX, offsetZ);
  if (cameraRadius > ARENA.cameraRadius) {
    const scale = ARENA.cameraRadius / cameraRadius;
    targetCamPos.x = ARENA.centerX + offsetX * scale;
    targetCamPos.z = ARENA.centerZ + offsetZ * scale;
    targetCamPos.y += (cameraRadius - ARENA.cameraRadius) * 0.35;
  }

  // 螢幕震動偏移
  if (screenShakeTimer > 0) {
    screenShakeTimer -= dt;
    const offset = screenShakeIntensity;
    targetCamPos.x += (Math.random() - 0.5) * offset;
    targetCamPos.y += (Math.random() - 0.5) * offset;
    targetCamPos.z += (Math.random() - 0.5) * offset;
  }

  // 進場時鏡頭從盤旋位置緩緩推近；其餘時間緊跟獵人
  const follow = phase === 'intro' ? 0.045 : 0.12;
  camera.position.lerp(targetCamPos, 1 - Math.pow(1 - follow, dt * 60));

  const lookTarget = tempVectors.lookTarget.copy(hunterGroup.position);
  lookTarget.y += 2.0;
  if (isLockOn) {
    lookTarget.lerp(monsterGroup.position, 0.35);
  } else if (isFinishing && finishOutcome && finishOutcome.victory) {
    lookTarget.lerp(monsterGroup.position, 0.6);
  }
  camera.lookAt(lookTarget);
  world.updateOccluders(dt, true, hunterGroup.position);
}

/* ==============================================================
   11. HUD 狀態彙整
   ============================================================== */
const hudState = {
  hp: 0, maxHp: 0, stamina: 0, maxStamina: 0, staminaLow: false,
  sharpness: 0, sharpnessLevel: SHARPNESS_LEVELS[0],
  weaponMode: 'greatsword', weaponLabel: '',
  potions: 0, potionAvailable: true, whetstoneAvailable: true, potionProgress: -1, whetstoneProgress: -1,
  chargeLevel: 0, chargeProgress: 0, comboStep: 0, focusRatio: 0,
  bossHp: 0, bossMaxHp: 0, enraged: false, bossStatus: 'none', bossStatusText: '',
  headBroken: false, tailBroken: false,
  remainingSeconds: 0,
  lock: { active: false, x: 0, y: 0 },
  pointer: { active: false, x: 0, y: 0, angle: 0 },
  threat: { active: false, x: 0, y: 0, kind: 'spin' },
  radar: {
    cameraYaw: 0,
    time: 0,
    lockOn: false,
    hunter: { x: 0, z: 0, yaw: 0 },
    monster: { x: 0, z: 0, yaw: 0, enraged: false, alive: true }
  }
};

function renderHud() {
  const state = hudState;
  const profile = WEAPON_PROFILES[weaponMode];
  const hunting = phase === 'hunting';
  state.hp = player.hp;
  state.maxHp = player.maxHp;
  state.stamina = player.stamina;
  state.maxStamina = player.maxStamina;
  state.staminaLow = player.stamina < DODGE_COST;
  state.sharpness = player.sharpness;
  state.sharpnessLevel = getCurrentSharpness();
  state.weaponMode = weaponMode;
  state.weaponLabel = profile.label;
  state.potions = player.potions;
  state.potionAvailable = player.potions > 0 && player.hp < player.maxHp;
  state.whetstoneAvailable = player.sharpness < 100;
  const actionProgress = player.actionDuration > 0 ? 1 - Math.max(0, player.timer) / player.actionDuration : 0;
  state.potionProgress = player.state === 'potion' ? actionProgress : -1;
  state.whetstoneProgress = player.state === 'sharpen' ? actionProgress : -1;
  state.chargeLevel = player.state === 'charging' ? player.chargeLevel : 0;
  state.chargeProgress = player.chargeTime / 0.55;
  state.comboStep = player.comboTimer > 0 && (player.state === 'attack_light' || player.state === 'idle')
    ? player.comboStep + 1
    : 0;
  state.focusRatio = player.focusTimer / FOCUS_DURATION;

  state.bossHp = monster.hp;
  state.bossMaxHp = monster.maxHp;
  state.enraged = monster.isEnraged;
  const status = BOSS_STATUS[monster.state] || (monster.isEnraged ? ['enraged', '狂暴'] : ['none', '']);
  state.bossStatus = monster.state === 'dead' ? 'none' : status[0];
  state.bossStatusText = status[1];
  state.headBroken = monster.isHeadBroken;
  state.tailBroken = monster.isTailBroken;
  state.remainingSeconds = remainingQuestSeconds();

  // 鎖定準星：貼在魔物身體中段
  const monsterVisible = projectToScreen(monsterGroup.position, 2.8, state.lock);
  const onScreen = monsterVisible
    && state.lock.x > 40 && state.lock.x < window.innerWidth - 40
    && state.lock.y > 40 && state.lock.y < window.innerHeight - 40;
  state.lock.active = hunting && isLockOn && monsterVisible;

  // 魔物離開畫面時，在畫面邊緣指出牠的方位
  state.pointer.active = hunting && !onScreen && monster.state !== 'dead';
  if (state.pointer.active) {
    const bearing = bearingToMonster();
    state.pointer.angle = bearing;
    state.pointer.x = window.innerWidth / 2 + Math.sin(bearing) * window.innerWidth * 0.42;
    state.pointer.y = window.innerHeight / 2 - Math.cos(bearing) * window.innerHeight * 0.36;
  }

  // 出招預警：浮在魔物頭頂的驚嘆號
  const telegraphing = monster.state === 'telegraph_charge' || monster.state === 'telegraph_spin';
  state.threat.active = false;
  if (hunting && telegraphing) {
    const head = headGroup.getWorldPosition(tempVectors.headWorld);
    state.threat.active = projectToScreen(head, 3.4, state.threat);
    state.threat.kind = monster.state === 'telegraph_charge' ? 'charge' : 'spin';
  }

  const radar = state.radar;
  radar.cameraYaw = cameraYaw;
  radar.time = simElapsed;
  radar.lockOn = isLockOn;
  radar.hunter.x = hunterGroup.position.x;
  radar.hunter.z = hunterGroup.position.z;
  radar.hunter.yaw = hunterGroup.rotation.y;
  radar.monster.x = monsterGroup.position.x;
  radar.monster.z = monsterGroup.position.z;
  radar.monster.yaw = monsterGroup.rotation.y;
  radar.monster.enraged = monster.isEnraged;
  radar.monster.alive = monster.state !== 'dead';

  hud.render(state);
}

/* ==============================================================
   12. 主遊戲迴圈 (Game Loop & Animation)
   ============================================================== */
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const rawDt = Math.min(clock.getDelta(), 0.1);
  if (world.isContextLost()) return;

  // 靜態覆蓋畫面（暫停／結算／載入）只在狀態切換或視窗更新時重繪，避免背景空轉消耗 GPU。
  if (phase === 'paused' || phase === 'result' || phase === 'loading') {
    if (needsStaticRender) {
      renderer.render(scene, camera);
      needsStaticRender = false;
    }
    return;
  }

  const simulating = phase === 'hunting' || phase === 'finishing';

  // Hitstop 卡肉頓幀處理：頓幀期間僅渲染畫面，角色邏輯暫停，產生打擊停留感
  if (simulating && hitstopTimer > 0) {
    hitstopTimer -= rawDt;
    renderer.render(scene, camera);
    return;
  }

  if (phase === 'hunting') {
    if (slowMotionTimer > 0) {
      slowMotionTimer -= rawDt;
      timeScale = 0.3;
    } else {
      timeScale = Math.min(1, timeScale + rawDt * 4);
    }
  } else if (phase === 'finishing') {
    // 終結一擊後的慢動作，隨時間回到正常速度
    timeScale = Math.min(1, timeScale + rawDt * 0.3);
  }
  const dt = rawDt * (simulating ? timeScale : 1);
  simElapsed += dt;

  hunterMixer?.update(dt);
  monsterMixer?.update(dt);
  motes.rotation.y += dt * 0.012;
  motes.position.y = Math.sin(simElapsed * 0.25) * 0.5;

  if (phase === 'hunting') {
    hunt.elapsed += dt;
    updatePlayer(dt);
    updateMonster(dt);
    resolveMonsterCollision();
    updateBladeTrail(dt);
    updateSeveredTail(dt);
    particleSystem.update(dt);
    if (hintsCollapseTimer > 0) {
      hintsCollapseTimer -= rawDt;
      if (hintsCollapseTimer <= 0) hud.setHintsCollapsed(true);
    }
    if (phase === 'hunting' && hunt.elapsed >= QUEST_TIME_LIMIT_SECONDS) {
      finishHunt(false, 'timeout');
    }
  } else if (phase === 'finishing') {
    updatePlayer(dt);
    updateMonster(dt);
    updateBladeTrail(dt);
    updateSeveredTail(dt);
    particleSystem.update(dt);
    finishTimer -= rawDt;
    if (finishTimer <= 0) presentResult();
  } else if (phase === 'intro') {
    animateHunterVisual(dt, false);
    animateMonsterVisual();
    introTimer -= rawDt;
    if (introTimer <= 0) setPhase('hunting');
  } else if (phase === 'title') {
    animateHunterVisual(dt, false);
    animateMonsterVisual();
  }

  updateCamera(rawDt);
  if (phase === 'hunting' || phase === 'intro' || phase === 'finishing') renderHud();
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  world.applyGraphicsQuality();
  needsStaticRender = true;
});

if (!assetLoader) {
  showRuntimeError('模型載入器未能載入，將以簡易模型進行遊戲。');
  onAssetsReady();
}

animate();
