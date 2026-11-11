import { formatQuestClock } from '../game-rules.mjs';

/* ==============================================================
   狩獵中 HUD：只負責把遊戲狀態畫到 DOM 上，不持有任何遊戲規則。
   main.mjs 每幀呼叫 render(snapshot)，事件型回饋（受擊、破壞、提示）
   則透過各個具名方法觸發。
   ============================================================== */

const WEAPON_ICONS = { greatsword: '#i-greatsword', dualblades: '#i-dualblades' };
const STATUS_ICONS = {
  enraged: '#i-rage',
  down: '#i-down',
  opening: '#i-opening',
  alert: '#i-warning'
};
const TOAST_ICONS = {
  info: '#i-scroll',
  target: '#i-target',
  weapon: '#i-swap',
  edge: '#i-edge',
  potion: '#i-potion',
  rage: '#i-rage',
  down: '#i-down',
  warning: '#i-warning'
};
const SVG_NS = 'http://www.w3.org/2000/svg';

/** 小地圖上的固定地標，座標與 tools/generate_assets.py 的獵場配置一致（已含 z+5 的場景位移）。 */
function buildLandmarks() {
  const tau = Math.PI * 2;
  const boulders = [];
  for (let index = 0; index < 18; index++) {
    const angle = (index / 18) * tau + 0.12 * Math.sin(index * 1.7);
    const distance = 31 + (index % 4) * 3.1;
    boulders.push({ x: Math.cos(angle) * distance, z: Math.sin(angle) * distance + 5, r: 1.9 + (index % 3) * 0.55 });
  }
  const trees = [];
  for (let index = 0; index < 9; index++) {
    const angle = (index / 9) * tau + 0.22;
    const distance = 29 + (index % 3) * 2.8;
    trees.push({ x: Math.cos(angle) * distance, z: Math.sin(angle) * distance + 5 });
  }
  return {
    boulders,
    trees,
    bones: { x: -17, z: -8 },
    logs: [
      { x: -14, z: -3, length: 7.5 },
      { x: 16, z: 9, length: 6.2 },
      { x: -22, z: 20, length: 5.4 }
    ]
  };
}

function restartAnimation(element, className) {
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
}

function svgIcon(href) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', href);
  svg.appendChild(use);
  return svg;
}

export function createHud({ arena }) {
  const $ = (id) => document.getElementById(id);
  const el = {
    vitals: $('vitals'),
    emblem: $('weapon-emblem'),
    emblemIcon: $('weapon-emblem-icon'),
    weaponName: $('weapon-name'),
    hpGauge: $('hp-gauge'),
    hpFill: $('hp-fill'),
    hpGhost: $('hp-ghost'),
    hpText: $('hp-text'),
    staminaGauge: $('stamina-gauge'),
    staminaFill: $('stamina-fill'),
    sharpness: $('sharpness'),
    sharpnessSpent: $('sharpness-spent'),
    sharpnessText: $('sharpness-text'),
    buffFocus: $('buff-focus'),
    target: $('target'),
    bossGauge: $('boss-gauge'),
    bossFill: $('boss-fill'),
    bossGhost: $('boss-ghost'),
    bossStatus: $('boss-status'),
    bossStatusIcon: $('boss-status-icon'),
    bossStatusText: $('boss-status-text'),
    partHead: $('part-head'),
    partTail: $('part-tail'),
    questClock: $('quest-clock'),
    questTime: $('quest-time'),
    minimapCanvas: $('minimap-canvas'),
    minimapNorth: $('minimap-north'),
    feed: $('feed'),
    callout: $('callout'),
    calloutEyebrow: $('callout-eyebrow'),
    calloutTitle: $('callout-title'),
    calloutSub: $('callout-sub'),
    combo: $('combo-gauge'),
    charge: $('charge-gauge'),
    chargePips: Array.from(document.querySelectorAll('#charge-gauge .charge__pips i')),
    hints: $('hints'),
    hintsLabel: $('hints-toggle-label'),
    slotPotion: $('slot-potion'),
    slotWhetstone: $('slot-whetstone'),
    potionCount: $('potion-count'),
    reticle: $('lockon-reticle'),
    pointer: $('target-pointer'),
    threat: $('threat-marker'),
    damageLayer: $('damage-layer'),
    impactFlash: $('impact-flash'),
    damageVignette: $('damage-vignette'),
    damageDirection: $('damage-direction')
  };

  const cache = new Map();
  /** 只在值真的改變時才寫入 DOM，避免每幀觸發樣式重算。 */
  const changed = (key, value) => {
    if (cache.get(key) === value) return false;
    cache.set(key, value);
    return true;
  };
  const setVar = (element, key, name, value) => {
    if (changed(key, value)) element.style.setProperty(name, value);
  };
  const setData = (element, key, name, value) => {
    if (changed(key, value)) element.dataset[name] = value;
  };
  const setText = (element, key, value) => {
    if (changed(key, value)) element.textContent = value;
  };
  const ratio = (value, max) => Math.min(1, Math.max(0, max > 0 ? value / max : 0));

  let showDamageNumbers = true;
  let calloutTimer = 0;
  let minimapTick = 0;
  const landmarks = buildLandmarks();
  const mapContext = el.minimapCanvas.getContext('2d');

  function render(state) {
    // --- 獵人體力：填色即時反應，淡色殘影延遲收攏，呈現「剛被削掉多少」 ---
    const hpRatio = ratio(state.hp, state.maxHp);
    const hpKey = hpRatio.toFixed(3);
    setVar(el.hpFill, 'hp', '--value', hpKey);
    setVar(el.hpGhost, 'hpGhost', '--value', hpKey);
    setData(el.hpGauge, 'hpState', 'state', hpRatio <= 0.3 ? 'danger' : (hpRatio <= 0.55 ? 'caution' : 'normal'));
    const hpDisplay = String(Math.ceil(state.hp));
    if (changed('hpText', hpDisplay)) {
      el.hpText.textContent = hpDisplay;
      el.hpGauge.setAttribute('aria-valuenow', hpDisplay);
    }
    if (changed('danger', hpRatio <= 0.3 && state.hp > 0)) {
      document.body.dataset.danger = String(hpRatio <= 0.3 && state.hp > 0);
    }

    setVar(el.staminaFill, 'stamina', '--value', ratio(state.stamina, state.maxStamina).toFixed(3));
    setData(el.staminaGauge, 'staminaState', 'state', state.staminaLow ? 'low' : 'normal');
    if (changed('staminaAria', Math.floor(state.stamina))) {
      el.staminaGauge.setAttribute('aria-valuenow', String(Math.floor(state.stamina)));
    }

    // --- 斬味：四段色帶固定不動，以深色遮罩蓋住已消耗的部分 ---
    setVar(el.sharpnessSpent, 'sharpSpent', '--spent', (1 - ratio(state.sharpness, 100)).toFixed(3));
    if (changed('sharpLevel', state.sharpnessLevel.name)) {
      el.sharpness.style.setProperty('--sharp-color', state.sharpnessLevel.color);
      el.sharpnessText.textContent = state.sharpnessLevel.name.charAt(0);
      el.sharpness.setAttribute('aria-valuetext', state.sharpnessLevel.name);
      if (cache.get('sharpLevelSeen')) restartAnimation(el.sharpness, 'is-changed');
      cache.set('sharpLevelSeen', true);
    }
    if (changed('sharpAria', Math.round(state.sharpness))) {
      el.sharpness.setAttribute('aria-valuenow', String(Math.round(state.sharpness)));
    }

    if (changed('weapon', state.weaponMode)) {
      el.emblemIcon.setAttribute('href', WEAPON_ICONS[state.weaponMode] || WEAPON_ICONS.greatsword);
      el.weaponName.textContent = state.weaponLabel;
      el.emblem.setAttribute('aria-label', `切換武器，目前為${state.weaponLabel}`);
    }

    // --- 會心狀態（精準迴避的獎勵） ---
    setData(el.buffFocus, 'focusActive', 'active', String(state.focusRatio > 0));
    if (state.focusRatio > 0) setVar(el.buffFocus, 'focusRatio', '--value', state.focusRatio.toFixed(2));

    // --- 道具欄 ---
    setText(el.potionCount, 'potions', String(state.potions));
    setData(el.slotPotion, 'potionAvailable', 'available', String(state.potionAvailable));
    setData(el.slotWhetstone, 'whetAvailable', 'available', String(state.whetstoneAvailable));
    setData(el.slotPotion, 'potionBusy', 'busy', String(state.potionProgress >= 0));
    setData(el.slotWhetstone, 'whetBusy', 'busy', String(state.whetstoneProgress >= 0));
    setVar(el.slotPotion, 'potionProgress', '--progress', Math.max(0, state.potionProgress).toFixed(2));
    setVar(el.slotWhetstone, 'whetProgress', '--progress', Math.max(0, state.whetstoneProgress).toFixed(2));

    // --- 蓄力與連段 ---
    setData(el.charge, 'chargeLevel', 'level', String(state.chargeLevel));
    if (state.chargeLevel > 0) {
      el.chargePips.forEach((pip, index) => {
        const fill = Math.min(1, Math.max(0, state.chargeProgress - index));
        setVar(pip, `pip${index}`, '--fill', fill.toFixed(2));
        if (changed(`pipFull${index}`, fill >= 1)) pip.classList.toggle('is-full', fill >= 1);
      });
    }
    setData(el.combo, 'comboStep', 'step', String(state.comboStep));

    // --- 狩獵目標 ---
    const bossRatio = ratio(state.bossHp, state.bossMaxHp).toFixed(3);
    setVar(el.bossFill, 'boss', '--value', bossRatio);
    setVar(el.bossGhost, 'bossGhost', '--value', bossRatio);
    if (changed('bossAria', Math.ceil(state.bossHp))) {
      el.bossGauge.setAttribute('aria-valuenow', String(Math.ceil(state.bossHp)));
    }
    setData(el.target, 'enraged', 'enraged', String(state.enraged));
    if (changed('bossStatus', state.bossStatus)) {
      el.bossStatus.dataset.state = state.bossStatus;
      if (state.bossStatus !== 'none') {
        el.bossStatusIcon.setAttribute('href', STATUS_ICONS[state.bossStatus] || STATUS_ICONS.alert);
        el.bossStatusText.textContent = state.bossStatusText;
      }
    }
    setData(el.partHead, 'headBroken', 'broken', String(state.headBroken));
    setData(el.partTail, 'tailBroken', 'broken', String(state.tailBroken));

    // --- 任務計時 ---
    setText(el.questTime, 'questTime', formatQuestClock(state.remainingSeconds));
    setData(el.questClock, 'questUrgent', 'urgent', String(state.remainingSeconds <= 60));

    // --- 世界座標對應的標記 ---
    placeMarker(el.reticle, 'reticle', state.lock);
    placeMarker(el.pointer, 'pointer', state.pointer);
    if (state.pointer.active) setVar(el.pointer, 'pointerAngle', '--angle', `${state.pointer.angle.toFixed(2)}rad`);
    placeMarker(el.threat, 'threat', state.threat);
    if (state.threat.active) setData(el.threat, 'threatKind', 'kind', state.threat.kind);

    minimapTick = (minimapTick + 1) % 3;
    if (minimapTick === 0 && document.body.dataset.minimap !== 'false') drawMinimap(state.radar);
  }

  function placeMarker(element, key, marker) {
    if (changed(`${key}Active`, marker.active)) element.classList.toggle('is-active', marker.active);
    if (!marker.active) return;
    const transform = `translate(${marker.x.toFixed(1)}px, ${marker.y.toFixed(1)}px)`;
    if (changed(`${key}Pos`, transform)) element.style.transform = transform;
  }

  function drawMinimap(radar) {
    const ctx = mapContext;
    const size = el.minimapCanvas.width;
    const half = size / 2;
    const scale = half / arena.viewRange;
    const cos = Math.cos(radar.cameraYaw);
    const sin = Math.sin(radar.cameraYaw);
    const project = (x, z) => {
      const dx = x - arena.centerX;
      const dz = z - arena.centerZ;
      return [half + (dx * cos - dz * sin) * scale, half + (dx * sin + dz * cos) * scale];
    };
    const heading = (yaw) => {
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      return Math.atan2(fx * sin + fz * cos, fx * cos - fz * sin);
    };

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(half, half, half, 0, Math.PI * 2);
    ctx.clip();

    const ground = ctx.createRadialGradient(half, half, half * 0.1, half, half, half);
    ground.addColorStop(0, 'rgba(74, 92, 58, 0.92)');
    ground.addColorStop(1, 'rgba(24, 33, 22, 0.94)');
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, size, size);

    const [cx, cz] = project(arena.centerX, arena.centerZ);
    ctx.fillStyle = 'rgba(156, 148, 104, 0.34)';
    ctx.beginPath();
    ctx.arc(cx, cz, arena.clearingRadius * scale, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(200, 164, 92, 0.6)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.arc(cx, cz, arena.radius * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = 'rgba(126, 134, 128, 0.85)';
    landmarks.boulders.forEach((rock) => {
      const [x, y] = project(rock.x, rock.z);
      ctx.beginPath();
      ctx.arc(x, y, rock.r * scale * 0.9, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = 'rgba(46, 84, 44, 0.95)';
    landmarks.trees.forEach((tree) => {
      const [x, y] = project(tree.x, tree.z);
      ctx.beginPath();
      ctx.arc(x, y, 2.3 * scale, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.strokeStyle = 'rgba(120, 78, 42, 0.95)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    landmarks.logs.forEach((log) => {
      const [x1, y1] = project(log.x - log.length / 2, log.z);
      const [x2, y2] = project(log.x + log.length / 2, log.z);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    });
    const [bx, by] = project(landmarks.bones.x, landmarks.bones.z);
    ctx.fillStyle = 'rgba(232, 220, 190, 0.9)';
    ctx.beginPath();
    ctx.arc(bx, by, 4.5, 0, Math.PI * 2);
    ctx.fill();

    const [hx, hy] = project(radar.hunter.x, radar.hunter.z);
    const [mx, my] = project(radar.monster.x, radar.monster.z);

    if (radar.lockOn) {
      ctx.strokeStyle = 'rgba(255, 130, 89, 0.7)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(mx, my);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 魔物：依身體朝向畫出的楔形，狂暴時外圈脈動
    if (radar.monster.alive) {
      const pulse = radar.monster.enraged ? 1 + Math.sin(radar.time * 9) * 0.22 : 1;
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(heading(radar.monster.yaw));
      ctx.fillStyle = radar.monster.enraged ? 'rgba(255, 96, 62, 0.3)' : 'rgba(216, 69, 47, 0.22)';
      ctx.beginPath();
      ctx.arc(0, 0, 15 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = radar.monster.enraged ? '#ff6a43' : '#d8452f';
      ctx.strokeStyle = '#1a0a06';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(12, 0);
      ctx.lineTo(-7, 7.5);
      ctx.lineTo(-3, 0);
      ctx.lineTo(-7, -7.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // 獵人：亮色箭頭
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(heading(radar.hunter.yaw));
    ctx.fillStyle = '#fff3cf';
    ctx.strokeStyle = '#1a140d';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.lineTo(-6, 6);
    ctx.lineTo(-2.5, 0);
    ctx.lineTo(-6, -6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.restore();
    if (changed('north', radar.cameraYaw.toFixed(2))) {
      el.minimapNorth.style.setProperty('--north', `${radar.cameraYaw.toFixed(2)}rad`);
    }
  }

  function toast(text, { icon = 'info', tone = 'neutral', duration = 3200 } = {}) {
    while (el.feed.children.length >= 4) el.feed.firstElementChild.remove();
    const item = document.createElement('div');
    item.className = 'toast';
    item.dataset.tone = tone;
    item.appendChild(svgIcon(TOAST_ICONS[icon] || TOAST_ICONS.info));
    const label = document.createElement('span');
    label.textContent = text;
    item.appendChild(label);
    el.feed.appendChild(item);
    setTimeout(() => {
      item.classList.add('is-leaving');
      setTimeout(() => item.remove(), 360);
    }, duration);
  }

  function callout({ eyebrow = '', title, sub = '', tone = 'neutral', duration = 2400 }) {
    el.calloutEyebrow.textContent = eyebrow;
    el.calloutTitle.textContent = title;
    el.calloutSub.textContent = sub;
    el.callout.dataset.tone = tone;
    el.callout.style.setProperty('--callout-duration', `${duration}ms`);
    restartAnimation(el.callout, 'is-visible');
    clearTimeout(calloutTimer);
    calloutTimer = setTimeout(() => el.callout.classList.remove('is-visible'), duration);
  }

  function damageNumber({ x, y, text, kind = 'normal', always = false }) {
    if (!showDamageNumbers && !always) return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const item = document.createElement('span');
    item.className = `dmg dmg--${kind}`;
    item.textContent = text;
    item.style.left = `${x.toFixed(0)}px`;
    item.style.top = `${y.toFixed(0)}px`;
    item.style.setProperty('--dx', `${((Math.random() - 0.5) * 3).toFixed(2)}rem`);
    el.damageLayer.appendChild(item);
    setTimeout(() => item.remove(), 1000);
  }

  function clearTransient() {
    el.feed.replaceChildren();
    el.damageLayer.replaceChildren();
    el.callout.classList.remove('is-visible');
    clearTimeout(calloutTimer);
    document.body.dataset.danger = 'false';
    cache.delete('danger');
  }

  return {
    render,
    toast,
    callout,
    damageNumber,
    clearTransient,
    playerHit() {
      restartAnimation(el.vitals, 'is-hit');
      restartAnimation(el.damageVignette, 'is-active');
    },
    damageDirection(angle) {
      el.damageDirection.style.setProperty('--damage-angle', `${angle.toFixed(3)}rad`);
      restartAnimation(el.damageDirection, 'is-active');
    },
    impactFlash(isHeavy) {
      el.impactFlash.dataset.tone = isHeavy ? 'heavy' : 'light';
      restartAnimation(el.impactFlash, 'is-active');
    },
    denyStamina() {
      restartAnimation(el.staminaGauge, 'is-denied');
    },
    denyItem(item) {
      restartAnimation(item === 'potion' ? el.slotPotion : el.slotWhetstone, 'is-denied');
    },
    itemUsed(item) {
      restartAnimation(item === 'potion' ? el.slotPotion : el.slotWhetstone, 'is-used');
    },
    weaponSwapped() {
      restartAnimation(el.emblem, 'is-swapped');
    },
    partBroken(part) {
      restartAnimation(part === 'head' ? el.partHead : el.partTail, 'is-breaking');
    },
    chargeLevelUp() {
      restartAnimation(el.charge, 'is-levelup');
    },
    lockOnChanged(active) {
      if (active) restartAnimation(el.reticle, 'is-locking');
    },
    setHintsCollapsed(collapsed) {
      el.hints.dataset.collapsed = String(collapsed);
      el.hintsLabel.textContent = collapsed ? '操作提示' : '收合提示';
    },
    areHintsCollapsed() {
      return el.hints.dataset.collapsed === 'true';
    },
    applySettings(settings) {
      showDamageNumbers = settings.showDamageNumbers;
      document.documentElement.style.setProperty('--hud-scale', String(settings.hudScale));
      document.body.dataset.targetHealth = String(settings.showTargetHealth);
      document.body.dataset.minimap = String(settings.showMinimap);
      document.body.dataset.hints = String(settings.showControlHints);
    }
  };
}
