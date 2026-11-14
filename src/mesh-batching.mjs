/* ==============================================================
   靜態網格合併（static batching）

   Blender 匯出的模型由很多小零件組成，每個零件都是一次 draw call
   （開陰影時還要再畫一次）。彼此之間不會相對移動、又共用同一個材質的
   零件，可以在載入時接成一個網格，畫面完全一樣，draw call 少很多。

   mergeGeometryData 只處理 TypedArray，不依賴 Three.js，可以用 Node 測試；
   batchMeshes 才會用到 Three.js（由呼叫端傳入，這個模組本身不讀 window）。
   ============================================================== */

const UINT16_MAX_VERTICES = 65535;

/**
 * 把多份頂點資料各自套上變換矩陣後，接成一份。
 *
 * parts 的每一項：
 *   position  Float32Array（xyz，必填）
 *   normal    Float32Array（xyz，選填）
 *   uv        Float32Array（uv，選填）
 *   index     三角形索引（選填；沒有時視為每三個頂點一個三角形）
 *   matrix    長度 16 的陣列，欄優先（與 THREE.Matrix4.elements 相同）；省略代表不變換
 *
 * normal／uv 只有在「每一份都有」時才會輸出，否則為 null。
 * 帶有鏡射（行列式為負）的矩陣會把三角形的繞行方向反過來，維持正面朝外。
 */
export function mergeGeometryData(parts) {
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new RangeError('mergeGeometryData needs at least one part');
  }

  let vertexCount = 0;
  let indexCount = 0;
  let hasNormal = true;
  let hasUv = true;
  for (const part of parts) {
    const count = part.position.length / 3;
    if (!Number.isInteger(count)) throw new RangeError('position length must be a multiple of 3');
    if (part.normal && part.normal.length !== count * 3) throw new RangeError('normal count does not match position');
    if (part.uv && part.uv.length !== count * 2) throw new RangeError('uv count does not match position');
    const partIndexCount = part.index ? part.index.length : count;
    if (partIndexCount % 3 !== 0) throw new RangeError('index count must be a multiple of 3');
    vertexCount += count;
    indexCount += partIndexCount;
    hasNormal = hasNormal && Boolean(part.normal);
    hasUv = hasUv && Boolean(part.uv);
  }

  const position = new Float32Array(vertexCount * 3);
  const normal = hasNormal ? new Float32Array(vertexCount * 3) : null;
  const uv = hasUv ? new Float32Array(vertexCount * 2) : null;
  const index = vertexCount > UINT16_MAX_VERTICES ? new Uint32Array(indexCount) : new Uint16Array(indexCount);

  let vertexOffset = 0;
  let indexOffset = 0;
  for (const part of parts) {
    const count = part.position.length / 3;
    const m = part.matrix;
    let flipped = false;

    if (!m) {
      position.set(part.position, vertexOffset * 3);
      if (normal) normal.set(part.normal, vertexOffset * 3);
    } else {
      // 位置：完整的仿射變換
      for (let i = 0; i < count; i++) {
        const x = part.position[i * 3];
        const y = part.position[i * 3 + 1];
        const z = part.position[i * 3 + 2];
        const o = (vertexOffset + i) * 3;
        position[o] = m[0] * x + m[4] * y + m[8] * z + m[12];
        position[o + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        position[o + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      }

      // 法線：乘上左上 3×3 的餘因子矩陣（等於逆轉置矩陣乘上行列式），
      // 非等比縮放時方向才會正確；最後重新正規化。cRC 是第 R 列第 C 行的餘因子。
      const c00 = m[5] * m[10] - m[9] * m[6];
      const c01 = m[9] * m[2] - m[1] * m[10];
      const c02 = m[1] * m[6] - m[5] * m[2];
      const c10 = m[8] * m[6] - m[4] * m[10];
      const c11 = m[0] * m[10] - m[8] * m[2];
      const c12 = m[4] * m[2] - m[0] * m[6];
      const c20 = m[4] * m[9] - m[8] * m[5];
      const c21 = m[8] * m[1] - m[0] * m[9];
      const c22 = m[0] * m[5] - m[4] * m[1];
      const determinant = m[0] * c00 + m[4] * c01 + m[8] * c02;
      flipped = determinant < 0;
      if (normal) {
        const sign = flipped ? -1 : 1;
        for (let i = 0; i < count; i++) {
          const x = part.normal[i * 3];
          const y = part.normal[i * 3 + 1];
          const z = part.normal[i * 3 + 2];
          const nx = (c00 * x + c01 * y + c02 * z) * sign;
          const ny = (c10 * x + c11 * y + c12 * z) * sign;
          const nz = (c20 * x + c21 * y + c22 * z) * sign;
          const length = Math.hypot(nx, ny, nz) || 1;
          const o = (vertexOffset + i) * 3;
          normal[o] = nx / length;
          normal[o + 1] = ny / length;
          normal[o + 2] = nz / length;
        }
      }
    }
    if (uv) uv.set(part.uv, vertexOffset * 2);

    const partIndexCount = part.index ? part.index.length : count;
    for (let i = 0; i < partIndexCount; i += 3) {
      const a = part.index ? part.index[i] : i;
      const b = part.index ? part.index[i + 1] : i + 1;
      const c = part.index ? part.index[i + 2] : i + 2;
      index[indexOffset + i] = vertexOffset + a;
      index[indexOffset + i + 1] = vertexOffset + (flipped ? c : b);
      index[indexOffset + i + 2] = vertexOffset + (flipped ? b : c);
    }

    vertexOffset += count;
    indexOffset += partIndexCount;
  }

  return { position, normal, uv, index, vertexCount, triangleCount: indexCount / 3 };
}

const MERGEABLE_ATTRIBUTES = new Set(['position', 'normal', 'uv']);

/** 只有單一材質、沒有子物件、只帶位置／法線／UV 的一般網格才能合併。 */
function isMergeable(mesh) {
  if (mesh.isSkinnedMesh || mesh.isInstancedMesh) return false;
  if (!mesh.material || Array.isArray(mesh.material)) return false;
  if (mesh.children.length > 0) return false;
  const geometry = mesh.geometry;
  if (!geometry || !geometry.attributes || !geometry.attributes.position) return false;
  if (geometry.morphAttributes && Object.keys(geometry.morphAttributes).length > 0) return false;
  return Object.keys(geometry.attributes).every((name) => MERGEABLE_ATTRIBUTES.has(name));
}

/** 把 BufferAttribute 攤平成連續的 Float32Array（交錯儲存或正規化的屬性也適用）。 */
function flatten(attribute, itemSize) {
  if (!attribute) return null;
  if (!attribute.isInterleavedBufferAttribute && !attribute.normalized
      && attribute.itemSize === itemSize && attribute.array.length === attribute.count * itemSize) {
    return attribute.array;
  }
  const out = new Float32Array(attribute.count * itemSize);
  for (let i = 0; i < attribute.count; i++) {
    out[i * itemSize] = attribute.getX(i);
    out[i * itemSize + 1] = attribute.getY(i);
    if (itemSize > 2) out[i * itemSize + 2] = attribute.getZ(i);
  }
  return out;
}

/**
 * 合併 root 底下的網格。
 *
 * groupOf(mesh) 決定每個網格的去向：
 *   - 回傳 null：不處理（例如會被程式單獨控制的零件）。
 *   - 回傳 { key, space }：key 相同、材質也相同的網格會接成一個，掛在 space 底下，
 *     頂點烘成 space 的局部座標。space 必須是這些網格的祖先（或 root 本身），
 *     而且網格相對於 space 不會再移動。
 *
 * 回傳 [{ key, mesh }]：每一組最後留下的網格（合併後的，或原本就只有一個而沒動的）。
 */
export function batchMeshes(THREE, root, { groupOf }) {
  root.updateMatrixWorld(true);

  const groups = new Map();
  const results = [];
  root.traverse((child) => {
    if (!child.isMesh) return;
    const target = groupOf(child);
    if (!target) return;
    if (!isMergeable(child)) {
      results.push({ key: target.key, mesh: child });
      return;
    }
    const groupKey = `${target.key}|${target.space.uuid}|${child.material.uuid}`;
    let group = groups.get(groupKey);
    if (!group) {
      group = { key: target.key, space: target.space, meshes: [] };
      groups.set(groupKey, group);
    }
    group.meshes.push(child);
  });

  const inverse = new THREE.Matrix4();
  groups.forEach((group) => {
    const { key, space, meshes } = group;
    if (meshes.length === 1) {
      results.push({ key, mesh: meshes[0] });
      return;
    }

    inverse.copy(space.matrixWorld).invert();
    const data = mergeGeometryData(meshes.map((mesh) => ({
      position: flatten(mesh.geometry.attributes.position, 3),
      normal: flatten(mesh.geometry.attributes.normal, 3),
      uv: flatten(mesh.geometry.attributes.uv, 2),
      index: mesh.geometry.index ? mesh.geometry.index.array : null,
      matrix: new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld).elements
    })));

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.position, 3));
    if (data.normal) geometry.setAttribute('normal', new THREE.BufferAttribute(data.normal, 3));
    if (data.uv) geometry.setAttribute('uv', new THREE.BufferAttribute(data.uv, 2));
    geometry.setIndex(new THREE.BufferAttribute(data.index, 1));

    const merged = new THREE.Mesh(geometry, meshes[0].material);
    merged.name = `batch_${key}_${meshes[0].material.name || meshes[0].name}`;
    merged.castShadow = meshes.some((mesh) => mesh.castShadow);
    merged.receiveShadow = meshes.some((mesh) => mesh.receiveShadow);
    merged.userData.batchedMeshes = meshes.length;
    space.add(merged);

    meshes.forEach((mesh) => {
      mesh.parent.remove(mesh);
      mesh.geometry.dispose();
    });
    results.push({ key, mesh: merged });
  });

  return results;
}
