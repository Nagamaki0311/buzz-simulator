/**
 * JudgeEngine
 *
 * 毎フレーム、gridLines.buildLinePairs()で定義された63ペア（横縦斜めのみ）について
 * DictionaryEngine.has()（O(1)のHash検索）で判定する。辞書全探索は行わない。
 *
 * スコア計算: 1回のevaluate()呼び出しで新規に成立した語数をnとし、
 * score(n) = 100 * (2^n - 1) とする（Phase1で確定した仕様。
 * n=1→100, n=2→300, n=3→700, n=4→1500, ...）。
 */
export class JudgeEngine {
  /**
   * @param {Array<{type: string, a: number, b: number}>} linePairs gridLines.buildLinePairs()の結果
   */
  constructor(linePairs) {
    this._linePairs = linePairs;
  }

  /**
   * @param {import("./ReelEngine.js").ReelEngine} reelEngine
   * @param {import("./DictionaryEngine.js").DictionaryEngine} dictionaryEngine
   * @returns {{results: Array<{type:string,a:number,b:number,word:string,reading:string}>, score: number, n: number}}
   */
  evaluate(reelEngine, dictionaryEngine) {
    const grid = reelEngine.getGrid();
    const fixedFlags = reelEngine.getFixedFlags();

    const results = [];

    for (const pair of this._linePairs) {
      const { a, b } = pair;

      // 既に両マスとも固定済み（＝このペアは以前のフレームで確定済み）はスキップ
      if (fixedFlags[a] && fixedFlags[b]) continue;

      const charA = grid[a];
      const charB = grid[b];
      if (charA == null || charB == null) continue;

      const word = charA + charB;
      const entry = dictionaryEngine.getEntry(word);
      if (entry) {
        results.push({
          type: pair.type,
          a,
          b,
          word: entry.word,
          reading: entry.reading,
        });
      }
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
