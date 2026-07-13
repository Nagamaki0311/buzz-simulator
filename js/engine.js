/**
 * engine.js
 * データ読み込み、通知生成アルゴリズム（指数関数的増加→ピーク→急収束）、
 * 返信/DM抽選ロジックを担当するコアエンジン。
 * UI描画はrender.jsに委譲し、このファイルはロジックに専念する。
 */
const Engine = (() => {
  let data = {
    names: null,
    notifTemplates: null,
    replies: null,
    dm: null,
    keywords: null
  };

  let timerHandle = null;
  let tickHandle = null;
  let lastSecondBucket = { second: -1, count: 0 };

  // ---------- データロード ----------
  async function loadData() {
    const [names, notifTemplates, replies, dm, keywords] = await Promise.all([
      fetch("data/names.json").then(r => r.json()),
      fetch("data/notificationTemplates.json").then(r => r.json()),
      fetch("data/replies.json").then(r => r.json()),
      fetch("data/dm.json").then(r => r.json()),
      fetch("data/keywords.json").then(r => r.json()),
    ]);
    data.names = names.users;
    data.notifTemplates = notifTemplates.templates;
    data.replies = replies.categories;
    data.dm = dm.categories;
    data.keywords = keywords.keywords;
  }

  function randomUser() {
    return data.names[Math.floor(Math.random() * data.names.length)];
  }

  function weightedPick(list, weightFn) {
    const total = list.reduce((s, item) => s + weightFn(item), 0);
    let r = Math.random() * total;
    for (const item of list) {
      r -= weightFn(item);
      if (r <= 0) return item;
    }
    return list[list.length - 1];
  }

  // ---------- 通知発生レート曲線 ----------
  // t: 0〜1（経過割合）。最初は静か→指数関数的に増加→ピーク→急激に収束、という曲線。
  function computeRate(t) {
    const peak = 0.52;
    const maxRate = 9.5;   // ピーク時 秒間発生数
    const minRate = 0.06;  // 開始直後 秒間発生数
    let rate;
    if (t <= peak) {
      const progress = t / peak;
      rate = minRate * Math.pow(maxRate / minRate, progress); // 指数関数的な立ち上がり
    } else {
      const progress = (t - peak) / (1 - peak);
      // 収束は立ち上がりより急にする（progressを圧縮）ことで「突然静かになる」感を出す
      const shaped = Math.pow(progress, 0.55);
      rate = maxRate * Math.pow(minRate / maxRate, shaped);
    }
    return rate;
  }

  // ---------- 返信テキスト抽選 ----------
  function pickReply() {
    // 投稿内容にキーワードが含まれるか判定
    const matched = data.keywords.filter(k => State.postText.includes(k.key));
    if (matched.length > 0 && Math.random() < 0.4) {
      const kw = matched[Math.floor(Math.random() * matched.length)];
      const text = kw.replies[Math.floor(Math.random() * kw.replies.length)];
      return { category: "normal", text, isKeywordMatch: true };
    }

    // カテゴリ選択（共感・普通が出やすく、否定・議論は控えめ、ミームは低頻度）
    const categoryWeights = { empathy: 32, normal: 30, discussion: 12, negative: 10, meme: 16 };
    const catKeys = Object.keys(categoryWeights);
    const cat = weightedPick(catKeys, k => categoryWeights[k]);
    const pool = data.replies[cat].texts;
    // 直前と同じ返信が連続しにくいよう簡易的に回避
    let text;
    let attempts = 0;
    do {
      text = pool[Math.floor(Math.random() * pool.length)];
      attempts++;
    } while (State.notifications[0] && State.notifications[0].text === text && attempts < 5);

    return { category: cat, text, isKeywordMatch: false };
  }

  // ---------- DM抽選 ----------
  function pickDM() {
    const cat = data.dm[Math.floor(Math.random() * data.dm.length)];
    const text = cat.texts[Math.floor(Math.random() * cat.texts.length)];
    const user = cat.senderNameOverride
      ? { name: cat.senderNameOverride, handle: cat.id, color: "#334155", emoji: "📩" }
      : randomUser();
    return { category: cat.id, label: cat.label, text, user };
  }

  // ---------- 1イベント発生 ----------
  // 通知全体の内訳: A通知(いいね/リポスト/フォロー) 83% / B通知(返信/引用) 12% / C通知(DM) 5%
  const ICON_MAP = { like: "❤️", repost: "🔁", follow: "➕", reply: "💬", quote: "🔁" };

  function emitEvent() {
    const now = Date.now();
    State.totalNotifications++;

    const roll = Math.random();
    if (roll < 0.83) {
      // ---- A通知: いいね / リポスト / フォロー ----
      const tpl = weightedPick(data.notifTemplates, t => t.weight);
      const user = randomUser();
      const text = tpl.text.replace("{name}", user.name);

      if (tpl.type === "like") State.likes++;
      else if (tpl.type === "repost") State.reposts++;
      // followはホーム画面のカウンターには反映しない（実際のSNSでも別集計のため）

      Render.pushNotification({
        id: now + "-" + Math.random(),
        kind: tpl.type,
        icon: ICON_MAP[tpl.type] || "🔔",
        user, text,
        time: now
      });
    } else if (roll < 0.95) {
      // ---- B通知: 返信 / 引用（同じリアクション文プールを共有） ----
      const isQuote = Math.random() < 0.35; // 引用は返信よりやや少なめ
      const { category, text } = pickReply();
      State.replies++;
      if (isQuote) State.reposts++; // 引用はリポスト数にも計上（実際のSNS挙動に合わせる）
      State.replyCategoryCount[category] = (State.replyCategoryCount[category] || 0) + 1;
      const user = randomUser();
      Render.pushNotification({
        id: now + "-" + Math.random(),
        kind: isQuote ? "quote" : "reply",
        icon: isQuote ? ICON_MAP.quote : ICON_MAP.reply,
        user,
        text: isQuote ? `引用: ${text}` : `返信: ${text}`,
        time: now
      });
    } else {
      const dm = pickDM();
      State.dmCategoryCount[dm.label] = (State.dmCategoryCount[dm.label] || 0) + 1;
      Render.pushDM(dm, now);
    }

    // 秒間発生数のピーク記録
    const sec = Math.floor(now / 1000);
    if (lastSecondBucket.second === sec) {
      lastSecondBucket.count++;
    } else {
      lastSecondBucket = { second: sec, count: 1 };
    }
    State.peakNotifPerSec = Math.max(State.peakNotifPerSec, lastSecondBucket.count);

    Render.updateHomeStats();
    AudioEngine.playNotify(State.soundOn);
  }

  // ---------- スケジューラ ----------
  function scheduleNext() {
    if (State.phase !== "running") return;
    const elapsed = Date.now() - State.startedAt;
    const t = Math.min(1, elapsed / State.durationMs);

    if (t >= 1) {
      Engine.end();
      return;
    }

    const rate = computeRate(t); // 件/秒
    const baseIntervalMs = 1000 / Math.max(rate, 0.02);
    const jitter = 0.55 + Math.random() * 0.9; // 揺らぎ
    const intervalMs = Math.max(30, baseIntervalMs * jitter);

    timerHandle = setTimeout(() => {
      emitEvent();
      scheduleNext();
    }, intervalMs);
  }

  // ---------- 全体進捗タイマー（プログレスバー・残り時間表示用） ----------
  function startTicker() {
    tickHandle = setInterval(() => {
      if (State.phase !== "running") return;
      const elapsed = Date.now() - State.startedAt;
      const t = Math.min(1, elapsed / State.durationMs);
      Render.updateProgress(t, State.durationMs - elapsed);
      if (t >= 1) Engine.end();
    }, 250);
  }

  return {
    async init() {
      await loadData();
    },
    start(postText) {
      State.reset();
      State.postText = postText;
      State.postTime = Date.now();
      State.phase = "running";
      State.startedAt = Date.now();
      Render.onStart();
      scheduleNext();
      startTicker();
    },
    end() {
      if (State.phase !== "running") return;
      State.phase = "ended";
      clearTimeout(timerHandle);
      clearInterval(tickHandle);
      Render.onEnd();
    }
  };
})();
