/**
 * main.js
 * DOMContentLoaded後にモジュールを初期化し、UIイベントとロジックを結線する。
 */
document.addEventListener("DOMContentLoaded", async () => {
  Render.init();

  // データ読み込み（JSON分離ファイルをfetch）
  try {
    await Engine.init();
  } catch (e) {
    console.error("データの読み込みに失敗しました。GitHub Pages等、http(s)経由で開いてください。", e);
    alert("データの読み込みに失敗しました。ローカルファイルを直接開いている場合は、簡易サーバー経由（例: python -m http.server）で開いてください。");
    return;
  }

  // ---------- テーマ切替 ----------
  const themeToggle = document.getElementById("theme-toggle");
  themeToggle.addEventListener("click", () => {
    State.theme = State.theme === "light" ? "dark" : "light";
    Render.setTheme(State.theme);
    themeToggle.textContent = State.theme === "light" ? "🌙" : "☀️";
  });

  // ---------- 通知音ON/OFF ----------
  const soundToggle = document.getElementById("sound-toggle");
  soundToggle.addEventListener("click", () => {
    State.soundOn = !State.soundOn;
    soundToggle.textContent = State.soundOn ? "🔊" : "🔇";
    AudioEngine.unlock();
  });

  // ---------- スタートオーバーレイ ----------
  Render.bindOverlayStart(() => {
    Render.hideStartOverlay();
    AudioEngine.unlock();
  });

  // ---------- 投稿フォーム ----------
  const charCountEl = document.getElementById("char-count");
  Render.bindPostInput(() => {
    const val = Render.getPostInputValue();
    Render.getPostBtn().disabled = val.length === 0;
    charCountEl.textContent = `${val.length}/40`;
  });

  Render.bindPostBtn(() => {
    const text = Render.getPostInputValue();
    if (!text) return;
    AudioEngine.unlock();
    Engine.start(text);
  });

  // ---------- タブ切替 ----------
  Render.bindTabs((tabName) => {
    if (tabName === "home") {
      Render.switchScreen("home");
    } else if (tabName === "notifications") {
      Render.switchScreen("notifications");
    } else if (tabName === "dm") {
      Render.switchScreen("dm");
    }
  });

  // ---------- リザルト画面：もう一度あそぶ ----------
  document.getElementById("restart-btn").addEventListener("click", () => {
    location.reload();
  });
});
