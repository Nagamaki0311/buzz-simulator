import { RandomEngine } from "./RandomEngine.js";
import { DictionaryEngine } from "./DictionaryEngine.js";
import { ReelEngine } from "./ReelEngine.js";
import { JudgeEngine } from "./JudgeEngine.js";
import { buildLinePairs } from "../judge/gridLines.js";

const SPIN_DURATION_MS = 4000;

// 所持金システム関連の定数
const INITIAL_MONEY = 500; // 初期所持金(円)
const SPIN_COST = 30; // 1スピンの消費額(円)
// スコア→金額の換算レート。以前は100点=1円（1/100）としていたが、辞書を
// 63,904語へ戻し受理抽選で成立数を調整したことでスコア水準が変わったため、
// セッション継続スピン数（初期500円が尽きるまでのスピン回数）をシミュレーション
// して再調整した。0.08（100点=8円）で平均31.3回・中央値31回・範囲23〜39回
// （60セッション試行）となり、「運だけで極端に長続き/短命にならない」程度の
// 適度なばらつきに収まることを確認した（test/verify_money_rate.js参照）。
const SCORE_TO_MONEY_RATE = 0.08;

// 辞書一致時に実際に成立とみなす確率（0〜1）。辞書はJMdict全件+SKK-JISYO.Lの
// 63,904語というフルボリュームを使用しているため、そのままでは成立数が過多になる。
// 200回のシミュレーションにより、0.04で「0個成立:10%、1〜3個:74%、4〜6個:16%、
// 7個以上:0%、平均2.06個・最大5個」という目標に近い分布になることを確認した
// （test/verify_balance.js参照）。
const JUDGE_ACCEPTANCE_RATE = 0.04;

/**
 * GameEngine
 *
 * コアEngine（Random/Dictionary/Reel/Judge）と所持金システムを統括する。
 *
 * 【成立補正の撤廃について】
 * 以前はGameBalanceEngineによる「役が一定時間出ない場合に候補を近付ける」補正を
 * 実装していたが、成立数を適正化する方針への変更に伴い撤廃した。全マスは常に
 * RandomEngineによる完全均等ランダム抽選のみで更新される（補正・重み付け一切なし）。
 * GameBalanceEngine.js自体は将来の再利用に備えてファイルとしては残しているが、
 * このGameEngineからは呼び出していない。
 */
export class GameEngine {
  /**
   * @param {string[]} kanjiList kanji.jsonの内容
   * @param {Array<{word:string, reading:string, score:number}>} jukugoEntries jukugo_2.jsonの内容
   */
  constructor(kanjiList, jukugoEntries) {
    const linePairs = buildLinePairs();

    this.randomEngine = new RandomEngine(kanjiList);
    this.dictionaryEngine = new DictionaryEngine(jukugoEntries);
    this.reelEngine = new ReelEngine();
    this.judgeEngine = new JudgeEngine(linePairs, {
      acceptanceRate: JUDGE_ACCEPTANCE_RATE,
    });

    this.totalScore = 0;
    this.spinning = false;
    this._spinStartAt = 0;
    this._spinResults = [];
    this.spinScore = 0;
    this.maxComboThisSpin = 0;
    // セルindex -> そのマスが関与して成立した{word,reading}の配列（ツールチップ表示用）
    this._cellWordMap = new Map();

    this._initSession();
  }

  _initSession() {
    this.money = INITIAL_MONEY;
    this.sessionScore = 0;
    this.sessionPlayCount = 0;
    this.sessionMaxCombo = 0;
    this.gameOver = false;
    this._lastMoneyGain = 0;
  }

  /**
   * 「もう一度プレイ」時に所持金・セッション統計をすべて初期値へ戻す。
   */
  resetSession() {
    this._initSession();
  }

  /**
   * @returns {boolean} スピンを開始できるかどうか（所持金不足の場合はfalse）
   */
  canSpin() {
    return !this.gameOver && this.money >= SPIN_COST;
  }

  /**
   * @param {number} now 現在時刻(ms)
   * @returns {boolean} スピンを開始できたかどうか
   */
  startSpin(now) {
    if (!this.canSpin()) {
      this.gameOver = true;
      return false;
    }

    this.money -= SPIN_COST;

    const nextChar = () => this.randomEngine.next();
    this.reelEngine.reset(now, nextChar);
    this.spinning = true;
    this._spinStartAt = now;
    this._spinResults = [];
    this.spinScore = 0;
    this.maxComboThisSpin = 0;
    this._cellWordMap = new Map();

    return true;
  }

  /**
   * 1フレーム分の処理。
   * @param {number} now 現在時刻(ms)
   * @returns {{results: Array, score: number, n: number} | null} このフレームで新規成立した役（あれば）
   */
  tick(now) {
    if (!this.spinning) return null;

    if (now - this._spinStartAt >= SPIN_DURATION_MS) {
      this.spinning = false;
      this._settleSpin();
      return null;
    }

    const nextChar = () => this.randomEngine.next();
    // 補正なし・常に完全ランダム（overridesは常にnull）
    this.reelEngine.tick(now, nextChar, null);

    const { results, score, n } = this.judgeEngine.evaluate(
      this.reelEngine,
      this.dictionaryEngine
    );

    if (n > 0) {
      this.totalScore += score;
      this.spinScore += score;
      this._spinResults.push(...results);
      if (n > this.maxComboThisSpin) {
        this.maxComboThisSpin = n;
      }
      this._recordCellWords(results);
    }

    return n > 0 ? { results, score, n } : null;
  }

  _recordCellWords(results) {
    for (const r of results) {
      const entry = { word: r.word, reading: r.reading };
      for (const index of [r.a, r.b]) {
        if (!this._cellWordMap.has(index)) {
          this._cellWordMap.set(index, []);
        }
        this._cellWordMap.get(index).push(entry);
      }
    }
  }

  /**
   * ツールチップ表示用。指定マスが関与して成立した熟語の一覧を返す。
   * @param {number} index
   * @returns {Array<{word:string, reading:string}>}
   */
  getWordsAtCell(index) {
    return this._cellWordMap.get(index) || [];
  }

  /**
   * スピン終了時に1回だけ呼ばれる。スコアを所持金へ換算して加算し、
   * セッション統計を更新し、ゲームオーバー判定を行う。
   */
  _settleSpin() {
    const moneyGain = Math.floor(this.spinScore * SCORE_TO_MONEY_RATE);
    this.money += moneyGain;
    this._lastMoneyGain = moneyGain;

    this.sessionScore += this.spinScore;
    this.sessionPlayCount += 1;
    if (this.maxComboThisSpin > this.sessionMaxCombo) {
      this.sessionMaxCombo = this.maxComboThisSpin;
    }

    if (this.money < SPIN_COST) {
      this.gameOver = true;
    }
  }

  isSpinning(now) {
    return this.spinning && now - this._spinStartAt < SPIN_DURATION_MS;
  }

  getState() {
    return {
      grid: this.reelEngine.getGrid(),
      fixedFlags: this.reelEngine.getFixedFlags(),
      totalScore: this.totalScore,
      spinScore: this.spinScore,
      spinResults: this._spinResults,
      spinning: this.spinning,
      maxComboThisSpin: this.maxComboThisSpin,
      money: this.money,
      lastMoneyGain: this._lastMoneyGain,
      sessionScore: this.sessionScore,
      sessionPlayCount: this.sessionPlayCount,
      sessionMaxCombo: this.sessionMaxCombo,
      gameOver: this.gameOver,
    };
  }

  /**
   * @param {number} now
   * @returns {number} スピン開始からの経過時間(ms)
   */
  getSpinElapsedMs(now) {
    return now - this._spinStartAt;
  }
}

export {
  SPIN_DURATION_MS,
  INITIAL_MONEY,
  SPIN_COST,
  SCORE_TO_MONEY_RATE,
  JUDGE_ACCEPTANCE_RATE,
};
