import { ASSET_METADATA, GAME, assetUrl } from './constants.mjs';
import { batchMeshes } from './mesh-batching.mjs';
import { STATIC_BATCH, disposeObject3D, occluderKeyOf } from './scene.mjs';

/* ==============================================================
   角色／魔物簡易備援模型、GLB 載入、剛體合批與刀光軌跡
   ============================================================== */

const OCCLUDER_BATCH_NAME = /^batch_(tree|boulder)_/i;
const NO_SHADOW_CAST_ENV = /^(terrain_ring|arena_soil_disc|grass_|fungus_|arena_pebble_|batch_static_(Forest Leaf|Forest Ember Fungus|Forest Ground|Arena Soil))/i;

const isOccluderMesh = (name) => Boolean(occluderKeyOf(name) || OCCLUDER_BATCH_NAME.test(name));

export function prepareLoadedModel(THREE, model, { monsterMaterials = null, isEnvironment = false } = {}) {
  const createRuntimeMaterial = (source) => {
    const material = (source && typeof source.clone === 'function' && source.isMeshStandardMaterial)
      ? source.clone()
      : new THREE.MeshStandardMaterial({
          color: source && source.color ? source.color.clone() : 0xffffff,
          roughness: source && Number.isFinite(source.roughness) ? source.roughness : 0.6,
          metalness: source && Number.isFinite(source.metalness) ? source.metalness : 0,
          map: source && source.map ? source.map : null,
          normalMap: source && source.normalMap ? source.normalMap : null,
          roughnessMap: source && source.roughnessMap ? source.roughnessMap : null,
          metalnessMap: source && source.metalnessMap ? source.metalnessMap : null,
          emissiveMap: source && source.emissiveMap ? source.emissiveMap : null,
          emissive: source && source.emissive ? source.emissive.clone() : new THREE.Color(0x000000),
          emissiveIntensity: source && Number.isFinite(source.emissiveIntensity) ? source.emissiveIntensity : 1,
          transparent: Boolean(source && source.transparent),
          opacity: source && Number.isFinite(source.opacity) ? source.opacity : 1,
          alphaTest: source && Number.isFinite(source.alphaTest) ? source.alphaTest : 0,
          side: source && source.side ? source.side : THREE.FrontSide
        });
    if (source && source.normalScale && material.normalScale) {
      material.normalScale.copy(source.normalScale);
    }
    material.userData = {
      ...material.userData,
      baseEmissive: material.emissive ? material.emissive.clone() : new THREE.Color(0x000000),
      baseEmissiveIntensity: Number.isFinite(material.emissiveIntensity) ? material.emissiveIntensity : 1
    };
    return material;
  };

  const replacedSources = new Set();
  const retainedMaterials = new Set();

  model.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = !(isEnvironment && NO_SHADOW_CAST_ENV.test(child.name));
    child.receiveShadow = true;
    if (!child.material) return;

    const needsIsolatedClone = !isEnvironment || isOccluderMesh(child.name);
    if (needsIsolatedClone) {
      const sources = Array.isArray(child.material) ? child.material : [child.material];
      sources.forEach((mat) => {
        if (mat) replacedSources.add(mat);
      });
      child.material = Array.isArray(child.material)
        ? child.material.map(createRuntimeMaterial)
        : createRuntimeMaterial(child.material);
    }

    const active = Array.isArray(child.material) ? child.material : [child.material];
    active.forEach((material) => {
      if (!material) return;
      retainedMaterials.add(material);
      if (monsterMaterials) monsterMaterials.add(material);
    });
  });

  // 已被複製取代且沒有其他網格共用的原始 GLTF 材質即時釋放
  replacedSources.forEach((source) => {
    if (!retainedMaterials.has(source)) source.dispose?.();
  });

  return model;
}

/**
 * 取出模型中會被程式單獨控制的節點（轉動、縮放、隱藏、換材質顏色），並記在 pinned 裡；
 * 其餘零件不會各自移動，之後交給 mergeRigidParts 合併。
 */
export function createRigPicker(model) {
  const pinned = new Set();
  const pick = (name) => {
    const node = model.getObjectByName(name);
    if (node) pinned.add(node);
    return node;
  };
  const pickSides = (prefix) => ['l', 'r'].map((side) => pick(`${prefix}_${side}`)).filter(Boolean);
  return { pinned, pick, pickSides };
}

/**
 * 合併角色模型中不會各自移動的零件：從零件往上找到最近的「會動的節點」，
 * 同一個節點底下、同材質的零件接成一個網格，仍然跟著那個節點一起動。
 */
export function mergeRigidParts(THREE, model, pinned, animations = []) {
  // GLB 內建動畫會轉動的節點也要保留
  animations.forEach((clip) => clip.tracks.forEach((track) => {
    const { nodeName } = THREE.PropertyBinding.parseTrackName(track.name);
    const node = model.getObjectByName(nodeName) || model.getObjectByProperty('uuid', nodeName);
    if (node) pinned.add(node);
  }));
  batchMeshes(THREE, model, {
    groupOf(mesh) {
      if (pinned.has(mesh)) return null;
      let space = mesh.parent;
      while (space !== model && !pinned.has(space)) space = space.parent;
      return { key: space.uuid, space };
    }
  });
}

export function createProceduralHunter(THREE, hunterGroup) {
  const root = new THREE.Group();
  root.name = 'proceduralHunter';
  hunterGroup.add(root);

  const armorMat = new THREE.MeshStandardMaterial({ color: 0x2c3e50, roughness: 0.4, metalness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.8, 0.9), armorMat);
  body.position.y = 0.9;
  body.castShadow = true;
  root.add(body);

  const helmetMat = new THREE.MeshStandardMaterial({ color: 0x7f8c8d, metalness: 0.6, roughness: 0.3 });
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.85, 0.85), helmetMat);
  head.position.y = 2.25;
  head.castShadow = true;
  root.add(head);

  // 大劍關節手部
  const weaponPivot = new THREE.Group();
  weaponPivot.position.set(0.65, 1.35, 0);
  root.add(weaponPivot);

  const swordGroup = new THREE.Group();
  const hiltMat = new THREE.MeshStandardMaterial({ color: 0x8e44ad });
  const guardMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.8, roughness: 0.2 });
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0xdfe6e9, metalness: 0.85, roughness: 0.2 });

  const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.9), hiltMat);
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.15, 0.4), guardMat);
  guard.position.y = 0.45;
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.4, 3.8, 0.14), bladeMat);
  blade.position.y = 2.35;
  blade.castShadow = true;
  swordGroup.add(hilt, guard, blade);
  swordGroup.rotation.x = Math.PI / 4.5;
  weaponPivot.add(swordGroup);

  // 簡易雙劍備援：即使 GLB 尚未就緒或載入失敗，切換雙劍仍有獨立外型與刀光。
  const dualWeaponPivot = new THREE.Group();
  dualWeaponPivot.visible = false;
  root.add(dualWeaponPivot);
  const dualBladeGeo = new THREE.BoxGeometry(0.22, 1.8, 0.08);
  const dualGripGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.55);
  const dualBlades = [];
  const dualHands = [-1, 1].map((side) => {
    const hand = new THREE.Group();
    hand.position.set(side * 0.68, 1.32, 0.12);
    const shortBlade = new THREE.Mesh(dualBladeGeo, bladeMat);
    shortBlade.position.y = 1.15;
    shortBlade.castShadow = true;
    const shortGrip = new THREE.Mesh(dualGripGeo, hiltMat);
    shortGrip.position.y = 0.1;
    hand.add(shortGrip, shortBlade);
    dualWeaponPivot.add(hand);
    dualBlades.push(shortBlade);
    return hand;
  });

  return {
    body,
    head,
    weaponPivot,
    blade,
    dualWeaponPivot,
    dualHands,
    dualBlades,
    dispose() {
      hunterGroup.remove(root);
      disposeObject3D(root);
    }
  };
}

export function createProceduralMonster(THREE, monsterGroup, monsterMaterials) {
  const root = new THREE.Group();
  root.name = 'proceduralMonster';
  monsterGroup.add(root);

  const skinMat = new THREE.MeshStandardMaterial({ color: 0x962d22, roughness: 0.55 });
  skinMat.userData = { baseEmissive: new THREE.Color(0x000000), baseEmissiveIntensity: 1 };
  monsterMaterials.add(skinMat);

  const body = new THREE.Mesh(new THREE.BoxGeometry(4.0, 3.0, 7.0), skinMat);
  body.position.y = 2.5;
  body.castShadow = true;
  root.add(body);

  const headGroup = new THREE.Group();
  headGroup.position.set(0, 3.0, 4.3);
  const headMesh = new THREE.Mesh(new THREE.BoxGeometry(2.8, 2.4, 3.0), skinMat);
  headMesh.castShadow = true;
  headGroup.add(headMesh);

  const hornMat = new THREE.MeshStandardMaterial({ color: 0xf1c40f, roughness: 0.3 });
  const hornGeo = new THREE.ConeGeometry(0.38, 2.0, 6);
  const hornLeft = new THREE.Mesh(hornGeo, hornMat);
  hornLeft.position.set(1.2, 1.2, 0.3);
  hornLeft.rotation.x = Math.PI / 3.8;
  hornLeft.castShadow = true;
  const hornRight = new THREE.Mesh(hornGeo, hornMat);
  hornRight.position.set(-1.2, 1.2, 0.3);
  hornRight.rotation.x = Math.PI / 3.8;
  hornRight.castShadow = true;
  headGroup.add(hornLeft, hornRight);
  root.add(headGroup);

  const wingMat = new THREE.MeshStandardMaterial({ color: 0xd35400, roughness: 0.7 });
  const wings = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.5, 3.0), wingMat);
  wings.position.set(0, 2.7, 1.3);
  wings.castShadow = true;
  root.add(wings);

  const tailGroup = new THREE.Group();
  tailGroup.position.set(0, 2.1, -5.5);
  const tailMesh = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.3, 5.8), skinMat);
  tailMesh.castShadow = true;
  tailGroup.add(tailMesh);
  root.add(tailGroup);

  // 怒氣眼睛紅光（會在 monster.glb 載入後改掛到正式頭部節點，不會隨簡易模型一起被釋放）
  const eyeLightL = new THREE.PointLight(0xff0000, 0, 6);
  eyeLightL.position.set(0.9, 0.4, 1.6);
  const eyeLightR = eyeLightL.clone();
  eyeLightR.position.x = -0.9;
  headGroup.add(eyeLightL, eyeLightR);

  return {
    headGroup,
    hornLeft,
    hornRight,
    tailGroup,
    eyeLightL,
    eyeLightR,
    dispose(targetHead = null) {
      if (targetHead) {
        targetHead.add(eyeLightL, eyeLightR);
      } else {
        eyeLightL.position.set(0.9, 3.4, 5.9);
        eyeLightR.position.set(-0.9, 3.4, 5.9);
        monsterGroup.add(eyeLightL, eyeLightR);
      }
      monsterMaterials.delete(skinMat);
      monsterGroup.remove(root);
      disposeObject3D(root);
    }
  };
}

export function createBladeTrail(THREE, scene, samples = 14) {
  const positions = new Float32Array(samples * 2 * 3);
  const colors = new Float32Array(samples * 2 * 3);
  const indices = [];
  for (let index = 0; index < samples - 1; index++) {
    const a = index * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false
  }));
  mesh.frustumCulled = false;
  mesh.visible = false;
  scene.add(mesh);
  return {
    mesh,
    geometry,
    positions,
    colors,
    bases: Array.from({ length: samples }, () => new THREE.Vector3()),
    tips: Array.from({ length: samples }, () => new THREE.Vector3()),
    recording: false,
    strength: 0
  };
}

export function loadVisualAssets({
  THREE,
  assetLoader,
  world,
  hunterGroup,
  monsterGroup,
  monsterMaterials,
  onProgress,
  onHunterLoaded,
  onMonsterLoaded,
  onEnvironmentLoaded,
  onAssetError,
  onAllReady
}) {
  const catalog = {
    hunter: { ...ASSET_METADATA.hunter, progress: 0 },
    monster: { ...ASSET_METADATA.monster, progress: 0 },
    hunting_ground: { ...ASSET_METADATA.hunting_ground, progress: 0 }
  };
  let pending = assetLoader ? Object.keys(catalog).length : 0;

  const computeFraction = () => {
    const entries = Object.values(catalog);
    const total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
    const loaded = entries.reduce((sum, entry) => sum + entry.bytes * entry.progress, 0);
    return loaded / total;
  };

  const reportProgress = (name) => (event) => {
    const entry = catalog[name];
    const total = event && event.lengthComputable && event.total > 0 ? event.total : entry.bytes;
    entry.progress = Math.min(0.98, Math.max(entry.progress, (event?.loaded || 0) / total));
    onProgress?.(computeFraction());
  };

  const markLoaded = (name) => {
    catalog[name].progress = 1;
    pending = Math.max(0, pending - 1);
    const status = pending > 0 ? `正在整備獵場…（${catalog[name].label}就緒）` : '獵場整備完成';
    onProgress?.(computeFraction(), status);
    if (pending === 0) onAllReady?.();
  };

  if (!assetLoader) return;

  assetLoader.load(assetUrl('hunter'), (gltf) => {
    const model = gltf.scene;
    model.name = 'hunterVisual';
    const { pinned, pick, pickSides } = createRigPicker(model);
    const chest = pick('chest');
    const head = pick('head');
    const greatswordPivot = pick('weaponPivot');
    const greatswordBlade = pick('weapon_blade');
    const dualBlades = pickSides('dual_blade');
    const dualHands = pickSides('dual_hand');
    const legs = pickSides('leg');
    const shoulders = pickSides('shoulder');
    const alternateWeaponPivot = pick('dualWeaponPivot');

    mergeRigidParts(THREE, model, pinned, gltf.animations);
    prepareLoadedModel(THREE, model);

    let mixer = null;
    if (gltf.animations && gltf.animations.length > 0) {
      mixer = new THREE.AnimationMixer(model);
      gltf.animations.forEach((clip) => {
        mixer.clipAction(clip).setLoop(THREE.LoopRepeat, Infinity).play();
      });
    }
    hunterGroup.add(model);
    onHunterLoaded({
      model,
      mixer,
      chest,
      head,
      weaponPivot: greatswordPivot,
      blade: greatswordBlade,
      dualBlades,
      dualHands,
      legs,
      shoulders,
      alternateWeaponPivot
    });
    markLoaded('hunter');
  }, reportProgress('hunter'), (error) => {
    onAssetError?.(`獵人模型載入失敗，改用簡易模型：${error && error.message ? error.message : String(error)}`, error);
    markLoaded('hunter');
  });

  assetLoader.load(assetUrl('monster'), (gltf) => {
    const model = gltf.scene;
    model.name = 'monsterVisual';
    const { pinned, pick, pickSides } = createRigPicker(model);
    const head = pick('head');
    const tail = pick('tail');
    const hornL = pick('horn_l');
    const hornR = pick('horn_r');
    const body = pick('body');
    const wings = pickSides('wing');
    const eyes = pickSides('eye');
    // 斷尾時會被切離的尾段：第三節之後的尾節、尾鰭與尾刺
    const tailEndPieces = [
      'tail_segment_2', 'tail_segment_3', 'tail_segment_4',
      'tail_fin_2_l', 'tail_fin_2_r', 'tail_fin_3_l', 'tail_fin_3_r', 'tail_spike'
    ].map((name) => pick(name)).filter(Boolean);

    mergeRigidParts(THREE, model, pinned, gltf.animations);
    prepareLoadedModel(THREE, model, { monsterMaterials });

    let mixer = null;
    if (gltf.animations && gltf.animations.length > 0) {
      mixer = new THREE.AnimationMixer(model);
      gltf.animations.forEach((clip) => {
        mixer.clipAction(clip).setLoop(THREE.LoopRepeat, Infinity).play();
      });
    }
    monsterGroup.add(model);
    onMonsterLoaded({
      model,
      mixer,
      body,
      head,
      tail,
      hornL,
      hornR,
      wings,
      eyes,
      tailEndPieces
    });
    markLoaded('monster');
  }, reportProgress('monster'), (error) => {
    onAssetError?.(`${GAME.monsterName}模型載入失敗，改用簡易模型：${error && error.message ? error.message : String(error)}`, error);
    markLoaded('monster');
  });

  assetLoader.load(assetUrl('hunting_ground'), (gltf) => {
    const model = gltf.scene;
    model.name = 'huntingGroundVisual';
    // 獵場全是靜態物件：外圍會淡出的每棵樹、每顆巨石各自一組，其餘依材質合併
    const batches = batchMeshes(THREE, model, {
      groupOf: (mesh) => ({ key: occluderKeyOf(mesh.name) ?? STATIC_BATCH, space: model })
    });
    prepareLoadedModel(THREE, model, { isEnvironment: true });
    // Blender 獵場以原點為中心；遊戲的獵人與魔物戰鬥中線位於 z=5。
    model.position.set(ARENA.centerX, 0, ARENA.centerZ);
    // 靜態場景不需要每幀重算世界矩陣
    model.updateMatrixWorld(true);
    model.traverse((child) => {
      child.matrixAutoUpdate = false;
    });
    world.registerOccluders(batches);
    world.scene.add(model);
    world.disposeFallbackEnvironment();
    onEnvironmentLoaded?.(model);
    markLoaded('hunting_ground');
  }, reportProgress('hunting_ground'), (error) => {
    onAssetError?.(`獵場模型載入失敗，改用簡易場景：${error && error.message ? error.message : String(error)}`, error);
    markLoaded('hunting_ground');
  });
}
