import { closestPointOnSegment2DInto } from './game-rules.mjs';
import { ARENA } from './constants.mjs';
import { batchMeshes } from './mesh-batching.mjs';

/* ==============================================================
   3D 場景、燈光、遠景環境、遮蔽淡出與畫質／WebGL Context 管理
   ============================================================== */

export const STATIC_BATCH = 'static';
const OCCLUDER_NAME = /^(tree_trunk|tree_canopy|boulder_moss|boulder)_(\d+)/;

/** 樹（樹幹＋樹冠）與巨石（石頭＋青苔）各自是一組遮蔽物，例如 tree_3、boulder_11；其他物件回傳 null。 */
export function occluderKeyOf(name) {
  const match = OCCLUDER_NAME.exec(name);
  return match ? `${match[1].startsWith('tree') ? 'tree' : 'boulder'}_${match[2]}` : null;
}

/** 釋放物件樹底下的幾何與材質資源（可用 exclude 跳過仍需保留的節點）。 */
export function disposeObject3D(root, { exclude = null } = {}) {
  if (!root) return;
  const geometries = new Set();
  const materials = new Set();
  root.traverse((child) => {
    if (exclude && exclude.has(child)) return;
    if (child.geometry) geometries.add(child.geometry);
    if (child.material) {
      const list = Array.isArray(child.material) ? child.material : [child.material];
      list.forEach((material) => {
        if (material) materials.add(material);
      });
    }
  });
  geometries.forEach((geometry) => geometry.dispose?.());
  materials.forEach((material) => material.dispose?.());
}

export function createWorldScene({ THREE, container, settings, onContextLost, onContextRestored }) {
  const scene = new THREE.Scene();

  // 天空與霧共用同一組線性色彩：遠景會自然溶進地平線的霧氣裡。
  const atmosphere = {
    zenith: new THREE.Color(0x2f5f8f),
    horizon: new THREE.Color(0x9fb0a0),
    sun: new THREE.Color(0xffe2b0),
    sunDirection: new THREE.Vector3(0.52, 0.62, 0.42).normalize()
  };
  scene.background = atmosphere.horizon.clone();
  scene.fog = new THREE.Fog(atmosphere.horizon.clone(), 34, 150);

  const camera = new THREE.PerspectiveCamera(56, window.innerWidth / window.innerHeight, 0.1, 600);
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  let contextLost = false;
  renderer.domElement.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    contextLost = true;
    onContextLost?.(event);
  });
  renderer.domElement.addEventListener('webglcontextrestored', (event) => {
    contextLost = false;
    onContextRestored?.(event);
  });

  const skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(420, 32, 18),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        zenith: { value: atmosphere.zenith },
        horizon: { value: atmosphere.horizon },
        sunColor: { value: atmosphere.sun },
        sunDirection: { value: atmosphere.sunDirection }
      },
      vertexShader: `
        varying vec3 vDirection;
        void main() {
          vDirection = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 zenith;
        uniform vec3 horizon;
        uniform vec3 sunColor;
        uniform vec3 sunDirection;
        varying vec3 vDirection;
        void main() {
          vec3 direction = normalize(vDirection);
          float height = clamp(direction.y, 0.0, 1.0);
          vec3 color = mix(horizon, zenith, pow(smoothstep(0.0, 0.9, height), 0.55));
          float sunAmount = max(dot(direction, normalize(sunDirection)), 0.0);
          color += sunColor * (pow(sunAmount, 600.0) * 2.4 + pow(sunAmount, 10.0) * 0.26);
          gl_FragColor = vec4(color, 1.0);
          #include <tonemapping_fragment>
          #include <encodings_fragment>
        }
      `
    })
  );
  skyDome.frustumCulled = false;
  scene.add(skyDome);

  const ambientLight = new THREE.AmbientLight(0xdfe6e9, 0.16);
  scene.add(ambientLight);
  const hemisphereLight = new THREE.HemisphereLight(0xb7cfe6, 0x4a452c, 0.82);
  scene.add(hemisphereLight);

  const sunLight = new THREE.DirectionalLight(0xffe6c2, 1.55);
  sunLight.position.copy(atmosphere.sunDirection).multiplyScalar(90).add(new THREE.Vector3(ARENA.centerX, 0, ARENA.centerZ));
  sunLight.target.position.set(ARENA.centerX, 0, ARENA.centerZ);
  scene.add(sunLight.target);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.near = 10;
  sunLight.shadow.camera.far = 200;
  const shadowDist = 44;
  sunLight.shadow.camera.left = -shadowDist;
  sunLight.shadow.camera.right = shadowDist;
  sunLight.shadow.camera.top = shadowDist;
  sunLight.shadow.camera.bottom = -shadowDist;
  sunLight.shadow.bias = -0.0004;
  sunLight.shadow.normalBias = 0.04;
  scene.add(sunLight);

  const rimLight = new THREE.DirectionalLight(0x8fb4cf, 0.3);
  rimLight.position.set(-40, 22, -55);
  scene.add(rimLight);

  // 遠景：環繞獵場的針葉林帶與霧中的山稜，讓空地有被森林包圍的尺度感。
  const backdrop = new THREE.Group();
  scene.add(backdrop);
  {
    let seed = 20261110;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    const treeCount = 132;
    const trunkMesh = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.32, 0.5, 1, 6),
      new THREE.MeshStandardMaterial({ color: 0x241a12, roughness: 1 }),
      treeCount
    );
    const crownMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
    const crownGeometry = new THREE.ConeGeometry(1, 1, 7);
    const lowerCrowns = new THREE.InstancedMesh(crownGeometry, crownMaterial, treeCount);
    const upperCrowns = new THREE.InstancedMesh(crownGeometry, crownMaterial, treeCount);
    // 實體矩陣分布於遠景圓環，停用預設原點視錐剔除以防轉頭時整圈樹消失。
    trunkMesh.frustumCulled = false;
    lowerCrowns.frustumCulled = false;
    upperCrowns.frustumCulled = false;

    const dummy = new THREE.Object3D();
    const tint = new THREE.Color();
    for (let index = 0; index < treeCount; index++) {
      const angle = (index / treeCount) * Math.PI * 2 + random() * 0.06;
      const distance = 45 + random() * 34;
      const height = 10 + random() * 10 + (distance - 45) * 0.12;
      const x = ARENA.centerX + Math.cos(angle) * distance;
      const z = ARENA.centerZ + Math.sin(angle) * distance;
      dummy.rotation.set(0, random() * Math.PI, 0);
      dummy.position.set(x, height * 0.2, z);
      dummy.scale.set(1 + height * 0.03, height * 0.42, 1 + height * 0.03);
      dummy.updateMatrix();
      trunkMesh.setMatrixAt(index, dummy.matrix);
      dummy.position.set(x, height * 0.5, z);
      dummy.scale.set(height * 0.27, height * 0.58, height * 0.27);
      dummy.updateMatrix();
      lowerCrowns.setMatrixAt(index, dummy.matrix);
      dummy.position.set(x, height * 0.76, z);
      dummy.scale.set(height * 0.19, height * 0.5, height * 0.19);
      dummy.updateMatrix();
      upperCrowns.setMatrixAt(index, dummy.matrix);
      tint.setRGB(0.035 + random() * 0.02, 0.085 + random() * 0.05, 0.045 + random() * 0.02);
      lowerCrowns.setColorAt(index, tint);
      upperCrowns.setColorAt(index, tint.multiplyScalar(1.18));
    }
    backdrop.add(trunkMesh, lowerCrowns, upperCrowns);

    const ridgeMaterial = new THREE.MeshStandardMaterial({ color: 0x1f3327, roughness: 1, flatShading: true });
    for (let index = 0; index < 11; index++) {
      const angle = (index / 11) * Math.PI * 2 + random() * 0.4;
      const distance = 118 + random() * 46;
      const radius = 42 + random() * 34;
      const height = 26 + random() * 38;
      const ridge = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 6, 1), ridgeMaterial);
      ridge.position.set(ARENA.centerX + Math.cos(angle) * distance, height * 0.5 - 2, ARENA.centerZ + Math.sin(angle) * distance);
      ridge.rotation.y = random() * Math.PI;
      backdrop.add(ridge);
    }
    // 山稜共用同一個材質又不會動，接成一個網格
    batchMeshes(THREE, backdrop, {
      groupOf: (mesh) => (mesh.isInstancedMesh ? null : { key: 'ridges', space: backdrop })
    });
  }

  // 空氣中的浮塵與花粉：被陽光照亮的細小粒子，增加景深與空氣感。
  const motes = (() => {
    const count = 150;
    const positions = new Float32Array(count * 3);
    for (let index = 0; index < count; index++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = Math.sqrt(Math.random()) * 30;
      positions[index * 3] = ARENA.centerX + Math.cos(angle) * distance;
      positions[index * 3 + 1] = 0.6 + Math.random() * 7.5;
      positions[index * 3 + 2] = ARENA.centerZ + Math.sin(angle) * distance;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({
      color: 0xfff0c4,
      size: 0.11,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      sizeAttenuation: true
    }));
    scene.add(points);
    return points;
  })();

  // 會擋住第三人稱鏡頭的外圍樹木與巨石：夾在鏡頭與獵人之間時淡出。
  const occluders = [];
  const occluderClosest = { t: 0, x: 0, z: 0, distance: 0 };

  /** batches 是 batchMeshes 的結果：同一組遮蔽物的網格要一起淡出。 */
  function registerOccluders(batches) {
    const groups = new Map();
    batches.forEach(({ key, mesh }) => {
      if (key === STATIC_BATCH) return;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(mesh);
    });
    const box = new THREE.Box3();
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    groups.forEach((meshes) => {
      box.makeEmpty();
      meshes.forEach((mesh) => box.expandByObject(mesh));
      box.getSize(size);
      box.getCenter(center);
      occluders.push({ meshes, x: center.x, z: center.z, radius: Math.max(size.x, size.z) * 0.5 + 0.9, opacity: 1 });
    });
  }

  function updateOccluders(dt, enabled, hunterPosition) {
    const cameraX = camera.position.x;
    const cameraZ = camera.position.z;
    const hunterX = hunterPosition.x;
    const hunterZ = hunterPosition.z;
    for (const occluder of occluders) {
      let target = 1;
      if (enabled) {
        const closest = closestPointOnSegment2DInto(
          occluder.x,
          occluder.z,
          cameraX,
          cameraZ,
          hunterX,
          hunterZ,
          occluderClosest
        );
        if (closest.distance < occluder.radius && closest.t < 0.94) target = 0.12;
      }
      if (occluder.opacity === target) continue;
      const step = dt * 4.5;
      occluder.opacity = occluder.opacity < target
        ? Math.min(target, occluder.opacity + step)
        : Math.max(target, occluder.opacity - step);
      const faded = occluder.opacity < 0.999;
      occluder.meshes.forEach((mesh) => {
        mesh.material.transparent = faded;
        mesh.material.opacity = occluder.opacity;
        mesh.material.depthWrite = !faded;
      });
    }
  }

  function applyGraphicsQuality() {
    const quality = settings.graphicsQuality;
    const ratioCap = quality === 'low' ? 1 : (quality === 'medium' ? 1.25 : (window.innerWidth < 900 ? 1.5 : 1.75));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, ratioCap));
    const shadowSize = quality === 'high' ? 2048 : 1024;
    const wantShadows = quality !== 'low';
    sunLight.castShadow = wantShadows;
    if (!wantShadows && sunLight.shadow.map) {
      sunLight.shadow.map.dispose();
      sunLight.shadow.map = null;
    }
    if (sunLight.shadow.mapSize.x !== shadowSize) {
      sunLight.shadow.mapSize.set(shadowSize, shadowSize);
      if (sunLight.shadow.map) {
        sunLight.shadow.map.dispose();
        sunLight.shadow.map = null;
      }
    }
    motes.visible = wantShadows;
  }
  applyGraphicsQuality();

  // 自然獵場地表：遠景基底永久保留，其餘簡易備援裝飾包在 fallbackEnvironment 內，載入正式 GLB 後整組釋放。
  const groundGeo = new THREE.PlaneGeometry(900, 900);
  const groundMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.135, 0.195, 0.118),
    roughness: 0.98,
    metalness: 0
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  ground.receiveShadow = true;
  scene.add(ground);

  let fallbackEnvironment = new THREE.Group();
  scene.add(fallbackEnvironment);

  const clearingMat = new THREE.MeshStandardMaterial({
    color: 0x34472f,
    roughness: 1.0,
    transparent: true,
    opacity: 0.3,
    depthWrite: false
  });
  const clearing = new THREE.Mesh(new THREE.CircleGeometry(31, 64), clearingMat);
  clearing.rotation.x = -Math.PI / 2;
  clearing.position.y = 0.025;
  fallbackEnvironment.add(clearing);

  const foliageGroup = new THREE.Group();
  fallbackEnvironment.add(foliageGroup);
  const grassMat = new THREE.MeshStandardMaterial({ color: 0x5f7d42, roughness: 0.95 });
  const mossMat = new THREE.MeshStandardMaterial({ color: 0x769653, roughness: 1.0 });
  for (let i = 0; i < 58; i++) {
    const angle = Math.random() * Math.PI * 2;
    const distance = 9 + Math.random() * 25;
    const height = 0.35 + Math.random() * 0.85;
    const grass = new THREE.Mesh(new THREE.ConeGeometry(0.16 + Math.random() * 0.12, height, 4), grassMat);
    grass.position.set(Math.cos(angle) * distance, height / 2, Math.sin(angle) * distance);
    grass.rotation.y = Math.random() * Math.PI;
    foliageGroup.add(grass);
  }
  for (let i = 0; i < 18; i++) {
    const angle = Math.random() * Math.PI * 2;
    const distance = 5 + Math.random() * 28;
    const patch = new THREE.Mesh(new THREE.CircleGeometry(0.5 + Math.random() * 0.7, 7), mossMat);
    patch.rotation.x = -Math.PI / 2;
    patch.position.set(Math.cos(angle) * distance, 0.035, Math.sin(angle) * distance);
    foliageGroup.add(patch);
  }

  const boneMat = new THREE.MeshStandardMaterial({ color: 0x8c7046, roughness: 0.6 });
  const boneSite = new THREE.Group();
  boneSite.position.set(-17, 0, -8);
  for (let i = 0; i < 5; i++) {
    const rib = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 3.8 + i * 0.2, 6), boneMat);
    rib.position.set((i - 2) * 0.9, 1.05 + Math.abs(i - 2) * 0.12, 0);
    rib.rotation.z = (i - 2) * 0.22;
    rib.rotation.x = Math.PI / 2;
    rib.castShadow = true;
    boneSite.add(rib);
  }
  const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(1.45, 1), boneMat);
  skull.position.set(0, 1.35, 1.8);
  skull.scale.set(1.2, 0.82, 1.45);
  skull.castShadow = true;
  boneSite.add(skull);
  fallbackEnvironment.add(boneSite);

  // 邊界巨石柱環境裝飾
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x4b5866, roughness: 0.9 });
  const boundaryRocksGroup = new THREE.Group();
  fallbackEnvironment.add(boundaryRocksGroup);
  for (let i = 0; i < 22; i++) {
    const radius = 1.6 + Math.random() * 2.2;
    const height = 4 + Math.random() * 8;
    const rock = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.6, radius, height, 7), rockMat);
    const angle = (i / 22) * Math.PI * 2;
    const dist = 55 + Math.random() * 12;
    rock.position.set(Math.cos(angle) * dist, height / 2, Math.sin(angle) * dist);
    rock.castShadow = true;
    rock.receiveShadow = true;
    boundaryRocksGroup.add(rock);
  }

  function disposeFallbackEnvironment() {
    if (!fallbackEnvironment) return;
    scene.remove(fallbackEnvironment);
    disposeObject3D(fallbackEnvironment);
    fallbackEnvironment = null;
  }

  return {
    scene,
    camera,
    renderer,
    skyDome,
    motes,
    registerOccluders,
    updateOccluders,
    applyGraphicsQuality,
    disposeFallbackEnvironment,
    isContextLost: () => contextLost
  };
}
