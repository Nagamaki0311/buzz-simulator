import { ROWS, COLS } from "../judge/gridLines.js";

const CELL_COUNT = ROWS * COLS; // 30
const UPDATE_INTERVAL_MIN_MS = 100;
const UPDATE_INTERVAL_MAX_MS = 160;

function randomInterval() {
  return (
    UPDATE_INTERVAL_MIN_MS +
    Math.random() * (UPDATE_INTERVAL_MAX_MS - UPDATE_INTERVAL_MIN_MS)
  );
}

/**
 * ReelEngine
 *
 * 30マス（5行×6列）のセル状態を保持する。
 * 各セルは100〜160msごとに独立して文字を更新する（全セル独立更新）。
 * 固定されたセルは更新を停止する。
 * 
 * 更新間隔は当初30〜50ms/6秒スピンだったが、成立頻度が過多（平均23語/スピン、
 * 目標2〜5語/スピン）だったため、100ms以上・4秒スピンへ変更した。
 */
export class ReelEngine {
  constructor() {
    this._cells = new Array(CELL_COUNT).fill(null).map(() => ({
      char: null,
      fixed: false,
      nextUpdateAt: 0,
    }));
  }

  /**
   * スピン開始時の初期化。全セルを未固定にし、初期文字を設定する。
   * @param {number} now 現在時刻(ms)
   * @param {() => string} nextCharFn 通常はRandomEngine.next()
   */
  reset(now, nextCharFn) {
    for (const cell of this._cells) {
      cell.char = nextCharFn();
      cell.fixed = false;
      cell.nextUpdateAt = now + randomInterval();
    }
  }

  /**
   * 1フレーム分の更新。固定されていないセルのうち、更新タイミングに達したものだけを
   * 更新する。overridesに指定があるセルはそちらを優先し、一度使ったら消費する。
   *
   * @param {number} now 現在時刻(ms)
   * @param {() => string} defaultNextCharFn 通常はRandomEngine.next()
   * @param {Map<number,string> | null} overrides GameBalanceEngineからの候補提案（消費型）
   */
  tick(now, defaultNextCharFn, overrides = null) {
    for (let i = 0; i < this._cells.length; i++) {
      const cell = this._cells[i];
      if (cell.fixed) continue;
      if (now < cell.nextUpdateAt) continue;

      if (overrides && overrides.has(i)) {
        cell.char = overrides.get(i);
        overrides.delete(i);
      } else {
        cell.char = defaultNextCharFn();
      }
      cell.nextUpdateAt = now + randomInterval();
    }
  }

  /**
   * @param {number} index セルインデックス(0-29)
   */
  fixCell(index) {
    this._cells[index].fixed = true;
  }

  isFixed(index) {
    return this._cells[index].fixed;
  }

  /**
   * @returns {string[]} 30マス分の文字配列
   */
  getGrid() {
    return this._cells.map((c) => c.char);
  }

  /**
   * @returns {boolean[]} 30マス分の固定フラグ配列
   */
  getFixedFlags() {
    return this._cells.map((c) => c.fixed);
  }

  get cellCount() {
    return CELL_COUNT;
  }
}
