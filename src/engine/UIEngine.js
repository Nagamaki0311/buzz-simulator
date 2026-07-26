import { buildLinePairs, cellCenterPercent } from "../judge/gridLines.js";

/**
 * UIEngine
 *
 * DOMの描画とユーザー入力（SPINボタン・設定変更・リザルト画面の再プレイ・
 * 成立マスのツールチップ表示）のバインディングを担当する。GameEngineの状態を
 * 「表示用に変換」するのみで、正のゲーム状態はGameEngineが保持する
 * （このEngineはGameEngineの状態を直接書き換えない）。
 *
 * 各セルは <div class="cell"><span class="cell-char">文字</span></div> という
 * 構造にしている。成立時の拡大演出（cell-pop）を内側のspanのみに適用することで、
 * マス自体のサイズ・レイアウトを変えずに文字だけが拡大するようにするため。
 */
export class UIEngine {
  /**
   * @param {{root: HTMLElement, gameEngine: import("./GameEngine.js").GameEngine, audioEngine: import("./AudioEngine.js").AudioEngine, createAnimationEngine: (getCharElement: (i:number)=>HTMLElement, getCellElement: (i:number)=>HTMLElement, effectLayerEl: HTMLElement, bannerLayerEl: HTMLElement) => import("./AnimationEngine.js").AnimationEngine}} params
   */
  constructor({ root, gameEngine, audioEngine, createAnimationEngine }) {
    this.root = root;
    this.gameEngine = gameEngine;
    this.audioEngine = audioEngine;

    this._cellElements = [];
    this._cellCharElements = [];
    this._prevGrid = [];
    this._debugVisible = false;

    this._buildDom();

    const effectLayerEl = this.root.querySelector('[data-role="effect-layer"]');
    const bannerLayerEl = this.root.querySelector('[data-role="banner-layer"]');
    // セルDOM構築後にAnimationEngineを生成する（getterがセル要素配列を参照するため）
    this.animationEngine = createAnimationEngine(
      (i) => this._cellCharElements[i],
      (i) => this._cellElements[i],
      effectLayerEl,
      bannerLayerEl
    );

    this._bindEvents();
  }

  _buildDom() {
    this.root.innerHTML = `
      <div class="jukugo-slot">
        <header class="header">
          <h1 class="title">熟語スロット</h1>
          <p class="subtitle">常用漢字二千百三十六字による国語スロット</p>
        </header>

        <div class="score-panel">
          <div class="score-item">
            <span class="score-label">所持金</span>
            <span class="score-value score-value-money" data-role="money">500円</span>
          </div>
          <div class="score-item">
            <span class="score-label">現在のスコア</span>
            <span class="score-value" data-role="current-score">0</span>
          </div>
        </div>

        <div class="reel-grid-wrapper">
          <div class="reel-grid" data-role="reel-grid"></div>
          <svg class="judge-lines-overlay" data-role="judge-lines-overlay" hidden></svg>
          <div class="effect-layer" data-role="effect-layer"></div>
          <div class="banner-layer" data-role="banner-layer"></div>
          <div class="word-tooltip" data-role="word-tooltip" hidden></div>
        </div>

        <div class="controls">
          <button class="spin-button" data-role="spin-button">SPIN（30円）</button>
          <label class="debug-toggle">
            <input type="checkbox" data-role="debug-toggle" />
            デバッグモード
          </label>
        </div>

        <div class="result-panel">
          <h2 class="result-heading">成立熟語一覧</h2>
          <ul class="result-list" data-role="result-list"></ul>
        </div>

        <div class="stats-panel">
          <span>総プレイ回数: <span data-role="total-play-count">0</span></span>
          <span>最高コンボ: <span data-role="max-combo">0</span></span>
          <span>累計獲得熟語数: <span data-role="total-words-found">0</span></span>
        </div>

        <div class="debug-panel" data-role="debug-panel" hidden>
          <div>FPS: <span data-role="debug-fps">-</span></div>
          <div>辞書検索時間(直近評価/ms): <span data-role="debug-search-time">-</span></div>
          <div class="debug-log" data-role="debug-log"></div>
        </div>

        <div class="result-overlay" data-role="result-overlay" hidden>
          <div class="result-card">
            <h2 class="result-card-heading">ゲームオーバー</h2>
            <p class="result-card-sub">所持金が尽きました</p>
            <dl class="result-card-stats">
              <div><dt>最終スコア</dt><dd data-role="result-final-score">0</dd></div>
              <div><dt>最終所持金</dt><dd data-role="result-final-money">0円</dd></div>
              <div><dt>最大コンボ</dt><dd data-role="result-max-combo">0</dd></div>
              <div><dt>プレイ回数</dt><dd data-role="result-play-count">0</dd></div>
            </dl>
            <button class="result-replay-button" data-role="result-replay-button">もう一度プレイ</button>
          </div>
        </div>
      </div>
    `;

    const grid = this.root.querySelector('[data-role="reel-grid"]');
    for (let i = 0; i < this.gameEngine.reelEngine.cellCount; i++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.index = String(i);

      const charEl = document.createElement("span");
      charEl.className = "cell-char";
      cell.appendChild(charEl);

      grid.appendChild(cell);
      this._cellElements.push(cell);
      this._cellCharElements.push(charEl);

      cell.addEventListener("mouseenter", () => this._showTooltipForCell(i, cell));
      cell.addEventListener("mouseleave", () => this._hideTooltip());
    }

    this._buildJudgeLinesOverlay();
  }

  _buildJudgeLinesOverlay() {
    const svg = this.root.querySelector('[data-role="judge-lines-overlay"]');
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("preserveAspectRatio", "none");

    const colorByType = {
      horizontal: "rgba(166, 56, 44, 0.35)",
      vertical: "rgba(139, 110, 78, 0.45)",
      diagonal: "rgba(35, 33, 29, 0.3)",
    };

    const lines = buildLinePairs();
    const fragment = document.createDocumentFragment();
    for (const pair of lines) {
      const p1 = cellCenterPercent(pair.a);
      const p2 = cellCenterPercent(pair.b);
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", String(p1.x));
      line.setAttribute("y1", String(p1.y));
      line.setAttribute("x2", String(p2.x));
      line.setAttribute("y2", String(p2.y));
      line.setAttribute("stroke", colorByType[pair.type] || "rgba(0,0,0,0.2)");
      line.setAttribute("stroke-width", "0.5");
      fragment.appendChild(line);
    }
    svg.appendChild(fragment);
  }

  /**
   * 成立済みマスにカーソルを合わせたとき、そのマスが関与して成立した
   * 熟語（複数ありうる）をツールチップで表示する。
   */
  _showTooltipForCell(index, cellEl) {
    const words = this.gameEngine.getWordsAtCell(index);
    if (!words || words.length === 0) return;

    const tooltip = this.root.querySelector('[data-role="word-tooltip"]');
    tooltip.innerHTML = words
      .map((w) => `<div>${w.word}（${w.reading}）</div>`)
      .join("");

    const wrapperRect = this.root
      .querySelector(".reel-grid-wrapper")
      .getBoundingClientRect();
    const cellRect = cellEl.getBoundingClientRect();
    const left = cellRect.left - wrapperRect.left + cellRect.width / 2;
    const top = cellRect.top - wrapperRect.top;

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    tooltip.hidden = false;
  }

  _hideTooltip() {
    const tooltip = this.root.querySelector('[data-role="word-tooltip"]');
    tooltip.hidden = true;
  }

  _bindEvents() {
    const spinButton = this.root.querySelector('[data-role="spin-button"]');
    spinButton.addEventListener("click", () => {
      this.audioEngine.play("buttonPress");
      this._onSpinRequested?.();
    });

    const debugToggle = this.root.querySelector('[data-role="debug-toggle"]');
    debugToggle.addEventListener("change", (e) => {
      this._debugVisible = e.target.checked;
      const panel = this.root.querySelector('[data-role="debug-panel"]');
      panel.hidden = !this._debugVisible;
      const overlay = this.root.querySelector('[data-role="judge-lines-overlay"]');
      overlay.hidden = !this._debugVisible;
      this._onSettingsChanged?.({ debug: this._debugVisible });
    });

    const replayButton = this.root.querySelector('[data-role="result-replay-button"]');
    replayButton.addEventListener("click", () => {
      this.audioEngine.play("buttonPress");
      this._onReplayRequested?.();
    });
  }

  /** @param {() => void} handler */
  onSpinRequested(handler) {
    this._onSpinRequested = handler;
  }

  /** @param {(partialSettings: object) => void} handler */
  onSettingsChanged(handler) {
    this._onSettingsChanged = handler;
  }

  /** @param {() => void} handler */
  onReplayRequested(handler) {
    this._onReplayRequested = handler;
  }

  setDebugVisible(visible) {
    this._debugVisible = visible;
    const toggle = this.root.querySelector('[data-role="debug-toggle"]');
    const panel = this.root.querySelector('[data-role="debug-panel"]');
    const overlay = this.root.querySelector('[data-role="judge-lines-overlay"]');
    toggle.checked = visible;
    panel.hidden = !visible;
    overlay.hidden = !visible;
  }

  setSpinButtonEnabled(enabled) {
    const spinButton = this.root.querySelector('[data-role="spin-button"]');
    spinButton.disabled = !enabled;
  }

  /**
   * 毎フレーム呼び出し、GameEngineの状態をDOMへ反映する。
   * 「現在のスコア」は、このゲーム（セッション）で完了したスピンの合計
   * （sessionScore）に、進行中のスピンのスコア（spinScore）を加えたもの。
   * @param {object} state GameEngine.getState()の結果
   */
  render(state) {
    for (let i = 0; i < state.grid.length; i++) {
      const cellEl = this._cellElements[i];
      const charEl = this._cellCharElements[i];
      const char = state.grid[i] || "";
      if (charEl.textContent !== char) {
        charEl.textContent = char;
        if (this._prevGrid[i] !== char && !state.fixedFlags[i]) {
          this.animationEngine.playCellChange(i);
        }
      }
      cellEl.classList.toggle("cell-fixed", !!state.fixedFlags[i]);
    }
    this._prevGrid = state.grid.slice();

    const currentScore = (state.sessionScore || 0) + (state.spinScore || 0);
    this.root.querySelector('[data-role="current-score"]').textContent =
      String(currentScore);
    this.root.querySelector('[data-role="money"]').textContent = `${state.money}円`;

    const spinButton = this.root.querySelector('[data-role="spin-button"]');
    if (!state.spinning) {
      spinButton.textContent =
        state.pendingReplays > 0 ? "SPIN（リプレイ）" : "SPIN（30円）";
    }
  }

  /**
   * リプレイ成立時、目立つ「REPLAY」演出を表示する。
   */
  onReplayTriggered() {
    this.animationEngine.playReplayBanner();
  }

  /**
   * @param {{results: Array<{a:number,b:number,word:string, reading:string, type:string}>, score:number, n:number}} hit
   */
  onHit(hit) {
    this.audioEngine.play("hit");
    this.animationEngine.playHit(hit.results.flatMap((r) => [r.a, r.b]));
    this.animationEngine.playScorePopup(hit.results, hit.score);
    if (hit.n >= 2) {
      this.animationEngine.playComboBanner(hit.n, hit.score);
    }

    const list = this.root.querySelector('[data-role="result-list"]');
    for (const r of hit.results) {
      const li = document.createElement("li");
      li.textContent = `${r.word}（${r.reading}）`;
      list.prepend(li);
    }
  }

  clearResultList() {
    this.root.querySelector('[data-role="result-list"]').innerHTML = "";
  }

  /**
   * @param {{totalPlayCount:number, maxCombo:number, totalWordsFound:number}} data
   */
  renderStats(data) {
    this.root.querySelector('[data-role="total-play-count"]').textContent = String(
      data.totalPlayCount
    );
    this.root.querySelector('[data-role="max-combo"]').textContent = String(
      data.maxCombo
    );
    this.root.querySelector('[data-role="total-words-found"]').textContent = String(
      data.totalWordsFound
    );
  }

  /**
   * @param {{fps:number, lastSearchTimeMs:number}} debugInfo
   */
  renderDebug(debugInfo) {
    if (!this._debugVisible) return;
    this.root.querySelector('[data-role="debug-fps"]').textContent =
      debugInfo.fps.toFixed(1);
    this.root.querySelector('[data-role="debug-search-time"]').textContent =
      debugInfo.lastSearchTimeMs.toFixed(3);
  }

  appendDebugLog(line) {
    if (!this._debugVisible) return;
    const log = this.root.querySelector('[data-role="debug-log"]');
    const p = document.createElement("div");
    p.textContent = line;
    log.prepend(p);
    while (log.childNodes.length > 50) {
      log.removeChild(log.lastChild);
    }
  }

  /**
   * ゲームオーバー時のリザルト画面を表示する。
   * @param {{sessionScore:number, money:number, sessionMaxCombo:number, sessionPlayCount:number}} state
   */
  showResultOverlay(state) {
    this.root.querySelector('[data-role="result-final-score"]').textContent = String(
      state.sessionScore
    );
    this.root.querySelector('[data-role="result-final-money"]').textContent =
      `${state.money}円`;
    this.root.querySelector('[data-role="result-max-combo"]').textContent = String(
      state.sessionMaxCombo
    );
    this.root.querySelector('[data-role="result-play-count"]').textContent = String(
      state.sessionPlayCount
    );

    const overlay = this.root.querySelector('[data-role="result-overlay"]');
    overlay.hidden = false;
  }

  hideResultOverlay() {
    const overlay = this.root.querySelector('[data-role="result-overlay"]');
    overlay.hidden = true;
  }
}
