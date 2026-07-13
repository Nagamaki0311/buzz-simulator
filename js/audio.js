/**
 * audio.js
 * 通知音を外部ファイルなしでWeb Audio APIから直接合成する。
 * 「ポン」「ピコン」のような短い電子音を数パターン用意し、ランダムに再生する。
 */
const AudioEngine = (() => {
  let ctx = null;

  function ensureCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  // 単発トーン再生。freq: 周波数, duration: 秒, delay: 開始遅延(秒), type: 波形
  function tone(freq, duration, delay = 0, type = "sine", gainPeak = 0.18) {
    const c = ensureCtx();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(c.destination);

    const t0 = c.currentTime + delay;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(gainPeak, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  // 効果音パターン集
  const patterns = [
    () => tone(880, 0.12, 0, "sine"),                                   // ポン
    () => { tone(1046, 0.08, 0, "sine"); tone(1568, 0.12, 0.07, "sine"); }, // ピコン
    () => tone(660, 0.1, 0, "triangle"),                                 // ぽこ
    () => { tone(1318, 0.07, 0, "sine"); tone(1760, 0.09, 0.05, "sine"); }, // きらん
  ];

  return {
    playNotify(soundOn) {
      if (!soundOn) return;
      try {
        const pick = patterns[Math.floor(Math.random() * patterns.length)];
        pick();
      } catch (e) {
        // AudioContextが未初期化(ユーザー操作前)等は静かに無視
      }
    },
    // 最初のユーザー操作時に呼び出し、AudioContextをアンロックする
    unlock() {
      try { ensureCtx(); } catch (e) {}
    }
  };
})();
