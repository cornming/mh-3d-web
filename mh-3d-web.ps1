# 1. 在桌面建立遊戲資料夾
$projectDir = "$HOME\Desktop\mh-3d-web"
New-Item -ItemType Directory -Force -Path $projectDir | Out-Null
$htmlPath = "C:\Users\vincent\source\ideas\mh-3d-web\index.html"

# 2. 寫入完整 3D 魔物獵人 HTML 程式碼 (使用單引號 Here-String 防止變數解析衝突)
$htmlContent = @'
<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <title>3D 魔物獵人 Web 原型 (Monster Hunter 3D)</title>
  <style>
    body {
      margin: 0;
      overflow: hidden;
      background-color: #111;
      font-family: 'Segoe UI', 'Microsoft JhengHei', sans-serif;
      user-select: none;
    }
    #hud {
      position: absolute;
      top: 20px;
      left: 20px;
      right: 20px;
      pointer-events: none;
      display: flex;
      justify-content: space-between;
    }
    .status-panel {
      background: rgba(0, 0, 0, 0.65);
      padding: 15px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #fff;
      min-width: 280px;
    }
    .bar-label {
      font-size: 13px;
      margin-bottom: 4px;
      display: flex;
      justify-content: space-between;
      font-weight: bold;
    }
    .bar-bg {
      width: 100%;
      height: 16px;
      background: #333;
      border-radius: 4px;
      overflow: hidden;
      margin-bottom: 10px;
      border: 1px solid #000;
    }
    #hp-bar {
      width: 100%;
      height: 100%;
      background: linear-gradient(90deg, #2ecc71, #27ae60);
      transition: width 0.15s;
    }
    #stamina-bar {
      width: 100%;
      height: 100%;
      background: linear-gradient(90deg, #f1c40f, #f39c12);
      transition: width 0.05s;
    }
    #boss-hp-bar {
      width: 100%;
      height: 100%;
      background: linear-gradient(90deg, #e74c3c, #c0392b);
      transition: width 0.15s;
    }
    #controls-hint {
      position: absolute;
      bottom: 20px;
      left: 20px;
      background: rgba(0, 0, 0, 0.65);
      color: #eee;
      padding: 12px 18px;
      border-radius: 8px;
      font-size: 14px;
      line-height: 1.7;
      border: 1px solid rgba(255, 255, 255, 0.15);
      pointer-events: none;
    }
    #message-overlay {
      position: absolute;
      top: 40%;
      left: 50%;
      transform: translate(-50%, -50%);
      color: #fff;
      font-size: 48px;
      font-weight: bold;
      text-shadow: 0 4px 15px rgba(0,0,0,0.9);
      display: none;
      text-align: center;
    }
    .sub-msg {
      font-size: 20px;
      margin-top: 12px;
      color: #f1c40f;
      cursor: pointer;
      pointer-events: auto;
      background: rgba(0,0,0,0.8);
      padding: 8px 20px;
      border-radius: 6px;
      border: 1px solid #f1c40f;
      display: inline-block;
    }
    .damage-number {
      position: absolute;
      color: #ffeb3b;
      font-weight: bold;
      font-size: 24px;
      text-shadow: 2px 2px 4px #000;
      pointer-events: none;
      animation: floatUp 0.8s ease-out forwards;
    }
    @keyframes floatUp {
      0% { opacity: 1; transform: translateY(0) scale(1.2); }
      100% { opacity: 0; transform: translateY(-40px) scale(0.9); }
    }
  </style>
</head>
<body>

  <!-- 遊戲 HUD -->
  <div id="hud">
    <div class="status-panel">
      <div class="bar-label"><span>獵人 HP</span><span id="hp-text">100 / 100</span></div>
      <div class="bar-bg"><div id="hp-bar"></div></div>
      <div class="bar-label"><span>耐力 Stamina</span><span id="stamina-text">100 / 100</span></div>
      <div class="bar-bg"><div id="stamina-bar"></div></div>
      <div style="font-size: 14px; color: #a3e4d7; margin-top: 6px;">
        🧪 回覆藥 (按 E): <span id="potion-count">3</span> / 3
      </div>
    </div>

    <div class="status-panel" style="min-width: 340px;">
      <div class="bar-label">
        <span id="boss-name">🔥 荒野轟龍 (Tigrex-Proto)</span>
        <span id="boss-state-text" style="color: #f39c12;">警戒中</span>
      </div>
      <div class="bar-bg" style="height: 20px;"><div id="boss-hp-bar"></div></div>
      <div style="font-size: 12px; color: #ccc;">提示：魔物全身發紅時代表即將發動猛烈攻擊，請抓準時機翻滾！</div>
    </div>
  </div>

  <!-- 操作說明 -->
  <div id="controls-hint">
    <b>🎮 獵人操作指南</b><br>
    • <b>W / A / S / D</b>：移動角色<br>
    • <b>空白鍵 (Space)</b>：翻滾閃避 (消耗耐力，附帶短暫無敵幀)<br>
    • <b>J 或 滑鼠左鍵</b>：大劍縱斬 (輕攻擊)<br>
    • <b>K</b>：真・蓄力重斬 (高傷害、高破綻)<br>
    • <b>E</b>：飲用回覆藥 (+45 HP)
  </div>

  <!-- 勝負結算畫面 -->
  <div id="message-overlay">
    <div id="main-msg">QUEST CLEAR!</div>
    <div class="sub-msg" onclick="location.reload()">點擊重新開始狩獵</div>
  </div>

  <!-- 引入 Three.js -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
  <script>
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1e272e);
    scene.fog = new THREE.FogExp2(0x1e272e, 0.012);

    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffeaa7, 0.9);
    dirLight.position.set(30, 50, 30);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 150;
    const d = 55;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    scene.add(dirLight);

    const groundGeo = new THREE.PlaneGeometry(120, 120);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x2f3640, roughness: 0.9 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const gridHelper = new THREE.GridHelper(120, 40, 0x000000, 0x353b48);
    gridHelper.position.y = 0.02;
    scene.add(gridHelper);

    const rockMat = new THREE.MeshStandardMaterial({ color: 0x57606f, roughness: 0.8 });
    for (let i = 0; i < 16; i++) {
      const radius = 1.2 + Math.random() * 1.5;
      const height = 3 + Math.random() * 6;
      const rock = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.7, radius, height, 7), rockMat);
      const angle = (i / 16) * Math.PI * 2;
      const dist = 42 + Math.random() * 10;
      rock.position.set(Math.cos(angle) * dist, height / 2, Math.sin(angle) * dist);
      rock.castShadow = true;
      rock.receiveShadow = true;
      scene.add(rock);
    }

    const hunterGroup = new THREE.Group();
    scene.add(hunterGroup);

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2980b9, roughness: 0.5 });
    const hunterBody = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.8, 0.8), bodyMat);
    hunterBody.position.y = 0.9;
    hunterBody.castShadow = true;
    hunterGroup.add(hunterBody);

    const headMat = new THREE.MeshStandardMaterial({ color: 0xf5cd79 });
    const hunterHead = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), headMat);
    hunterHead.position.y = 2.2;
    hunterHead.castShadow = true;
    hunterGroup.add(hunterHead);

    const weaponPivot = new THREE.Group();
    weaponPivot.position.set(0.6, 1.4, 0);
    hunterGroup.add(weaponPivot);

    const swordGroup = new THREE.Group();
    const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.8), new THREE.MeshStandardMaterial({ color: 0x8e44ad }));
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0xbdc3c7, metalness: 0.7, roughness: 0.3 });
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.35, 3.6, 0.12), bladeMat);
    blade.position.y = 2.0;
    blade.castShadow = true;
    swordGroup.add(hilt, blade);
    swordGroup.rotation.x = Math.PI / 5;
    weaponPivot.add(swordGroup);

    hunterGroup.position.set(0, 0, 18);

    const monsterGroup = new THREE.Group();
    scene.add(monsterGroup);

    const monsterBaseColor = 0xc0392b;
    const monsterMat = new THREE.MeshStandardMaterial({ color: monsterBaseColor, roughness: 0.6 });

    const mBody = new THREE.Mesh(new THREE.BoxGeometry(3.8, 2.8, 6.5), monsterMat);
    mBody.position.y = 2.4;
    mBody.castShadow = true;
    monsterGroup.add(mBody);

    const mHead = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.2, 2.8), monsterMat);
    mHead.position.set(0, 2.8, 4.0);
    mHead.castShadow = true;
    monsterGroup.add(mHead);

    const hornMat = new THREE.MeshStandardMaterial({ color: 0xf1c40f });
    const hornL = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.8, 6), hornMat);
    hornL.position.set(1.1, 3.8, 4.2);
    hornL.rotation.x = Math.PI / 4;
    const hornR = hornL.clone();
    hornR.position.x = -1.1;
    monsterGroup.add(hornL, hornR);

    const wingGeo = new THREE.BoxGeometry(8.5, 0.4, 2.5);
    const wingMat = new THREE.MeshStandardMaterial({ color: 0xd35400 });
    const mWings = new THREE.Mesh(wingGeo, wingMat);
    mWings.position.set(0, 2.6, 1.2);
    mWings.castShadow = true;
    monsterGroup.add(mWings);

    const mTail = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 5.5), monsterMat);
    mTail.position.set(0, 2.0, -5.2);
    mTail.castShadow = true;
    monsterGroup.add(mTail);

    monsterGroup.position.set(0, 0, -12);

    let gameOver = false;

    const player = {
      hp: 100,
      maxHp: 100,
      stamina: 100,
      maxStamina: 100,
      potions: 3,
      speed: 11,
      state: 'idle',
      timer: 0,
      invincible: 0,
      hasHitThisSwing: false
    };

    const monster = {
      hp: 600,
      maxHp: 600,
      state: 'chase',
      timer: 1.5,
      chargeDir: new THREE.Vector3(),
      hasDealtDamage: false,
      staggerBuildUp: 0
    };

    const keys = {};
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      keys[k] = true;
      if (k === ' ') triggerDodge();
      if (k === 'j') triggerAttack('light');
      if (k === 'k') triggerAttack('heavy');
      if (k === 'e') usePotion();
    });
    window.addEventListener('keyup', (e) => keys[e.key.toLowerCase()] = false);
    window.addEventListener('mousedown', (e) => {
      if (e.button === 0) triggerAttack('light');
    });

    function triggerDodge() {
      if (gameOver) return;
      if (player.state === 'idle' && player.stamina >= 25) {
        player.stamina -= 25;
        player.state = 'dodge';
        player.timer = 0.42;
        player.invincible = 0.38;
      }
    }

    function triggerAttack(type) {
      if (gameOver || player.state !== 'idle') return;
      if (type === 'light' && player.stamina >= 12) {
        player.stamina -= 12;
        player.state = 'attack_light';
        player.timer = 0.5;
        player.hasHitThisSwing = false;
      } else if (type === 'heavy' && player.stamina >= 25) {
        player.stamina -= 25;
        player.state = 'attack_heavy';
        player.timer = 0.95;
        player.hasHitThisSwing = false;
      }
    }

    function usePotion() {
      if (gameOver || player.potions <= 0 || player.hp >= player.maxHp) return;
      player.potions--;
      player.hp = Math.min(player.maxHp, player.hp + 45);
      spawnFloatingText(hunterGroup.position, "+45 HP", "#2ecc71");
      updateHUD();
    }

    function spawnFloatingText(worldPos, text, color = "#ffeb3b") {
      const pos = worldPos.clone();
      pos.y += 3.5;
      pos.project(camera);

      const x = (pos.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-(pos.y * 0.5) + 0.5) * window.innerHeight;

      const div = document.createElement('div');
      div.className = 'damage-number';
      div.style.left = `${x}px`;
      div.style.top = `${y}px`;
      div.style.color = color;
      div.innerText = text;
      document.body.appendChild(div);
      setTimeout(() => div.remove(), 800);
    }

    function updateHUD() {
      document.getElementById('hp-bar').style.width = `${(player.hp / player.maxHp) * 100}%`;
      document.getElementById('hp-text').innerText = `${Math.ceil(player.hp)} / ${player.maxHp}`;
      document.getElementById('stamina-bar').style.width = `${(player.stamina / player.maxStamina) * 100}%`;
      document.getElementById('stamina-text').innerText = `${Math.floor(player.stamina)} / ${player.maxStamina}`;
      document.getElementById('potion-count').innerText = player.potions;
      document.getElementById('boss-hp-bar').style.width = `${Math.max(0, (monster.hp / monster.maxHp) * 100)}%`;
    }

    function endGame(victory) {
      gameOver = true;
      const overlay = document.getElementById('message-overlay');
      const mainMsg = document.getElementById('main-msg');
      overlay.style.display = 'block';
      if (victory) {
        mainMsg.innerText = '🏆 QUEST CLEAR! 狩獵成功';
        mainMsg.style.color = '#f1c40f';
      } else {
        mainMsg.innerText = '💀 QUEST FAILED 力盡倒下';
        mainMsg.style.color = '#e74c3c';
      }
    }

    const clock = new THREE.Clock();

    function updatePlayer(dt) {
      if (player.invincible > 0) {
        player.invincible -= dt;
        hunterBody.material.emissive.setHex(0x3498db);
      } else {
        hunterBody.material.emissive.setHex(0x000000);
      }

      const moveVec = new THREE.Vector3();
      if (keys['w']) moveVec.z -= 1;
      if (keys['s']) moveVec.z += 1;
      if (keys['a']) moveVec.x -= 1;
      if (keys['d']) moveVec.x += 1;
      if (moveVec.lengthSq() > 0) moveVec.normalize();

      if (player.state === 'idle') {
        player.stamina = Math.min(player.maxStamina, player.stamina + 22 * dt);
        weaponPivot.rotation.set(0, 0, 0);
        hunterGroup.rotation.x = 0;
        blade.material.emissive.setHex(0x000000);

        if (moveVec.lengthSq() > 0) {
          hunterGroup.position.addScaledVector(moveVec, player.speed * dt);
          const targetAngle = Math.atan2(moveVec.x, moveVec.z);
          hunterGroup.rotation.y = targetAngle;
        }
      } 
      else if (player.state === 'dodge') {
        player.timer -= dt;
        const forward = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), hunterGroup.rotation.y);
        hunterGroup.position.addScaledVector(forward, player.speed * 1.9 * dt);
        hunterGroup.rotation.x += 15 * dt;
        if (player.timer <= 0) {
          player.state = 'idle';
          hunterGroup.rotation.x = 0;
        }
      } 
      else if (player.state === 'attack_light' || player.state === 'attack_heavy') {
        const isHeavy = player.state === 'attack_heavy';
        const totalDuration = isHeavy ? 0.95 : 0.5;
        player.timer -= dt;
        const progress = 1 - (player.timer / totalDuration);

        if (isHeavy && progress < 0.45) {
          weaponPivot.rotation.x = -Math.PI * 0.6 * (progress / 0.45);
          blade.material.emissive.setHex(0xe67e22);
        } else {
          const swingProgress = isHeavy ? (progress - 0.45) / 0.55 : progress;
          weaponPivot.rotation.x = -Math.PI * 0.6 + Math.PI * 1.45 * Math.min(1, swingProgress * 1.5);

          if (!player.hasHitThisSwing && swingProgress > 0.25 && swingProgress < 0.75) {
            const forward = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), hunterGroup.rotation.y);
            const hitCenter = hunterGroup.position.clone().addScaledVector(forward, 3.2);
            const distToBoss = hitCenter.distanceTo(monsterGroup.position);

            if (distToBoss < 5.5) {
              player.hasHitThisSwing = true;
              const dmg = isHeavy ? Math.floor(65 + Math.random() * 15) : Math.floor(25 + Math.random() * 8);
              monster.hp -= dmg;
              monster.staggerBuildUp += dmg;
              spawnFloatingText(monsterGroup.position, isHeavy ? `💥 ${dmg}!` : `${dmg}`, isHeavy ? "#ff5252" : "#ffeb3b");

              if (monster.staggerBuildUp >= 150 && monster.state !== 'stagger') {
                monster.staggerBuildUp = 0;
                monster.state = 'stagger';
                monster.timer = 2.5;
                spawnFloatingText(monsterGroup.position, "⚡ 部位破壞・硬直!", "#00d2d3");
              }

              if (monster.hp <= 0) {
                monster.hp = 0;
                endGame(true);
              }
            }
          }
        }

        if (player.timer <= 0) {
          player.state = 'idle';
          weaponPivot.rotation.x = 0;
          blade.material.emissive.setHex(0x000000);
        }
      }

      hunterGroup.position.x = Math.max(-52, Math.min(52, hunterGroup.position.x));
      hunterGroup.position.z = Math.max(-52, Math.min(52, hunterGroup.position.z));
    }

    function updateMonster(dt) {
      if (monster.hp <= 0) return;

      const bossStateLabel = document.getElementById('boss-state-text');
      const toPlayer = new THREE.Vector3().subVectors(hunterGroup.position, monsterGroup.position);
      toPlayer.y = 0;
      const dist = toPlayer.length();

      monsterMat.emissive.setHex(0x000000);
      monsterGroup.rotation.z = 0;

      if (monster.state === 'chase') {
        bossStateLabel.innerText = '追蹤獵人中';
        bossStateLabel.style.color = '#f39c12';
        monster.timer -= dt;

        if (dist > 0.1) {
          const targetAngle = Math.atan2(toPlayer.x, toPlayer.z);
          monsterGroup.rotation.y = targetAngle;
          monsterGroup.position.addScaledVector(toPlayer.normalize(), 6.8 * dt);
        }

        if (dist < 6.5 && monster.timer <= 0.4) {
          monster.state = 'telegraph_spin';
          monster.timer = 0.75;
        } else if (monster.timer <= 0) {
          monster.state = 'telegraph_charge';
          monster.timer = 0.9;
          monster.chargeDir.copy(toPlayer.normalize());
          monsterGroup.rotation.y = Math.atan2(monster.chargeDir.x, monster.chargeDir.z);
        }
      } 
      else if (monster.state === 'telegraph_charge') {
        bossStateLabel.innerText = '⚠️ 準備龍車衝撞！';
        bossStateLabel.style.color = '#ff4757';
        monster.timer -= dt;
        if (Math.floor(monster.timer * 15) % 2 === 0) {
          monsterMat.emissive.setHex(0xff0000);
        }
        monsterGroup.position.addScaledVector(monster.chargeDir, -2.5 * dt);

        if (monster.timer <= 0) {
          monster.state = 'charge';
          monster.timer = 1.15;
          monster.hasDealtDamage = false;
        }
      } 
      else if (monster.state === 'charge') {
        bossStateLabel.innerText = '🔥 暴走龍車！';
        monster.timer -= dt;
        monsterGroup.position.addScaledVector(monster.chargeDir, 26 * dt);

        if (!monster.hasDealtDamage && dist < 4.5 && player.invincible <= 0) {
          monster.hasDealtDamage = true;
          damagePlayer(28);
        }

        if (monster.timer <= 0) {
          monster.state = 'cooldown';
          monster.timer = 1.4;
        }
      } 
      else if (monster.state === 'telegraph_spin') {
        bossStateLabel.innerText = '⚠️ 準備大迴旋甩尾！';
        bossStateLabel.style.color = '#ff4757';
        monster.timer -= dt;
        if (Math.floor(monster.timer * 15) % 2 === 0) {
          monsterMat.emissive.setHex(0xe67e22);
        }
        if (monster.timer <= 0) {
          monster.state = 'spin';
          monster.timer = 0.55;
          monster.hasDealtDamage = false;
        }
      } 
      else if (monster.state === 'spin') {
        bossStateLabel.innerText = '🌪️ 迴旋甩尾！';
        monster.timer -= dt;
        monsterGroup.rotation.y += 14 * dt;

        if (!monster.hasDealtDamage && dist < 7.8 && player.invincible <= 0) {
          monster.hasDealtDamage = true;
          damagePlayer(22);
        }

        if (monster.timer <= 0) {
          monster.state = 'cooldown';
          monster.timer = 1.2;
        }
      } 
      else if (monster.state === 'cooldown') {
        bossStateLabel.innerText = '喘息破綻 (輸出時機)';
        bossStateLabel.style.color = '#2ecc71';
        monster.timer -= dt;
        if (monster.timer <= 0) {
          monster.state = 'chase';
          monster.timer = 1.8 + Math.random() * 1.2;
        }
      } 
      else if (monster.state === 'stagger') {
        bossStateLabel.innerText = '💫 倒地硬直中！(大破綻)';
        bossStateLabel.style.color = '#00d2d3';
        monster.timer -= dt;
        monsterGroup.rotation.z = Math.PI / 5;
        if (monster.timer <= 0) {
          monster.state = 'chase';
          monster.timer = 1.5;
        }
      }

      monsterGroup.position.x = Math.max(-50, Math.min(50, monsterGroup.position.x));
      monsterGroup.position.z = Math.max(-50, Math.min(50, monsterGroup.position.z));
    }

    function damagePlayer(amount) {
      player.hp = Math.max(0, player.hp - amount);
      spawnFloatingText(hunterGroup.position, `-${amount}`, "#ff4757");
      if (player.hp <= 0) {
        endGame(false);
      }
    }

    function updateCamera() {
      const targetCamPos = new THREE.Vector3(
        hunterGroup.position.x,
        hunterGroup.position.y + 11,
        hunterGroup.position.z + 16
      );
      camera.position.lerp(targetCamPos, 0.1);

      const lookTarget = hunterGroup.position.clone().lerp(monsterGroup.position, 0.25);
      lookTarget.y += 1.5;
      camera.lookAt(lookTarget);
    }

    function animate() {
      requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.1);

      if (!gameOver) {
        updatePlayer(dt);
        updateMonster(dt);
        updateHUD();
      }
      updateCamera();
      renderer.render(scene, camera);
    }

    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });

    animate();
  </script>
</body>
</html>
'@

# 3. 儲存為 UTF-8 編碼的 index.html 並立即用預設瀏覽器開啟
[System.IO.File]::WriteAllText($htmlPath, $htmlContent, [System.Text.Encoding]::UTF8)
Write-Host "✅ 3D 魔物獵人已成功建立於：$htmlPath" -ForegroundColor Green
Start-Process "$htmlPath"