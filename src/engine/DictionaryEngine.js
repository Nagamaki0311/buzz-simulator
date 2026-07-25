/**
 * DictionaryEngine
 *
 * ビルド時に生成済みのjukugo_2.jsonのみを読み込む（ゲーム起動時の辞書生成は行わない）。
 * 検索はMap（Hash）による O(1) を基本とする。
 *
 * GameBalanceEngineが「候補提案」に使う補助インデックス（1文字目→続きうる2文字目の一覧、
 * 2文字目→続きうる1文字目の一覧）もここで保持する。DictionaryEngine自身はいずれの
 * インデックスも書き換えられることはなく、参照専用として公開する。
 */
export class DictionaryEngine {
  /**
   * @param {Array<{word: string, reading: string, score: number}>} entries jukugo_2.jsonの内容
   */
  constructor(entries) {
    this._byWord = new Map();
    this._byFirstChar = new Map(); // 1文字目 -> Set<2文字目>
    this._bySecondChar = new Map(); // 2文字目 -> Set<1文字目>

    for (const entry of entries) {
      const { word } = entry;
      if (word.length !== 2) continue;

      this._byWord.set(word, entry);

      const first = word[0];
      const second = word[1];

      if (!this._byFirstChar.has(first)) {
        this._byFirstChar.set(first, new Set());
      }
      this._byFirstChar.get(first).add(second);

      if (!this._bySecondChar.has(second)) {
        this._bySecondChar.set(second, new Set());
      }
      this._bySecondChar.get(second).add(first);
    }
  }

  /**
   * @param {string} pair 2文字の文字列
   * @returns {boolean} 辞書に存在する二字熟語かどうか
   */
  has(pair) {
    return this._byWord.has(pair);
  }

  /**
   * @param {string} pair
   * @returns {{word: string, reading: string, score: number} | null}
   */
  getEntry(pair) {
    return this._byWord.get(pair) || null;
  }

  /**
   * firstCharの後に続きうる2文字目の候補一覧（GameBalanceEngine用）
   * @param {string} firstChar
   * @returns {Set<string> | null}
   */
  getPossibleSecondChars(firstChar) {
    return this._byFirstChar.get(firstChar) || null;
  }

  /**
   * secondCharの前に来うる1文字目の候補一覧（GameBalanceEngine用）
   * @param {string} secondChar
   * @returns {Set<string> | null}
   */
  getPossibleFirstChars(secondChar) {
    return this._bySecondChar.get(secondChar) || null;
  }

  get size() {
    return this._byWord.size;
  }
}
