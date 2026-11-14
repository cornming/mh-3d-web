import assert from "node:assert/strict";
import test from "node:test";
import { batchMeshes, mergeGeometryData } from "../src/mesh-batching.mjs";

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const translation = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const scale = (x, y, z) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
/** 繞 Y 軸旋轉（欄優先，與 THREE.Matrix4.makeRotationY 相同）。 */
const rotationY = (angle) => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
};

/** XY 平面上、法線朝 +Z 的單一三角形。 */
const triangle = (matrix) => ({
  position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  uv: new Float32Array([0, 0, 1, 0, 0, 1]),
  index: new Uint16Array([0, 1, 2]),
  matrix
});

const close = (actual, expected) => {
  assert.equal(actual.length, expected.length);
  expected.forEach((value, index) => {
    assert.ok(Math.abs(actual[index] - value) < 1e-6, `[${index}] ${actual[index]} ≠ ${value}`);
  });
};

/** 用索引取出三角形的面法線（依繞行方向），用來確認正面朝向沒有被翻過去。 */
const faceNormal = (data, triangleIndex = 0) => {
  const [a, b, c] = [0, 1, 2].map((corner) => {
    const vertex = data.index[triangleIndex * 3 + corner];
    return [data.position[vertex * 3], data.position[vertex * 3 + 1], data.position[vertex * 3 + 2]];
  });
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const length = Math.hypot(...n);
  return n.map((value) => value / length);
};

test("merging concatenates vertices and offsets the indices of later parts", () => {
  const data = mergeGeometryData([triangle(IDENTITY), triangle(translation(5, 0, 2))]);
  assert.equal(data.vertexCount, 6);
  assert.equal(data.triangleCount, 2);
  assert.deepEqual(Array.from(data.index), [0, 1, 2, 3, 4, 5]);
  close(data.position, [0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 0, 2, 6, 0, 2, 5, 1, 2]);
  close(data.normal.subarray(9), [0, 0, 1, 0, 0, 1, 0, 0, 1]);
  close(data.uv, [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  assert.ok(data.index instanceof Uint16Array);
});

test("rotation turns positions and normals the same way", () => {
  // 繞 Y 轉 90°：+X 轉到 -Z，+Z 轉到 +X
  const data = mergeGeometryData([triangle(rotationY(Math.PI / 2))]);
  close(data.position, [0, 0, 0, 0, 0, -1, 0, 1, 0]);
  close(data.normal, [1, 0, 0, 1, 0, 0, 1, 0, 0]);
  close(faceNormal(data), [1, 0, 0]);
});

test("non-uniform scale keeps normals perpendicular to the surface", () => {
  // 斜面 x + z = 1，法線 (1,0,1)/√2；X 方向拉長 3 倍後，正確的法線是 (1,0,3)/√10
  const slope = {
    position: new Float32Array([1, 0, 0, 0, 0, 1, 0, 1, 1]),
    normal: new Float32Array(Array.from({ length: 3 }, () => [Math.SQRT1_2, 0, Math.SQRT1_2]).flat()),
    index: new Uint16Array([0, 2, 1]),
    matrix: scale(3, 1, 1)
  };
  const data = mergeGeometryData([slope]);
  const expected = [1 / Math.sqrt(10), 0, 3 / Math.sqrt(10)];
  close(data.normal.subarray(0, 3), expected);
  close(faceNormal(data), expected);
  assert.equal(data.uv, null);
});

test("mirrored parts flip their winding so faces keep pointing outward", () => {
  const data = mergeGeometryData([triangle(scale(-1, 1, 1))]);
  assert.deepEqual(Array.from(data.index), [0, 2, 1]);
  // 鏡射 X 之後這片三角形仍然朝 +Z，頂點法線與面法線都要一致
  close(data.normal, [0, 0, 1, 0, 0, 1, 0, 0, 1]);
  close(faceNormal(data), [0, 0, 1]);
});

test("parts without an index are treated as triangle lists", () => {
  const part = triangle(translation(0, 2, 0));
  delete part.index;
  const data = mergeGeometryData([triangle(), part]);
  assert.deepEqual(Array.from(data.index), [0, 1, 2, 3, 4, 5]);
  close(data.position.subarray(9), [0, 2, 0, 1, 2, 0, 0, 3, 0]);
});

test("optional attributes are dropped unless every part has them", () => {
  const withoutUv = triangle(IDENTITY);
  delete withoutUv.uv;
  const data = mergeGeometryData([triangle(IDENTITY), withoutUv]);
  assert.equal(data.uv, null);
  assert.equal(data.normal.length, 18);
});

test("more than 65535 vertices switches to 32-bit indices", () => {
  const big = { position: new Float32Array(65538 * 3), matrix: IDENTITY };
  const data = mergeGeometryData([big, triangle(IDENTITY)]);
  assert.ok(data.index instanceof Uint32Array);
  assert.equal(data.index[data.index.length - 1], 65538 + 2);
});

test("invalid input is rejected", () => {
  assert.throws(() => mergeGeometryData([]), RangeError);
  assert.throws(() => mergeGeometryData([{ position: new Float32Array(4) }]), RangeError);
  assert.throws(() => mergeGeometryData([{ position: new Float32Array(9), index: new Uint16Array([0, 1]) }]), RangeError);
});

/* ---------- batchMeshes：用最小的假物件模擬 Three.js 的場景樹 ---------- */

function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      for (let k = 0; k < 4; k++) out[column * 4 + row] += a[k * 4 + row] * b[column * 4 + k];
    }
  }
  return out;
}

class FakeMatrix4 {
  constructor() { this.elements = IDENTITY.slice(); }
  copy(other) { this.elements = other.elements.slice(); return this; }
  /** 測試裡的 space 只用到平移，取反向平移就是逆矩陣。 */
  invert() {
    const e = this.elements;
    this.elements = translation(-e[12], -e[13], -e[14]);
    return this;
  }
  multiplyMatrices(a, b) { this.elements = multiply(a.elements, b.elements); return this; }
}

class FakeAttribute {
  constructor(array, itemSize) {
    this.array = array;
    this.itemSize = itemSize;
    this.count = array.length / itemSize;
  }
}

class FakeGeometry {
  constructor() { this.attributes = {}; this.index = null; this.disposed = false; }
  setAttribute(name, attribute) { this.attributes[name] = attribute; return this; }
  setIndex(attribute) { this.index = attribute; return this; }
  dispose() { this.disposed = true; }
}

let nextId = 0;
class FakeObject {
  constructor(name, local = IDENTITY) {
    this.name = name;
    this.uuid = `object-${nextId++}`;
    this.local = local;
    this.children = [];
    this.parent = null;
    this.userData = {};
    this.matrixWorld = new FakeMatrix4();
  }
  add(child) { child.parent = this; this.children.push(child); return this; }
  remove(child) { this.children = this.children.filter((item) => item !== child); child.parent = null; return this; }
  updateMatrixWorld() {
    this.matrixWorld.elements = this.parent ? multiply(this.parent.matrixWorld.elements, this.local) : this.local.slice();
    this.children.forEach((child) => child.updateMatrixWorld());
  }
  traverse(callback) {
    callback(this);
    this.children.slice().forEach((child) => child.traverse(callback));
  }
}

class FakeMesh extends FakeObject {
  constructor(geometry, material, name = "", local = IDENTITY) {
    super(name, local);
    this.isMesh = true;
    this.geometry = geometry;
    this.material = material;
    this.castShadow = false;
    this.receiveShadow = false;
  }
}

const FAKE_THREE = { Matrix4: FakeMatrix4, BufferGeometry: FakeGeometry, BufferAttribute: FakeAttribute, Mesh: FakeMesh };

function triangleMesh(name, material, local) {
  const part = triangle();
  const geometry = new FakeGeometry()
    .setAttribute("position", new FakeAttribute(part.position, 3))
    .setAttribute("normal", new FakeAttribute(part.normal, 3))
    .setAttribute("uv", new FakeAttribute(part.uv, 2))
    .setIndex(new FakeAttribute(part.index, 1));
  const mesh = new FakeMesh(geometry, material, name, local);
  mesh.castShadow = true;
  return mesh;
}

test("meshes sharing a key and a material become one mesh in the space's local coordinates", () => {
  const stone = { uuid: "stone", name: "Stone" };
  const moss = { uuid: "moss", name: "Moss" };
  const root = new FakeObject("root", translation(0, 0, 5));
  const rocks = [
    triangleMesh("rock_0", stone, translation(1, 0, 0)),
    triangleMesh("rock_1", stone, translation(2, 0, 0)),
    triangleMesh("rock_2", stone, translation(3, 0, 0))
  ];
  const mossPatch = triangleMesh("moss_0", moss, translation(9, 0, 0));
  const kept = triangleMesh("pinned", stone);
  rocks.forEach((rock) => root.add(rock));
  root.add(mossPatch).add(kept);

  const results = batchMeshes(FAKE_THREE, root, {
    groupOf: (mesh) => (mesh.name === "pinned" ? null : { key: "static", space: root })
  });

  assert.equal(results.length, 2);
  const merged = results.find((result) => result.mesh.material === stone).mesh;
  assert.equal(merged.parent, root);
  assert.equal(merged.userData.batchedMeshes, 3);
  assert.equal(merged.castShadow, true);
  assert.equal(merged.geometry.attributes.position.count, 9);
  // root 自己的位移不能被烘進去：座標是相對於 root 的
  close(merged.geometry.attributes.position.array.subarray(0, 3), [1, 0, 0]);
  close(merged.geometry.attributes.position.array.subarray(18, 21), [3, 0, 0]);
  assert.deepEqual(Array.from(merged.geometry.index.array), [0, 1, 2, 3, 4, 5, 6, 7, 8]);

  // 只有一個零件的組別原封不動；groupOf 回傳 null 的零件留在原處
  assert.equal(results.find((result) => result.mesh.material === moss).mesh, mossPatch);
  assert.equal(mossPatch.parent, root);
  assert.equal(kept.parent, root);
  rocks.forEach((rock) => {
    assert.equal(rock.parent, null);
    assert.equal(rock.geometry.disposed, true);
  });
  assert.deepEqual(root.children.map((child) => child.name), ["moss_0", "pinned", merged.name]);
});

test("different keys or spaces are never merged together", () => {
  const bark = { uuid: "bark", name: "Bark" };
  const root = new FakeObject("root");
  const arm = new FakeObject("arm", translation(0, 3, 0));
  root.add(arm);
  const onRoot = [triangleMesh("a", bark), triangleMesh("b", bark)];
  const onArm = [triangleMesh("c", bark, translation(1, 0, 0)), triangleMesh("d", bark, translation(2, 0, 0))];
  onRoot.forEach((mesh) => root.add(mesh));
  onArm.forEach((mesh) => arm.add(mesh));

  const results = batchMeshes(FAKE_THREE, root, {
    groupOf: (mesh) => ({ key: mesh.parent.name, space: mesh.parent })
  });

  assert.equal(results.length, 2);
  const armBatch = results.find((result) => result.key === "arm").mesh;
  assert.equal(armBatch.parent, arm);
  // arm 的位移留在 arm 節點上，之後轉動 arm，合併後的零件會跟著動
  close(armBatch.geometry.attributes.position.array.subarray(0, 3), [1, 0, 0]);
  assert.equal(results.find((result) => result.key === "root").mesh.parent, root);
});

test("meshes with children, extra attributes or several materials are left alone", () => {
  const stone = { uuid: "stone", name: "Stone" };
  const root = new FakeObject("root");
  const parentMesh = triangleMesh("parent", stone);
  parentMesh.add(new FakeObject("child"));
  const colored = triangleMesh("colored", stone);
  colored.geometry.setAttribute("color", new FakeAttribute(new Float32Array(9), 3));
  const multi = triangleMesh("multi", [stone, stone]);
  const plain = [triangleMesh("p0", stone), triangleMesh("p1", stone)];
  [parentMesh, colored, multi, ...plain].forEach((mesh) => root.add(mesh));

  const results = batchMeshes(FAKE_THREE, root, { groupOf: () => ({ key: "static", space: root }) });

  assert.equal(results.length, 4);
  [parentMesh, colored, multi].forEach((mesh) => {
    assert.equal(mesh.parent, root);
    assert.ok(results.some((result) => result.mesh === mesh));
  });
  assert.equal(results.filter((result) => result.mesh.userData.batchedMeshes === 2).length, 1);
});
