import { GameEngine } from "./src/engine/GameEngine.js";
import { AnimationEngine } from "./src/engine/AnimationEngine.js";
import { AudioEngine } from "./src/engine/AudioEngine.js";
import { UIEngine } from "./src/engine/UIEngine.js";
import { loadSaveData, recordSpinResult, updateSettings } from "./src/utils/storage.js";

async function loadJson(path) {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`${path} の読み込みに失敗しました (status: ${res.status})`);
  }
  return res.json();
}

async function main() {
  const [kanjiList, jukugoEntries] = await Promise.all([
    loadJson("./data/kanji.json"),
    loadJson("./data/jukugo_2.json"),
  ]);

  const saveData = loadSaveData();

  const gameEngine = new GameEngine(kanjiList, jukugoEntries);
  const audioEngine = new AudioEngine();

  const root = document.getElementById("app");
  const uiEngine = new UIEngine({
    root,
    gameEngine,
    audioEngine,
    createAnimationEngine: (getCharElement, getCellElement, effectLayerEl, bannerLayerEl) =>
      new AnimationEngine(getCharElement, getCellElement, effectLayerEl, bannerLayerEl),
  });

  uiEngine.setDebugVisible(saveData.settings.debug);
  uiEngine.renderStats(saveData);
  uiEngine.render(gameEngine.getState());

  // 動作確認・デバッグ用のフック（ゲームプレイ自体には影響しない）
  window.__gameEngine = gameEngine;
  window.__uiEngine = uiEngine;

  uiEngine.onSettingsChanged((partial) => {
    updateSettings(partial);
  });

  let spinning = false;
  let lastFrameAt = performance.now();
  let fps = 0;
  let lastSearchTimeMs = 0;

  function startSpin() {
    if (spinning) return;
    if (!gameEngine.canSpin()) {
      showResult();
      return;
    }

    spinning = true;
    uiEngine.setSpinButtonEnabled(false);
    uiEngine.clearResultList();
    audioEngine.play("spinStart");

    const now = performance.now();
    const started = gameEngine.startSpin(now);
    uiEngine.animationEngine.resetAll(gameEngine.reelEngine.cellCount);

    if (!started) {
      spinning = false;
      showResult();
      return;
    }

    uiEngine.render(gameEngine.getState());
    requestAnimationFrame(loop);
  }

  function showResult() {
    uiEngine.setSpinButtonEnabled(false);
    uiEngine.showResultOverlay(gameEngine.getState());
  }

  function loop(nowRaw) {
    const now = nowRaw;

    const frameDelta = now - lastFrameAt;
    if (frameDelta > 0) {
      fps = 1000 / frameDelta;
    }
    lastFrameAt = now;

    const searchStart = performance.now();
    const hit = gameEngine.tick(now);
    lastSearchTimeMs = performance.now() - searchStart;

    const state = gameEngine.getState();
    uiEngine.render(state);

    if (hit) {
      uiEngine.onHit(hit);
      for (const r of hit.results) {
        uiEngine.appendDebugLog(
          `[${(gameEngine.getSpinElapsedMs(now) / 1000).toFixed(2)}s] 成立: ${r.word}(${r.reading}) type=${r.type}`
        );
      }
      if (hit.replayTriggered) {
        uiEngine.onReplayTriggered();
        uiEngine.appendDebugLog(
          `[${(gameEngine.getSpinElapsedMs(now) / 1000).toFixed(2)}s] REPLAY発生`
        );
      }
    }

    uiEngine.renderDebug({ fps, lastSearchTimeMs });

    if (gameEngine.isSpinning(now)) {
      requestAnimationFrame(loop);
    } else {
      spinning = false;

      const finalState = gameEngine.getState();
      const updated = recordSpinResult({
        spinScore: finalState.spinScore,
        spinWordCount: finalState.spinResults.length,
        maxComboThisSpin: finalState.maxComboThisSpin,
      });
      uiEngine.renderStats(updated);
      uiEngine.appendDebugLog(
        `スピン終了: ${finalState.spinResults.length}語成立 / ${finalState.spinScore}点 / 所持金${finalState.money}円` +
          (finalState.pendingReplays > 0 ? ` / リプレイ残り${finalState.pendingReplays}回` : "")
      );

      if (finalState.gameOver) {
        showResult();
      } else if (finalState.pendingReplays > 0) {
        // リプレイ権が残っている場合、ボタン操作なしで自動的に次のスピンへ
        uiEngine.setSpinButtonEnabled(false);
        setTimeout(startSpin, 700);
      } else {
        uiEngine.setSpinButtonEnabled(true);
      }
    }
  }

  uiEngine.onSpinRequested(startSpin);
  uiEngine.onReplayRequested(() => {
    gameEngine.resetSession();
    uiEngine.hideResultOverlay();
    uiEngine.clearResultList();
    uiEngine.render(gameEngine.getState());
    uiEngine.setSpinButtonEnabled(true);
  });
  uiEngine.setSpinButtonEnabled(true);
}

main().catch((err) => {
  console.error(err);
  const root = document.getElementById("app");
  root.textContent = `読み込みエラー: ${err.message}`;
});
