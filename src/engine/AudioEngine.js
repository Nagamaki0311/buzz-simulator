/**
 * AudioEngine
 *
 * 本来の仕様では「紙をめくる音」「墨を書く音」などの録音素材を
 * assets/audio/ に配置して再生する想定だが、この時点では音源ファイルが
 * 用意されていないため、Web Audio APIによる簡易な合成音を暫定的な
 * プレースホルダーとして使用する。
 *
 * 実際の音源素材（assets/audio/*.mp3等）が用意され次第、
 * play()の実装をAudioBufferSourceNodeによる再生に差し替えることを想定し、
 * 呼び出し側（UIEngine等）からは play(soundId) のインターフェースのみに
 * 依存させている。
 */
export class AudioEngine {
  constructor() {
    this._ctx = null;
    this._muted = false;
  }

  _ensureContext() {
    if (!this._ctx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this._ctx = new AudioContextClass();
    }
    return this._ctx;
  }

  setMuted(muted) {
    this._muted = muted;
  }

  /**
   * @param {"spinStart"|"cellChange"|"hit"|"buttonPress"} soundId
   */
  play(soundId) {
    if (this._muted) return;

    const ctx = this._ensureContext();
    const now = ctx.currentTime;

    const presets = {
      buttonPress: { freq: 440, duration: 0.05, gain: 0.15 },
      spinStart: { freq: 220, duration: 0.15, gain: 0.12 },
      cellChange: { freq: 880, duration: 0.02, gain: 0.03 },
      hit: { freq: 660, duration: 0.18, gain: 0.18 },
    };

    const preset = presets[soundId];
    if (!preset) return;

    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(preset.freq, now);
    gainNode.gain.setValueAtTime(preset.gain, now);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + preset.duration);

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + preset.duration);
  }
}
