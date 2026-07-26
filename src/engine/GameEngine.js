import { RandomEngine } from "./RandomEngine.js";
import { DictionaryEngine } from "./DictionaryEngine.js";
import { ReelEngine } from "./ReelEngine.js";
import { JudgeEngine } from "./JudgeEngine.js";
import { buildLinePairs } from "../judge/gridLines.js";

const SPIN_DURATION_MS = 4000;

// 所持金システム関連の定数
const INITIAL_MONEY = 500; // 初期所持金(円)
const SPIN_COST = 30; // 1スピンの消費額(円)
// スコア→金額の換算レート。セッション継続スピン数（初期500円が尽きるまでの
// スピン回数）をシミュレーションして決定した。0.08（100点=8円）で
// 平均31.3回・範囲23〜39回（60セッション試行）となることを確認済み
// （test/verify_money_rate.js）。リプレイ導入後も大枠は変えていない。
const SCORE_TO_MONEY_RATE = 0.08;

/**
 * 【成立数抽選（3階層）について】
 * 辞書は63,904語のフルボリュームを使用しているため、辞書一致をそのまま
 * 成立とすると成立数が過多になる。JudgeEngineの受理抽選（acceptanceRate）で
 * 頻度を調整しているが、単一の確率だけでは「上振れ（大量成立）」が
 * ほぼ発生しない釣鐘型の分布になってしまう。
 * このため、スピンごとに3段階の抽選で「そのスピンで使うacceptanceRate」を
 * 決めている。
 *   - base  : 通常時のレート（ほとんどのスピン）
 *   - boost : 低確率で少し高いレートになり、7〜10個程度の成立を生む
 *   - jackpot: 極低確率で大幅に高いレートになり、演出的な大量成立
 *              （10〜20個超、理論上は最大30近くまで）を生む
 * 2000〜8000回のシミュレーションにより、以下の値で目標分布
 * 「0個:10〜20%、1〜3個:65〜75%、4〜6個:10〜20%、7〜10個:2〜5%、
 * 11個以上:0.02〜0.5%」に収まることを確認した（test/verify_jackpot.js）。
 */
const JUDGE_ACCEPTANCE_RATE_BASE = 0.045;
const JUDGE_ACCEPTANCE_RATE_BOOST = 0.14;
const JUDGE_BOOST_CHANCE = 0.06;
const JUDGE_ACCEPTANCE_RATE_JACKPOT = 0.6;
const JUDGE_JACKPOT_CHANCE = 0.0008;

/**
 * 【リプレイシステムについて】
 * 以下のいずれかが成立した場合、そのスピン中に「REPLAY」を発生させ、
 * 所持金を消費せずにもう一度スピンできる（連続発生も可）。
 *   (a) 畳語（同じ漢字2字の熟語、例:「時時」）が辞書上で成立した場合
 *       → JudgeEngineの通常の成立判定結果からword[0]===word[1]を検出する
 *   (b) 辞書に一致するかどうかに関わらず、隣接する2マスが同じ漢字になった場合
 *       → こちらは辞書判定と無関係の盤面状態のみで判定するため、
 *         そのままでは約78%のスピンで発生してしまう（1スピンあたり
 *         2136字からの独立抽選が63ペア×多数回行われるため）。
 *         そのためJUDGE_ACCEPTANCE_RATEとは別に、リプレイ専用の受理抽選
 *         REPLAY_ADJACENT_ACCEPTANCE_RATEを設けて頻度を落としている。
 *         0.03で「約4.5%のスピンで少なくとも1回発生」となることを確認した
 *         （test/verify_replay_freq.js）。(a)は辞書中の畳語が326/63,904語と
 *         希少なため、追加の抽選なしでも十分低頻度（試算で約1.2%のスピン）。
 */
const REPLAY_ADJACENT_ACCEPTANCE_RATE = 0.03;

/**
 * GameEngine
 *
 * コアEngine（Random/Dictionary/Reel/Judge）、所持金システム、
 * 成立数抽選（ジャックポット階層）、リプレイシステムを統括する。
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
    this._linePairs = buildLinePairs();

    this.randomEngine = new RandomEngine(kanjiList);
    this.dictionaryEngine = new DictionaryEngine(jukugoEntries);
    this.reelEngine = new ReelEngine();
    this.judgeEngine = new JudgeEngine(this._linePairs, {
      acceptanceRate: JUDGE_ACCEPTANCE_RATE_BASE,
    });

    this.totalScore = 0;
    this.spinning = false;
    this._spinStartAt = 0;
    this._spinResults = [];
    this.spinScore = 0;
    this.maxComboThisSpin = 0;
    this.spinTier = "base";
    this.isReplaySpin = false;
    this._pendingReplays = 0;
    this.replayCountThisSpin = 0;
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
    this._pendingReplays = 0;
  }

  /**
   * 「もう一度プレイ」時に所持金・セッション統計をすべて初期値へ戻す。
   */
  resetSession() {
    this._initSession();
  }

  /**
   * @returns {boolean} スピンを開始できるかどうか
   *   （所持金不足でも、リプレイ権が残っていれば開始できる）
   */
  canSpin() {
    return !this.gameOver && (this.money >= SPIN_COST || this._pendingReplays > 0);
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

    if (this._pendingReplays > 0) {
      this._pendingReplays -= 1;
      this.isReplaySpin = true;
    } else {
      this.money -= SPIN_COST;
      this.isReplaySpin = false;
    }

    this._rollSpinTier();

    const nextChar = () => this.randomEngine.next();
    this.reelEngine.reset(now, nextChar);
    this.spinning = true;
    this._spinStartAt = now;
    this._spinResults = [];
    this.spinScore = 0;
    this.maxComboThisSpin = 0;
    this.replayCountThisSpin = 0;
    this._cellWordMap = new Map();

    return true;
  }

  /**
   * このスピンで使用するJudgeEngineのacceptanceRateを3階層抽選で決める。
   */
  _rollSpinTier() {
    let tier = "base";
    let rate = JUDGE_ACCEPTANCE_RATE_BASE;

    if (Math.random() < JUDGE_JACKPOT_CHANCE) {
      tier = "jackpot";
      rate = JUDGE_ACCEPTANCE_RATE_JACKPOT;
    } else if (Math.random() < JUDGE_BOOST_CHANCE) {
      tier = "boost";
      rate = JUDGE_ACCEPTANCE_RATE_BOOST;
    }

    this.spinTier = tier;
    this.judgeEngine.setAcceptanceRate(rate);
  }

  /**
   * 1フレーム分の処理。
   * @param {number} now 現在時刻(ms)
   * @returns {{results: Array, score: number, n: number, replayTriggered: boolean} | null}
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

    let replayTriggered = false;

    if (n > 0) {
      this.totalScore += score;
      this.spinScore += score;
      this._spinResults.push(...results);
      if (n > this.maxComboThisSpin) {
        this.maxComboThisSpin = n;
      }
      this._recordCellWords(results);

      // リプレイ条件(a): 畳語（同じ漢字2字）の成立
      for (const r of results) {
        if (r.word[0] === r.word[1]) {
          replayTriggered = true;
          break;
        }
      }
    }

    // リプレイ条件(b): 辞書一致に関わらず、隣接する2マスが同じ漢字
    if (this._checkAdjacentSameChar()) {
      replayTriggered = true;
    }

    if (replayTriggered) {
      this._pendingReplays += 1;
      this.replayCountThisSpin += 1;
    }

    if (n === 0 && !replayTriggered) return null;
    return { results, score, n, replayTriggered };
  }

  /**
   * リプレイ条件(b)の判定。辞書判定とは独立に、盤面上で隣接する2マスが
   * 同じ漢字になっている組み合わせを探す。今回変化したマスが関わる
   * ペアのみを対象とする（JudgeEngineと同様、重複抽選を避けるため）。
   * @returns {boolean}
   */
  _checkAdjacentSameChar() {
    const grid = this.reelEngine.getGrid();
    const changed = this.reelEngine.getChangedIndices();

    for (const pair of this._linePairs) {
      const { a, b } = pair;
      if (!changed.has(a) && !changed.has(b)) continue;

      const charA = grid[a];
      const charB = grid[b];
      if (charA == null || charB == null) continue;
      if (charA !== charB) continue;

      if (Math.random() < REPLAY_ADJACENT_ACCEPTANCE_RATE) {
        return true;
      }
    }
    return false;
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
   * リプレイ権が残っている場合は、所持金が尽きていてもゲームオーバーにしない。
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

    if (this.money < SPIN_COST && this._pendingReplays <= 0) {
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
      spinTier: this.spinTier,
      isReplaySpin: this.isReplaySpin,
      pendingReplays: this._pendingReplays,
      replayCountThisSpin: this.replayCountThisSpin,
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
  JUDGE_ACCEPTANCE_RATE_BASE,
  JUDGE_ACCEPTANCE_RATE_BOOST,
  JUDGE_BOOST_CHANCE,
  JUDGE_ACCEPTANCE_RATE_JACKPOT,
  JUDGE_JACKPOT_CHANCE,
  REPLAY_ADJACENT_ACCEPTANCE_RATE,
};
