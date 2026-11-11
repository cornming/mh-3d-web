/* ==============================================================
   1. 程式化音效合成器 (Web Audio API Procedural Sound Synthesizer)
   擷取自開源 Web 動作遊戲優勢：免外掛資源、零延遲、高回饋
   ============================================================== */
export class ProceduralAudio {
  constructor({ onStatus } = {}) {
    this.ctx = null;
    this.unavailable = false;
    this.outputNode = null;
    this.masterGain = null;
    this.masterVolume = 0.8;
    this.ambientStarted = false;
    this.onStatus = typeof onStatus === 'function' ? onStatus : () => {};
  }
  init() {
    if (!this.ctx && !this.unavailable) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) {
        this.unavailable = true;
        this.onStatus('目前瀏覽器不支援 Web Audio，遊戲仍可繼續。');
        return;
      }
      try {
        this.ctx = new AudioContext();
        this.outputNode = this.ctx.createGain();
        this.outputNode.gain.value = 0.72;
        const compressor = this.ctx.createDynamicsCompressor();
        compressor.threshold.value = -18;
        compressor.knee.value = 18;
        compressor.ratio.value = 5;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.18;
        this.outputNode.connect(compressor);
        const forestReverb = this.ctx.createConvolver();
        forestReverb.buffer = this.createImpulseResponse(0.42, 2.6);
        const wetGain = this.ctx.createGain();
        wetGain.gain.value = 0.16;
        this.outputNode.connect(forestReverb);
        forestReverb.connect(wetGain);
        wetGain.connect(compressor);
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = this.masterVolume;
        compressor.connect(this.masterGain);
        this.masterGain.connect(this.ctx.destination);
        this.startAmbient();
      } catch (error) {
        this.unavailable = true;
        this.onStatus('音效初始化失敗，但仍可繼續遊戲。');
        console.warn('Web Audio initialization failed', error);
        return;
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {
        this.onStatus('瀏覽器拒絕啟用音效，遊戲仍可繼續。');
      });
    }
    this.startAmbient();
  }
  setMasterVolume(volume) {
    const normalized = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 0.8));
    this.masterVolume = normalized;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(normalized, this.ctx.currentTime, 0.03);
    }
  }
  output() {
    return this.outputNode || this.ctx.destination;
  }
  createImpulseResponse(duration, decay) {
    const length = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
    const impulse = this.ctx.createBuffer(2, length, this.ctx.sampleRate);
    for (let channel = 0; channel < impulse.numberOfChannels; channel++) {
      const data = impulse.getChannelData(channel);
      for (let index = 0; index < length; index++) {
        const envelope = Math.pow(1 - index / length, decay);
        data[index] = (Math.random() * 2 - 1) * envelope * (channel === 0 ? 0.8 : 0.68);
      }
    }
    return impulse;
  }
  noiseBuffer(duration) {
    const length = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (length * 0.22));
    }
    return buffer;
  }
  startAmbient() {
    if (!this.ctx || this.ambientStarted) return;
    this.ambientStarted = true;
    const now = this.ctx.currentTime;
    const ambientGain = this.ctx.createGain();
    ambientGain.gain.value = 0.026;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    ambientGain.connect(filter);
    filter.connect(this.output());

    const drone = this.ctx.createOscillator();
    drone.type = 'sine';
    drone.frequency.value = 54;
    const droneGain = this.ctx.createGain();
    droneGain.gain.value = 0.72;
    drone.connect(droneGain);
    droneGain.connect(ambientGain);
    drone.start(now);

    const undertone = this.ctx.createOscillator();
    undertone.type = 'triangle';
    undertone.frequency.value = 81;
    const undertoneGain = this.ctx.createGain();
    undertoneGain.gain.value = 0.18;
    undertone.connect(undertoneGain);
    undertoneGain.connect(ambientGain);
    undertone.start(now);

    // 林間風聲：循環的帶通雜訊，音量與頻率由低頻振盪緩慢起伏。
    const windSource = this.ctx.createBufferSource();
    windSource.buffer = this.flatNoiseBuffer(3.2);
    windSource.loop = true;
    const windFilter = this.ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 520;
    windFilter.Q.value = 0.45;
    const windGain = this.ctx.createGain();
    windGain.gain.value = 0.02;
    const gust = this.ctx.createOscillator();
    gust.type = 'sine';
    gust.frequency.value = 0.09;
    const gustDepth = this.ctx.createGain();
    gustDepth.gain.value = 0.012;
    gust.connect(gustDepth);
    gustDepth.connect(windGain.gain);
    const sweep = this.ctx.createGain();
    sweep.gain.value = 190;
    gust.connect(sweep);
    sweep.connect(windFilter.frequency);
    windSource.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(this.output());
    windSource.start(now);
    gust.start(now);

    this.ambientNodes = [drone, undertone, ambientGain, filter, windSource, windFilter, windGain, gust];
    this.scheduleBirdCall();
  }
  flatNoiseBuffer(duration) {
    const length = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }
  scheduleBirdCall() {
    if (!this.ctx) return;
    const delay = 4200 + Math.random() * 7800;
    this.birdTimer = setTimeout(() => {
      if (this.ctx && this.ctx.state === 'running' && !document.hidden) this.playBirdCall();
      this.scheduleBirdCall();
    }, delay);
  }
  playBirdCall() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const notes = 2 + Math.floor(Math.random() * 3);
    const base = 2100 + Math.random() * 1500;
    for (let i = 0; i < notes; i++) {
      const start = now + i * (0.11 + Math.random() * 0.05);
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(base * (1 + i * 0.06), start);
      osc.frequency.exponentialRampToValueAtTime(base * (1.22 + Math.random() * 0.2), start + 0.07);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.014, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.09);
      osc.connect(gain);
      gain.connect(this.output());
      osc.start(start);
      osc.stop(start + 0.1);
    }
  }
  /** 介面與任務演出共用的短音：依序播放 [頻率, 起始秒, 長度, 音量, 波形]。 */
  playTones(tones) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    tones.forEach(([frequency, offset = 0, duration = 0.12, volume = 0.1, type = 'triangle', glideTo = null]) => {
      const start = now + offset;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(frequency, start);
      if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, start + duration);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(gain);
      gain.connect(this.output());
      osc.start(start);
      osc.stop(start + duration + 0.02);
    });
  }
  playUiMove() {
    this.playTones([[620, 0, 0.05, 0.035, 'triangle']]);
  }
  playUiConfirm() {
    this.playTones([[520, 0, 0.07, 0.07, 'triangle'], [780, 0.055, 0.13, 0.07, 'triangle']]);
  }
  playUiBack() {
    this.playTones([[440, 0, 0.07, 0.055, 'triangle'], [300, 0.05, 0.12, 0.055, 'triangle']]);
  }
  playUiDeny() {
    this.playTones([[150, 0, 0.09, 0.09, 'square'], [118, 0.07, 0.12, 0.08, 'square']]);
  }
  playChargeTick(level = 1) {
    const frequency = [0, 520, 700, 930][Math.max(1, Math.min(3, level))];
    this.playTones([[frequency, 0, 0.1, 0.08, 'sine'], [frequency * 1.5, 0.02, 0.14, 0.05, 'sine']]);
  }
  playQuestStart() {
    this.playTones([
      [196, 0, 0.5, 0.11, 'triangle'],
      [294, 0.02, 0.5, 0.08, 'triangle'],
      [392, 0.3, 0.75, 0.1, 'triangle'],
      [587, 0.34, 0.8, 0.06, 'sine']
    ]);
  }
  playQuestClear() {
    this.playTones([
      [392, 0, 0.2, 0.11, 'triangle'],
      [523, 0.16, 0.2, 0.11, 'triangle'],
      [659, 0.32, 0.22, 0.11, 'triangle'],
      [784, 0.5, 0.9, 0.12, 'triangle'],
      [392, 0.5, 0.9, 0.07, 'sine'],
      [1047, 0.56, 0.9, 0.05, 'sine']
    ]);
  }
  playQuestFailed() {
    this.playTones([
      [220, 0, 0.5, 0.11, 'triangle'],
      [185, 0.34, 0.55, 0.1, 'triangle'],
      [147, 0.7, 1.2, 0.11, 'triangle', 98],
      [73, 0.7, 1.3, 0.1, 'sine']
    ]);
  }
  playFootstep(heavy = false) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer(0.07);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = heavy ? 180 : 240;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(heavy ? 0.08 : 0.045, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.output());
    source.start(now);
  }
  playSlash(heavy = false) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(heavy ? 280 : 420, now);
    osc.frequency.exponentialRampToValueAtTime(60, now + (heavy ? 0.28 : 0.16));

    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (heavy ? 0.28 : 0.16));

    osc.connect(gain);
    gain.connect(this.output());
    osc.start(now);
    osc.stop(now + (heavy ? 0.3 : 0.18));

    const air = this.ctx.createBufferSource();
    air.buffer = this.noiseBuffer(heavy ? 0.22 : 0.12);
    const airFilter = this.ctx.createBiquadFilter();
    airFilter.type = 'bandpass';
    airFilter.frequency.setValueAtTime(heavy ? 900 : 1400, now);
    airFilter.frequency.exponentialRampToValueAtTime(260, now + (heavy ? 0.22 : 0.12));
    airFilter.Q.value = 0.7;
    const airGain = this.ctx.createGain();
    airGain.gain.setValueAtTime(heavy ? 0.22 : 0.12, now);
    airGain.gain.exponentialRampToValueAtTime(0.001, now + (heavy ? 0.22 : 0.12));
    air.connect(airFilter);
    airFilter.connect(airGain);
    airGain.connect(this.output());
    air.start(now);
  }
  playHit(heavy = false) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    // 打擊衝擊雜音
    const buffer = this.noiseBuffer(heavy ? 0.18 : 0.09);
    const whiteNoise = this.ctx.createBufferSource();
    whiteNoise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(heavy ? 600 : 1200, now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(heavy ? 0.8 : 0.45, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (heavy ? 0.2 : 0.1));

    whiteNoise.connect(filter);
    filter.connect(gain);
    gain.connect(this.output());
    whiteNoise.start(now);

    // 低頻重音衝擊
    const subOsc = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    subOsc.type = 'triangle';
    subOsc.frequency.setValueAtTime(heavy ? 120 : 180, now);
    subOsc.frequency.exponentialRampToValueAtTime(30, now + 0.15);
    subGain.gain.setValueAtTime(heavy ? 0.6 : 0.3, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    subOsc.connect(subGain);
    subGain.connect(this.output());
    subOsc.start(now);
    subOsc.stop(now + 0.16);

    const metal = this.ctx.createOscillator();
    const metalGain = this.ctx.createGain();
    metal.type = 'triangle';
    metal.frequency.setValueAtTime(heavy ? 820 : 1160, now);
    metal.frequency.exponentialRampToValueAtTime(240, now + 0.09);
    metalGain.gain.setValueAtTime(heavy ? 0.18 : 0.1, now);
    metalGain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    metal.connect(metalGain);
    metalGain.connect(this.output());
    metal.start(now);
    metal.stop(now + 0.12);
  }
  playRoar() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    // 龍吼：失真調頻鋸齒波
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.linearRampToValueAtTime(260, now + 0.35);
    osc.frequency.exponentialRampToValueAtTime(80, now + 1.2);

    gain.gain.setValueAtTime(0.5, now);
    gain.gain.linearRampToValueAtTime(0.7, now + 0.4);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.3);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(450, now);
    filter.Q.value = 2.0;

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.output());
    osc.start(now);
    osc.stop(now + 1.3);

    const sub = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    sub.type = 'triangle';
    sub.frequency.setValueAtTime(54, now);
    sub.frequency.exponentialRampToValueAtTime(28, now + 1.4);
    subGain.gain.setValueAtTime(0.42, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 1.4);
    sub.connect(subGain);
    subGain.connect(this.output());
    sub.start(now);
    sub.stop(now + 1.45);

    const breath = this.ctx.createBufferSource();
    breath.buffer = this.noiseBuffer(1.25);
    const breathFilter = this.ctx.createBiquadFilter();
    breathFilter.type = 'lowpass';
    breathFilter.frequency.setValueAtTime(620, now);
    breathFilter.frequency.linearRampToValueAtTime(180, now + 1.15);
    const breathGain = this.ctx.createGain();
    breathGain.gain.setValueAtTime(0.16, now);
    breathGain.gain.exponentialRampToValueAtTime(0.001, now + 1.25);
    breath.connect(breathFilter);
    breathFilter.connect(breathGain);
    breathGain.connect(this.output());
    breath.start(now);
  }
  playWingWhoosh(enraged = false) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer(enraged ? 0.32 : 0.24);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(enraged ? 420 : 300, now);
    filter.frequency.exponentialRampToValueAtTime(enraged ? 1200 : 850, now + 0.14);
    filter.Q.value = 0.55;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(enraged ? 0.24 : 0.14, now + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (enraged ? 0.3 : 0.22));
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.output());
    source.start(now);
  }
  playEnragePulse() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(96, now);
    osc.frequency.exponentialRampToValueAtTime(260, now + 0.32);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.24, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
    osc.connect(gain);
    gain.connect(this.output());
    osc.start(now);
    osc.stop(now + 0.45);
  }
  playTelegraph(kind = 'charge', enraged = false) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const isSpin = kind === 'spin';
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    osc.type = isSpin ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(isSpin ? 180 : 92, now);
    osc.frequency.exponentialRampToValueAtTime(isSpin ? 520 : 180, now + (isSpin ? 0.26 : 0.42));
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(enraged ? 980 : 720, now);
    filter.frequency.linearRampToValueAtTime(enraged ? 1500 : 1100, now + 0.4);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(enraged ? 0.2 : 0.13, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (isSpin ? 0.34 : 0.5));
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.output());
    osc.start(now);
    osc.stop(now + (isSpin ? 0.36 : 0.52));
  }
  playPartBreak() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const metal = this.ctx.createOscillator();
    const metalGain = this.ctx.createGain();
    metal.type = 'triangle';
    metal.frequency.setValueAtTime(1180, now);
    metal.frequency.exponentialRampToValueAtTime(180, now + 0.34);
    metalGain.gain.setValueAtTime(0.22, now);
    metalGain.gain.exponentialRampToValueAtTime(0.001, now + 0.36);
    metal.connect(metalGain);
    metalGain.connect(this.output());
    metal.start(now);
    metal.stop(now + 0.38);

    const crack = this.ctx.createBufferSource();
    crack.buffer = this.noiseBuffer(0.18);
    const crackFilter = this.ctx.createBiquadFilter();
    crackFilter.type = 'highpass';
    crackFilter.frequency.setValueAtTime(850, now);
    crackFilter.frequency.exponentialRampToValueAtTime(260, now + 0.16);
    const crackGain = this.ctx.createGain();
    crackGain.gain.setValueAtTime(0.16, now);
    crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    crack.connect(crackFilter);
    crackFilter.connect(crackGain);
    crackGain.connect(this.output());
    crack.start(now);
  }
  playRoll() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.2);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.connect(gain);
    gain.connect(this.output());
    osc.start(now);
    osc.stop(now + 0.22);
  }
  playHeal() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(640, now + 0.35);
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc.connect(gain);
    gain.connect(this.output());
    osc.start(now);
    osc.stop(now + 0.42);
  }
  playSharpen() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1400, now);
    osc.frequency.exponentialRampToValueAtTime(2600, now + 0.25);
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc.connect(gain);
    gain.connect(this.output());
    osc.start(now);
    osc.stop(now + 0.26);
  }
}
