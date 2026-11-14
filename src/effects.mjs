const THREE = window.THREE;

/* ==============================================================
   2. 粒子系統 (Particles System: 火花、刀光殘影、咆哮震波)
   ============================================================== */
export class ParticleManager {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];
    this.shockwaves = [];
    this.particlePool = [];
    this.shockwavePool = [];

    // 預設火花與震波共用幾何／材質
    this.sparkGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
    this.sparkMatYellow = new THREE.MeshBasicMaterial({ color: 0xfff200 });
    this.sparkMatRed = new THREE.MeshBasicMaterial({ color: 0xff3838 });
    this.shockwaveGeo = new THREE.RingGeometry(0.5, 1.2, 32);
  }

  spawnHitSparks(position, count = 16, isHeavy = false) {
    for (let i = 0; i < count; i++) {
      let item = this.particlePool.pop();
      if (!item) {
        item = {
          mesh: new THREE.Mesh(this.sparkGeo, this.sparkMatYellow),
          vx: 0,
          vy: 0,
          vz: 0,
          life: 0,
          maxLife: 0.5
        };
      }
      const mesh = item.mesh;
      mesh.material = isHeavy ? this.sparkMatRed : this.sparkMatYellow;
      mesh.visible = true;
      mesh.position.copy(position);
      mesh.scale.setScalar(1);
      this.scene.add(mesh);

      const speed = (isHeavy ? 14 : 9) * (0.6 + Math.random() * 0.8);
      const theta = Math.random() * Math.PI * 2;
      const phi = (Math.random() - 0.2) * Math.PI;
      const cosPhi = Math.cos(phi);

      item.vx = Math.cos(theta) * cosPhi * speed;
      item.vy = Math.sin(phi) * speed + 3.0;
      item.vz = Math.sin(theta) * cosPhi * speed;
      item.life = 0.35 + Math.random() * 0.2;
      item.maxLife = 0.5;
      this.particles.push(item);
    }
  }

  spawnShockwave(position, maxRadius = 22, color = 0xffffff) {
    let item = this.shockwavePool.pop();
    if (!item) {
      const material = new THREE.MeshBasicMaterial({
        color,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85,
        depthWrite: false
      });
      const mesh = new THREE.Mesh(this.shockwaveGeo, material);
      mesh.rotation.x = -Math.PI / 2;
      item = { mesh, radius: 0.5, maxRadius, opacity: 0.85 };
    } else {
      item.mesh.material.color.setHex(color);
      item.mesh.material.opacity = 0.85;
      item.mesh.visible = true;
      item.radius = 0.5;
      item.maxRadius = maxRadius;
      item.opacity = 0.85;
    }
    const { mesh } = item;
    mesh.position.copy(position);
    mesh.position.y = 0.2;
    mesh.scale.setScalar(0.5);
    this.scene.add(mesh);
    this.shockwaves.push(item);
  }

  update(dt) {
    // 更新火花
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        p.mesh.visible = false;
        this.particlePool.push(p);
        this.particles.splice(i, 1);
        continue;
      }
      p.vy -= 25 * dt; // 重力
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      const scale = Math.max(0.01, p.life / p.maxLife);
      p.mesh.scale.setScalar(scale);
    }

    // 更新咆哮衝擊波
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.radius += 36 * dt;
      sw.opacity -= 1.4 * dt;
      if (sw.opacity <= 0 || sw.radius >= sw.maxRadius) {
        this.scene.remove(sw.mesh);
        sw.mesh.visible = false;
        this.shockwavePool.push(sw);
        this.shockwaves.splice(i, 1);
        continue;
      }
      sw.mesh.scale.setScalar(sw.radius);
      sw.mesh.material.opacity = Math.max(0, sw.opacity);
    }
  }
}
