import { closestPointOnSegment2DInto } from './game-rules.mjs';

/* ==============================================================
   遊戲常數、裝備數值與純 2D 空間幾何工具（不依賴 Three.js）
   ============================================================== */

export const GAME = Object.freeze({
  questName: '蒼林的棘冠',
  monsterName: '棘冠甲獸'
});

// 獵場是一塊被巨石與樹木環繞的林間空地；可活動範圍以圓形邊界表示。
export const ARENA = Object.freeze({
  centerX: 0,
  centerZ: 5,
  radius: 24,
  monsterRadius: 19.5,
  cameraRadius: 38,
  clearingRadius: 15.5,
  viewRange: 43
});

export const ASSET_VERSION = 'jpeg-textures-20261114-1';
export const assetUrl = (name) => `${new URL(`../assets/models/${name}.glb`, import.meta.url).href}?v=${ASSET_VERSION}`;

// 伺服器未提供 Content-Length 時，用檔案的概略大小估算載入進度。
export const ASSET_METADATA = Object.freeze({
  hunter: Object.freeze({ label: '獵人', bytes: 836000 }),
  monster: Object.freeze({ label: GAME.monsterName, bytes: 643000 }),
  hunting_ground: Object.freeze({ label: '獵場', bytes: 1560000 })
});

export const DODGE_COST = 22;
export const POTION_HEAL = 45;
export const FOCUS_DURATION = 6; // 精準迴避後的會心狀態持續秒數

export const WEAPON_PROFILES = Object.freeze({
  greatsword: Object.freeze({
    label: '大劍',
    lightCost: 12,
    chargeCost: 30,
    lightDuration: 0.48,
    heavyDuration: 0.65,
    lightDamageMin: 32,
    lightDamageMax: 44,
    heavyDamageMin: 85,
    heavyDamageMax: 110,
    // 揮擊判定：以獵人前方 strikeOffset 處為圓心、strikeRadius 為半徑
    strikeOffset: 2.6,
    strikeRadius: 2.3,
    lunge: 2.4
  }),
  dualblades: Object.freeze({
    label: '雙劍',
    lightCost: 8,
    chargeCost: 18,
    lightDuration: 0.3,
    heavyDuration: 0.52,
    lightDamageMin: 18,
    lightDamageMax: 26,
    heavyDamageMin: 52,
    heavyDamageMax: 68,
    strikeOffset: 2.0,
    strikeRadius: 1.8,
    lunge: 3.2
  })
});

// 魔物身體以「尾端 → 頭端」的脊椎線段近似；數值為模型局部 Z 座標與各部位半徑。
export const MONSTER_BODY = Object.freeze({
  headZ: 6.3,
  tailZ: -9.7,
  severedTailZ: -5.6,
  headFromZ: 2.9,
  tailUntilZ: -3.4,
  radii: Object.freeze({ head: 1.7, body: 2.3, tail: 1.05 }),
  collisionRadii: Object.freeze({ head: 1.35, body: 2.0, tail: 0.6 })
});

// 獵場內無法穿越的障礙：遠古骨骸與兩根倒木（座標已含獵場位移）。
export const STATIC_OBSTACLES = Object.freeze([
  Object.freeze({ ax: -17, az: -10.6, bx: -17, bz: -4.6, radius: 2.5 }),
  Object.freeze({ ax: -17.4, az: -3, bx: -10.6, bz: -3, radius: 0.95 }),
  Object.freeze({ ax: 13.2, az: 9, bx: 18.8, bz: 9, radius: 1.0 })
]);

export const BOSS_STATUS = Object.freeze({
  roar: Object.freeze(['enraged', '咆哮']),
  telegraph_charge: Object.freeze(['alert', '突進']),
  telegraph_spin: Object.freeze(['alert', '甩尾']),
  cooldown: Object.freeze(['opening', '破綻']),
  stagger: Object.freeze(['down', '倒地'])
});

export function lerpAngle(current, target, alpha) {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * alpha;
}

export function clampToArena(position, radius) {
  const dx = position.x - ARENA.centerX;
  const dz = position.z - ARENA.centerZ;
  const distance = Math.hypot(dx, dz);
  if (distance <= radius) return false;
  position.x = ARENA.centerX + (dx / distance) * radius;
  position.z = ARENA.centerZ + (dz / distance) * radius;
  return true;
}

const obstacleClosest = { t: 0, x: 0, z: 0, distance: 0 };

export function resolveStaticCollisions(position, bodyRadius, obstacles = STATIC_OBSTACLES) {
  for (const obstacle of obstacles) {
    const closest = closestPointOnSegment2DInto(
      position.x,
      position.z,
      obstacle.ax,
      obstacle.az,
      obstacle.bx,
      obstacle.bz,
      obstacleClosest
    );
    const minDistance = obstacle.radius + bodyRadius;
    if (closest.distance >= minDistance) continue;
    let normalX = position.x - closest.x;
    let normalZ = position.z - closest.z;
    const length = Math.hypot(normalX, normalZ);
    if (length < 1e-4) {
      normalX = 0;
      normalZ = 1;
    } else {
      normalX /= length;
      normalZ /= length;
    }
    position.x = closest.x + normalX * minDistance;
    position.z = closest.z + normalZ * minDistance;
  }
}
