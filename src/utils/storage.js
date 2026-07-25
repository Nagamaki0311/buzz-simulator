/**
 * storage.js
 *
 * LocalStorageへの保存・読込を担当する。
 * 保存対象: 累計スコア、総プレイ回数、最高コンボ、獲得熟語数、設定
 */

const STORAGE_KEY = "jukugo-slot:save-data";

const DEFAULT_DATA = {
  totalScore: 0,
  totalPlayCount: 0,
  maxCombo: 0,
  totalWordsFound: 0,
  settings: {
    debug: false,
  },
};

export function loadSaveData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_DATA, settings: { ...DEFAULT_DATA.settings } };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_DATA,
      ...parsed,
      settings: { ...DEFAULT_DATA.settings, ...(parsed.settings || {}) },
    };
  } catch (e) {
    console.warn("storage: 読込に失敗したため初期値を使用します", e);
    return { ...DEFAULT_DATA, settings: { ...DEFAULT_DATA.settings } };
  }
}

export function saveSaveData(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn("storage: 保存に失敗しました", e);
  }
}

/**
 * 1スピン終了時の結果を反映して保存する。
 * @param {{spinScore: number, spinWordCount: number, maxComboThisSpin: number}} spinResult
 */
export function recordSpinResult(spinResult) {
  const data = loadSaveData();
  data.totalScore += spinResult.spinScore;
  data.totalPlayCount += 1;
  data.totalWordsFound += spinResult.spinWordCount;
  if (spinResult.maxComboThisSpin > data.maxCombo) {
    data.maxCombo = spinResult.maxComboThisSpin;
  }
  saveSaveData(data);
  return data;
}

export function updateSettings(partialSettings) {
  const data = loadSaveData();
  data.settings = { ...data.settings, ...partialSettings };
  saveSaveData(data);
  return data;
}
