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
 *
 * 【変化イベントの追跡について】
 * JudgeEngineの受理抽選（acceptanceRate）が「同一の未変化の組み合わせに対して
 * 毎フレーム何度も再抽選してしまう」不具合を防ぐため、直近のtick()/reset()で
 * 実際に文字が更新されたセルのindexを_changedThisTickとして保持する。
 * JudgeEngineはこれを参照し、両端のセルがどちらも変化していないペアは
 * 判定対象から除外する（＝一致していても実際に「今起きた一致」でなければ
 * 抽選しない）。
 */
export class ReelEngine {
  constructor() {
    this._cells = new Array(CELL_COUNT).fill(null).map(() => ({
      char: null,
      fixed: false,
      nextUpdateAt: 0,
    }));
    this._changedThisTick = new Set();
  }

  /**
   * スピン開始時の初期化。全セルを未固定にし、初期文字を設定する。
   * 初期配置も「変化」として扱う（全セルがchangedThisTickに含まれる）。
   * @param {number} now 現在時刻(ms)
   * @param {() => string} nextCharFn 通常はRandomEngine.next()
   */
  reset(now, nextCharFn) {
    this._changedThisTick = new Set();
    for (let i = 0; i < this._cells.length; i++) {
      const cell = this._cells[i];
      cell.char = nextCharFn();
      cell.fixed = false;
      cell.nextUpdateAt = now + randomInterval();
      this._changedThisTick.add(i);
    }
  }

  /**
   * 1フレーム分の更新。固定されていないセルのうち、更新タイミングに達したものだけを
   * 更新する。overridesに指定があるセルはそちらを優先し、一度使ったら消費する。
   *
   * @param {number} now 現在時刻(ms)
   * @param {() => string} defaultNextCharFn 通常はRandomEngine.next()
   * @param {Map<number,string> | null} overrides 候補提案（消費型）。現在は常にnull。
   */
  tick(now, defaultNextCharFn, overrides = null) {
    this._changedThisTick = new Set();

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
      this._changedThisTick.add(i);
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

  /**
   * 直近のreset()/tick()で実際に文字が更新されたセルのindex集合。
   * @returns {Set<number>}
   */
  getChangedIndices() {
    return this._changedThisTick;
  }

  get cellCount() {
    return CELL_COUNT;
  }
}
