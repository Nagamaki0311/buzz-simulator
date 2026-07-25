/**
 * RandomEngine
 *
 * 常用漢字2,136字のみを対象に、重みなし・均等確率で1字を返す。
 * ゲームバランスに関する判断は一切行わない（GameBalanceEngineとは完全分離）。
 */
export class RandomEngine {
  /**
   * @param {string[]} kanjiList 常用漢字の配列（例: kanji.jsonの内容）
   */
  constructor(kanjiList) {
    if (!Array.isArray(kanjiList) || kanjiList.length === 0) {
      throw new Error("RandomEngine: kanjiListは空でない配列である必要があります");
    }
    this._kanjiList = kanjiList;
  }

  /**
   * @returns {string} 常用漢字1字（均等確率）
   */
  next() {
    const index = Math.floor(Math.random() * this._kanjiList.length);
    return this._kanjiList[index];
  }

  get size() {
    return this._kanjiList.length;
  }
}
