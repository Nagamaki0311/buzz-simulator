import { cellCenterPercent } from "../judge/gridLines.js";

/**
 * AnimationEngine
 *
 * DOM要素へのCSSクラス付与・削除、および成立時の一時的なオーバーレイ要素
 * （スコアポップアップ・コンボ演出）の生成を担当する。
 * ゲームの正の状態（スコア・所持金など）は一切保持せず、GameEngineから渡された
 * 結果を「どう見せるか」のみに責務を限定している。
 *
 * 【ライン表示の削除について】
 * 以前は成立した2マスを線で結ぶ演出を実装していたが、視認性を下げるとの
 * フィードバックを受けて撤廃した。代わりに、成立したマス自体が一瞬拡大して
 * 元に戻る「ポップ」演出のみで成立箇所を判別できるようにしている。
 */
export class AnimationEngine {
  /**
   * @param {(index: number) => HTMLElement} getCellElement セルindex(0-29)からDOM要素を取得する関数
   * @param {HTMLElement} popupLayerEl スコアポップアップを描画するオーバーレイ用DOM要素
   * @param {HTMLElement} bannerLayerEl コンボ演出バナーを表示する全画面レイヤー
   */
  constructor(getCellElement, popupLayerEl, bannerLayerEl) {
    this._getCellElement = getCellElement;
    this._popupLayerEl = popupLayerEl;
    this._bannerLayerEl = bannerLayerEl;
  }

  /**
   * 文字が切り替わった瞬間の軽い演出（スピン中、毎更新ごと）
   * @param {number} index
   */
  playCellChange(index) {
    const el = this._getCellElement(index);
    if (!el) return;
    el.classList.remove("cell-changing");
    void el.offsetWidth;
    el.classList.add("cell-changing");
  }

  /**
   * 役成立時、そのマスに「ボンッ」と拡大してから通常サイズへ戻る演出をかける。
   * どのマス同士で成立したかは、このポップ演出が同時に発生することで
   * 直感的に把握できるようにしている（ライン等の追加表現は行わない）。
   * @param {number[]} indices
   */
  playHit(indices) {
    for (const index of indices) {
      const el = this._getCellElement(index);
      if (!el) continue;
      el.classList.add("cell-fixed");
      el.classList.remove("cell-changing");

      el.classList.remove("cell-pop");
      void el.offsetWidth;
      el.classList.add("cell-pop");

      el.classList.add("cell-hit-flash");
      setTimeout(() => {
        el.classList.remove("cell-hit-flash");
      }, 500);
    }
  }

  /**
   * 「+100」のようなスコア加算エフェクトを、成立したマスの中心付近に表示する。
   * @param {Array<{a:number, b:number}>} results このtickで成立した役（複数可）
   * @param {number} scoreGained このtickで得た合計スコア（コンボなら合算値）
   */
  playScorePopup(results, scoreGained) {
    if (!this._popupLayerEl || scoreGained <= 0) return;

    const indices = results.flatMap((r) => [r.a, r.b]);
    const points = indices.map((i) => cellCenterPercent(i));
    const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
    const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;

    const popup = document.createElement("div");
    popup.className = "score-popup";
    popup.textContent = `+${scoreGained}`;
    popup.style.left = `${cx}%`;
    popup.style.top = `${cy}%`;

    this._popupLayerEl.appendChild(popup);
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

    // グリッド全体を軽く揺らして爽快感を強調する
    const grid = document.querySelector(".reel-grid");
    if (grid) {
      grid.classList.remove("grid-shake");
      void grid.offsetWidth;
      grid.classList.add("grid-shake");
    }
  }

  /**
   * スピン開始時、全セル・オーバーレイの演出状態をリセットする
   * @param {number} cellCount
   */
  resetAll(cellCount) {
    for (let i = 0; i < cellCount; i++) {
      const el = this._getCellElement(i);
      if (!el) continue;
      el.classList.remove("cell-fixed", "cell-hit-flash", "cell-changing", "cell-pop");
    }
    if (this._popupLayerEl) {
      this._popupLayerEl.innerHTML = "";
    }
    if (this._bannerLayerEl) {
      this._bannerLayerEl.innerHTML = "";
    }
  }
}
