/**
 * state.js
 * アプリ全体の状態（ゲームの進行状況、カウンター、収集した統計）を一元管理する。
 * 他のモジュールはこのオブジェクトを直接参照・更新する。
 */
const State = {
  // ゲーム進行フェーズ: "idle"(投稿前) -> "running"(シミュレーション中) -> "ended"(結果画面)
  phase: "idle",

  postText: "",
  postTime: null,

  // ホーム画面カウンター
  likes: 0,
  reposts: 0,
  replies: 0,

  // 通知タブの状態
  notifications: [],   // 表示済み通知の配列（新しい順）
  unreadCount: 0,

  // DMタブの状態
  dms: [],

  // 統計（リザルト用）
  totalNotifications: 0,
  peakNotifPerSec: 0,
  replyCategoryCount: { empathy: 0, normal: 0, discussion: 0, negative: 0, meme: 0 },
  dmCategoryCount: {},

  // タイマー関連
  startedAt: 0,
  durationMs: 15 * 60 * 1000, // 15分
  soundOn: true,
  theme: "light",

  reset() {
    this.phase = "idle";
    this.postText = "";
    this.postTime = null;
    this.likes = 0;
    this.reposts = 0;
    this.replies = 0;
    this.notifications = [];
    this.unreadCount = 0;
    this.dms = [];
    this.totalNotifications = 0;
    this.peakNotifPerSec = 0;
    this.replyCategoryCount = { empathy: 0, normal: 0, discussion: 0, negative: 0, meme: 0 };
    this.dmCategoryCount = {};
    this.startedAt = 0;
  }
};
