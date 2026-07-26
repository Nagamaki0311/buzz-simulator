import { cellCenterPercent } from "../judge/gridLines.js";

const PARTICLE_COUNT_PER_CELL = 7;

/**
 * AnimationEngine
 *
 * DOM要素へのCSSクラス付与・削除、および成立時の一時的なオーバーレイ要素
 * （パーティクル・衝撃波・スコアポップアップ・コンボ演出）の生成を担当する。
 * ゲームの正の状態（スコア・所持金など）は一切保持せず、GameEngineから渡された
 * 結果を「どう見せるか」のみに責務を限定している。
 *
 * 【演出強化について】
 * 成立時の「気持ちよさ」を高めるため、以下を組み合わせている。
 *   - cell-pop: マス内の文字のみを対象にした、勢いのある拡大→縮小のバウンス
 *     （マスそのもののサイズ・レイアウトは変えない）
 *   - 文字のブラー→ピント演出: 一瞬ぼかしてから鮮明に戻すことで、
 *     モーションブラーのような「勢い」を表現する（CSSでは真の残像は
 *     表現できないため、このアプローチで代替している）
 *   - パーティクル: 成立マスの中心から光の粒が放射状に飛び散る
 *   - 衝撃波: 成立マスの中心から輪が広がって消える
 *   - 軽い画面揺れ: 成立のたびに小さく、コンボ時はより大きく揺らす
 */
export class AnimationEngine {
  /**
   * @param {(index: number) => HTMLElement} getCharElement セルindex(0-29)から文字要素(span.cell-char)を取得する関数
   * @param {(index: number) => HTMLElement} getCellElement セルindex(0-29)からセル要素(div.cell)を取得する関数
   * @param {HTMLElement} effectLayerEl パーティクル・衝撃波・スコアポップアップを描画するオーバーレイ用DOM要素
   * @param {HTMLElement} bannerLayerEl コンボ演出バナーを表示する全画面レイヤー
   */
  constructor(getCharElement, getCellElement, effectLayerEl, bannerLayerEl) {
    this._getCharElement = getCharElement;
    this._getCellElement = getCellElement;
    this._effectLayerEl = effectLayerEl;
    this._bannerLayerEl = bannerLayerEl;
  }

  /**
   * 文字が切り替わった瞬間の軽い演出（スピン中、毎更新ごと）
   * @param {number} index
   */
  playCellChange(index) {
    const el = this._getCharElement(index);
    if (!el) return;
    el.classList.remove("cell-changing");
    void el.offsetWidth;
    el.classList.add("cell-changing");
  }

  /**
   * 役成立時の演出一式。マス内の文字のみを対象に、勢いのある拡大バウンスと
   * ブラー→ピント演出をかける。マスのサイズ・レイアウトには影響しない。
   * 加えて、成立マスの中心からパーティクルと衝撃波を発生させ、
   * 画面全体を軽く揺らす。
   * @param {number[]} indices
   */
  playHit(indices) {
    for (const index of indices) {
      const cellEl = this._getCellElement(index);
      const charEl = this._getCharElement(index);
      if (cellEl) {
        cellEl.classList.add("cell-fixed");
        cellEl.classList.add("cell-hit-flash");
        setTimeout(() => cellEl.classList.remove("cell-hit-flash"), 500);
      }
      if (charEl) {
        charEl.classList.remove("cell-changing", "cell-pop");
        void charEl.offsetWidth;
        charEl.classList.add("cell-pop");
      }

      this._spawnShockwave(index);
      this._spawnParticles(index);
    }

    this._shakeGrid("light");
  }

  _spawnShockwave(index) {
    if (!this._effectLayerEl) return;
    const { x, y } = cellCenterPercent(index);

    const ring = document.createElement("div");
    ring.className = "shockwave-ring";
    ring.style.left = `${x}%`;
    ring.style.top = `${y}%`;
    this._effectLayerEl.appendChild(ring);
    setTimeout(() => ring.remove(), 500);
  }

  _spawnParticles(index) {
    if (!this._effectLayerEl) return;
    const { x, y } = cellCenterPercent(index);

    for (let i = 0; i < PARTICLE_COUNT_PER_CELL; i++) {
      const angle = (Math.PI * 2 * i) / PARTICLE_COUNT_PER_CELL + Math.random() * 0.5;
      const distance = 28 + Math.random() * 22; // px相当（effect-layer内はpx基準で飛ばす）
      const dx = Math.cos(angle) * distance;
      const dy = Math.sin(angle) * distance;

      const particle = document.createElement("div");
      particle.className = "hit-particle";
      particle.style.left = `${x}%`;
      particle.style.top = `${y}%`;
      particle.style.setProperty("--dx", `${dx}px`);
      particle.style.setProperty("--dy", `${dy}px`);
      this._effectLayerEl.appendChild(particle);
      setTimeout(() => particle.remove(), 550);
    }
  }

  /**
   * 画面（リールグリッド）を軽く揺らす。
   * @param {"light"|"strong"} intensity
   */
  _shakeGrid(intensity) {
    const grid = document.querySelector(".reel-grid");
    if (!grid) return;
    const className = intensity === "strong" ? "grid-shake-strong" : "grid-shake-light";
    grid.classList.remove("grid-shake-light", "grid-shake-strong");
    void grid.offsetWidth;
    grid.classList.add(className);
  }

  /**
   * 「+100」のようなスコア加算エフェクトを、成立したマスの中心付近に表示する。
   * @param {Array<{a:number, b:number}>} results このtickで成立した役（複数可）
   * @param {number} scoreGained このtickで得た合計スコア（コンボなら合算値）
   */
  playScorePopup(results, scoreGained) {
    if (!this._effectLayerEl || scoreGained <= 0) return;

    const indices = results.flatMap((r) => [r.a, r.b]);
    const points = indices.map((i) => cellCenterPercent(i));
    const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
    const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;

    const popup = document.createElement("div");
    popup.className = "score-popup";
    popup.textContent = `+${scoreGained}`;
    popup.style.left = `${cx}%`;
    popup.style.top = `${cy}%`;

    this._effectLayerEl.appendChild(popup);
    setTimeout(() => popup.remove(), 900);
  }

  /**
   * コンボ（同一タイミングで2語以上成立）専用の演出。通常のヒットより目立たせる。
   * @param {number} n 同時成立数
   * @param {number} scoreGained このコンボで得たスコア
   */
  playComboBanner(n, scoreGained) {
    if (!this._bannerLayerEl || n < 2) return;

    const banner = document.createElement("div");
    banner.className = "combo-banner";
    banner.innerHTML = `<span class="combo-banner-n">${n}連鎖</span><span class="combo-banner-score">+${scoreGained}</span>`;

    this._bannerLayerEl.appendChild(banner);
    setTimeout(() => banner.remove(), 900);

    this._shakeGrid("strong");
  }

  /**
   * リプレイ成立時の専用演出。コンボバナーとは異なる、分かりやすい
   * 「REPLAY」表示を出す。
   */
  playReplayBanner() {
    if (!this._bannerLayerEl) return;

    const banner = document.createElement("div");
    banner.className = "replay-banner";
    banner.innerHTML = `<span class="replay-banner-text">REPLAY</span><span class="replay-banner-sub">もう一度スピン！</span>`;

    this._bannerLayerEl.appendChild(banner);
    setTimeout(() => banner.remove(), 1100);

    this._shakeGrid("strong");
  }

  /**
   * スピン開始時、全セル・オーバーレイの演出状態をリセットする
   * @param {number} cellCount
   */
  resetAll(cellCount) {
    for (let i = 0; i < cellCount; i++) {
      const cellEl = this._getCellElement(i);
      const charEl = this._getCharElement(i);
      if (cellEl) {
        cellEl.classList.remove("cell-fixed", "cell-hit-flash");
      }
      if (charEl) {
        charEl.classList.remove("cell-changing", "cell-pop");
      }
    }
    if (this._effectLayerEl) {
      this._effectLayerEl.innerHTML = "";
    }
    if (this._bannerLayerEl) {
      this._bannerLayerEl.innerHTML = "";
    }
  }
}
