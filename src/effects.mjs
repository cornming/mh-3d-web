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

    // 預設火花材質
    this.sparkGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
    this.sparkMatYellow = new THREE.MeshBasicMaterial({ color: 0xfff200 });
    this.sparkMatRed = new THREE.MeshBasicMaterial({ color: 0xff3838 });
  }

  spawnHitSparks(position, count = 16, isHeavy = false) {
    for (let i = 0; i < count; i++) {
      const mesh = this.particlePool.pop() || new THREE.Mesh(this.sparkGeo, this.sparkMatYellow);
      mesh.material = isHeavy ? this.sparkMatRed : this.sparkMatYellow;
      mesh.visible = true;
      mesh.position.copy(position);
      this.scene.add(mesh);

      const speed = (isHeavy ? 14 : 9) * (0.6 + Math.random() * 0.8);
      const theta = Math.random() * Math.PI * 2;
      const phi = (Math.random() - 0.2) * Math.PI;

      const velocity = new THREE.Vector3(
        Math.cos(theta) * Math.cos(phi) * speed,
        Math.sin(phi) * speed + 3.0,
        Math.sin(theta) * Math.cos(phi) * speed
      );

      this.particles.push({
        mesh,
        vel: velocity,
        life: 0.35 + Math.random() * 0.2,
        maxLife: 0.5
      });
    }
  }

  spawnShockwave(position, maxRadius = 22, color = 0xffffff) {
    const ringGeo = new THREE.RingGeometry(0.5, 1.2, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85
    });
    const mesh = new THREE.Mesh(ringGeo, ringMat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(position);
    mesh.position.y = 0.2;
    this.scene.add(mesh);

    this.shockwaves.push({
      mesh,
      radius: 0.5,
      maxRadius,
      opacity: 0.85
    });
  }

  update(dt) {
    // 更新火花
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        p.mesh.visible = false;
        this.particlePool.push(p.mesh);
        this.particles.splice(i, 1);
        continue;
      }
      p.vel.y -= 25 * dt; // 重力
      p.mesh.position.addScaledVector(p.vel, dt);
      const scale = Math.max(0.01, p.life / p.maxLife);
      p.mesh.scale.set(scale, scale, scale);
    }

    // 更新咆哮衝擊波
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.radius += 36 * dt;
      sw.opacity -= 1.4 * dt;
      if (sw.opacity <= 0 || sw.radius >= sw.maxRadius) {
        this.scene.remove(sw.mesh);
        sw.mesh.geometry.dispose();
        sw.mesh.material.dispose();
        this.shockwaves.splice(i, 1);
        continue;
      }
      sw.mesh.scale.set(sw.radius, sw.radius, sw.radius);
      sw.mesh.material.opacity = Math.max(0, sw.opacity);
    }
  }
}
