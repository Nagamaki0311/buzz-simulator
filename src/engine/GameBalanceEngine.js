/**
 * 【注記】このクラスは現在GameEngineから呼び出されていません。
 * 成立数を適正化する方針への変更（完全ランダム抽選への統一）に伴い、
 * GameEngine.jsから本クラスの利用を撤廃しました。将来的に難易度モード等で
 * 再度利用する可能性を考慮し、ファイル自体は削除せず残しています。
 *
 * GameBalanceEngine
 *
 * RandomEngineを書き換えず、RandomEngineの結果も書き換えない。
 * 「次にどのセルにどの文字を置くと熟語に近づくか」という候補を提案するだけの
 * 独立したクラス。DictionaryEngine・RandomEngineとは完全に分離している。
 *
 * 発動条件（Phase0仕様）:
 *   - バランスモードのときのみ動作する（完全ランダムモードでは常にnullを返す）
 *   - 直近の役成立から一定時間（既定1700ms、4秒スピンに対する比率は当初の2500ms/6秒と同じ）役が出ていない場合のみ動作する
 *   - 1回の提案につき、1マス・1文字のみ提案する
 */

const SUGGEST_AFTER_MS = 1700;

export class GameBalanceEngine {
  /**
   * @param {Array<{type: string, a: number, b: number}>} linePairs
   */
  constructor(linePairs) {
    this._linePairs = linePairs;
  }

  /**
   * @param {import("./ReelEngine.js").ReelEngine} reelEngine
   * @param {import("./DictionaryEngine.js").DictionaryEngine} dictionaryEngine
   * @param {number} elapsedSinceLastHitMs 直近の役成立からの経過時間(ms)
   * @param {"random"|"balance"} mode 現在のモード
   * @returns {Map<number,string> | null} セルインデックス->提案する文字（最大1件）
   */
  suggestNext(reelEngine, dictionaryEngine, elapsedSinceLastHitMs, mode) {
    if (mode !== "balance") return null;
    if (elapsedSinceLastHitMs < SUGGEST_AFTER_MS) return null;

    const grid = reelEngine.getGrid();
    const fixedFlags = reelEngine.getFixedFlags();

    const shuffledPairs = this._shuffle(this._linePairs);

    for (const pair of shuffledPairs) {
      const { a, b } = pair;
      const aFixed = fixedFlags[a];
      const bFixed = fixedFlags[b];

      // 両方固定済み、または両方とも文字未設定なら対象外
      if (aFixed && bFixed) continue;

      if (!aFixed && bFixed) {
        // bを起点に、aに置くと熟語になる1文字目を探す
        const candidate = this._pickCandidate(
          dictionaryEngine.getPossibleFirstChars(grid[b])
        );
        if (candidate) return new Map([[a, candidate]]);
      } else if (aFixed && !bFixed) {
        // aを起点に、bに置くと熟語になる2文字目を探す
        const candidate = this._pickCandidate(
          dictionaryEngine.getPossibleSecondChars(grid[a])
        );
        if (candidate) return new Map([[b, candidate]]);
      } else {
        // 両方未固定の場合は、bの現在の文字を起点にaを近付ける
        const candidate = this._pickCandidate(
          dictionaryEngine.getPossibleFirstChars(grid[b])
        );
        if (candidate) return new Map([[a, candidate]]);
      }
    }

    return null;
  }

  _pickCandidate(charSet) {
    if (!charSet || charSet.size === 0) return null;
    const arr = Array.from(charSet);
    return arr[Math.floor(Math.random() * arr.length)];
  }

  _shuffle(arr) {
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }
}

export { SUGGEST_AFTER_MS };
