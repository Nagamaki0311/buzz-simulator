/**
 * JudgeEngine
 *
 * 毎フレーム、gridLines.buildLinePairs()で定義された63ペア（横縦斜めのみ）について
 * DictionaryEngine.has()（O(1)のHash検索）で判定する。辞書全探索は行わない。
 *
 * 【受理抽選（acceptanceRate）について】
 * 辞書は63,904語というフルボリュームを使用しているため、辞書上の一致だけを
 * そのまま成立とすると1スピンあたりの成立数が過多になる（実測で平均20語超）。
 * これを辞書側の削減ではなく判定側で調整するため、辞書に一致した候補に対して
 * さらに acceptanceRate の確率で「本当に成立とするか」を抽選する。
 * 外れた候補はそのマスを固定せず、そのまま通常のランダム更新を継続する
 * （次回別の組み合わせで再度自然に一致・抽選するチャンスがある）。
 * RandomEngine（文字そのものの抽選）とは独立した、別レイヤーの抽選である。
 *
 * スコア計算: 1回のevaluate()呼び出しで新規に成立した語数をnとし、
 * score(n) = 100 * (2^n - 1) とする（Phase1で確定した仕様。
 * n=1→100, n=2→300, n=3→700, n=4→1500, ...）。
 */
export class JudgeEngine {
  /**
   * @param {Array<{type: string, a: number, b: number}>} linePairs gridLines.buildLinePairs()の結果
   * @param {{acceptanceRate?: number}} [options] acceptanceRate: 辞書一致時に実際に成立とみなす確率(0〜1)。
   *   省略時は1.0（常に成立＝抽選なし）。
   */
  constructor(linePairs, options = {}) {
    this._linePairs = linePairs;
    this._acceptanceRate =
      options.acceptanceRate == null ? 1.0 : options.acceptanceRate;
  }

  /**
   * acceptanceRateを実行時に変更する（ジャックポット抽選でスピンごとに
   * 一時的にレートを引き上げるために使用する）。
   * @param {number} rate
   */
  setAcceptanceRate(rate) {
    this._acceptanceRate = rate;
  }

  /**
   * @param {import("./ReelEngine.js").ReelEngine} reelEngine
   * @param {import("./DictionaryEngine.js").DictionaryEngine} dictionaryEngine
   * @returns {{results: Array<{type:string,a:number,b:number,word:string,reading:string}>, score: number, n: number}}
   */
  evaluate(reelEngine, dictionaryEngine) {
    const grid = reelEngine.getGrid();
    const fixedFlags = reelEngine.getFixedFlags();
    const changedIndices = reelEngine.getChangedIndices();

    const results = [];

    for (const pair of this._linePairs) {
      const { a, b } = pair;

      // 既に両マスとも固定済み（＝このペアは以前のフレームで確定済み）はスキップ
      if (fixedFlags[a] && fixedFlags[b]) continue;

      // どちらのマスも今回変化していなければ、既に判定・抽選済みの組み合わせが
      // そのまま残っているだけなので、再度の判定・抽選は行わない
      if (!changedIndices.has(a) && !changedIndices.has(b)) continue;

      const charA = grid[a];
      const charB = grid[b];
      if (charA == null || charB == null) continue;

      const word = charA + charB;
      const entry = dictionaryEngine.getEntry(word);
      if (!entry) continue;

      // 受理抽選：辞書に一致していても、この確率を外れた場合は成立させない
      if (Math.random() >= this._acceptanceRate) continue;

      results.push({
        type: pair.type,
        a,
        b,
        word: entry.word,
        reading: entry.reading,
      });
    }

    // 新規成立したマスをすべて固定する
    const toFix = new Set();
    for (const r of results) {
      toFix.add(r.a);
      toFix.add(r.b);
    }
    for (const index of toFix) {
      reelEngine.fixCell(index);
    }

    const n = results.length;
    const score = n > 0 ? 100 * (2 ** n - 1) : 0;

    return { results, score, n };
  }
}
