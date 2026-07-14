/**
 * engine.js
 * データ読み込みと、通知発生のコアロジックを担当する。
 *
 * 【通知増加アルゴリズム】
 * 実際のSNSのバズり方を再現するため、通知の発生"速度"（1秒あたり何件か）を
 * 経過時間の関数として定義し、1件ごとにsetTimeoutで次の発生タイミングを
 * 都度スケジュールし直す方式にしている（＝完全な固定間隔ではない）。
 *   最初は静か → 速度が指数関数的に増加 → 突然止まらなくなる → ピーク → 急激に収束
 * という曲線を shapeRate(t) で表現し、さらに1件ごとの間隔に乱数の揺らぎ（0.5〜1.5倍）を
 * かけることで、機械的な一定間隔にならないようにしている。
 * 15分間の総通知数はこの曲線の積分でおおよそ決まり、投稿の文字数や「バズり運」に
 * よって多少上下する（固定の上限・下限は設けていない）。
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
  let lastSecondBucket = { second: -1, count: 0 };
  let peakRatePerSec = 22;   // ピーク時の基準発生速度（件/秒）。セッションごとに多少補正される
  let notifWeightTotal = 0;

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
    notifWeightTotal = data.notifTemplates.reduce((s, t) => s + t.weight, 0);
  }

  function randomUser() {
    return data.names[Math.floor(Math.random() * data.names.length)];
  }

  function weightedPickTemplate() {
    let r = Math.random() * notifWeightTotal;
    for (const tpl of data.notifTemplates) {
      r -= tpl.weight;
      if (r <= 0) return tpl;
    }
    return data.notifTemplates[data.notifTemplates.length - 1];
  }

  // ---------- 通知発生速度の曲線（件/秒） ----------
  // 最初は静か→指数関数的に増加→ピーク→急激に収束、という現実のバズり方に寄せた非対称カーブ。
  function shapeRate(t) {
    const peak = 0.5;
    const minR = 0.04;
    const maxR = peakRatePerSec;
    if (t <= peak) {
      const progress = t / peak;
      return minR * Math.pow(maxR / minR, progress); // 指数関数的な立ち上がり
    } else {
      const progress = (t - peak) / (1 - peak);
      const shaped = Math.pow(progress, 0.5); // 収束を立ち上がりより急にする
      return maxR * Math.pow(minR / maxR, shaped);
    }
  }

  // ---------- 返信/引用カテゴリの重み付き振り分け ----------
  const REPLY_CATEGORY_WEIGHTS = { empathy: 32, normal: 30, discussion: 12, negative: 10, meme: 16 };
  const REPLY_CATEGORY_TOTAL = Object.values(REPLY_CATEGORY_WEIGHTS).reduce((a, b) => a + b, 0);

  function pickCategory() {
    let r = Math.random() * REPLY_CATEGORY_TOTAL;
    for (const [cat, w] of Object.entries(REPLY_CATEGORY_WEIGHTS)) {
      r -= w;
      if (r <= 0) return cat;
    }
    return "normal";
  }

  function pickReplyText(category) {
    // 投稿内容にキーワードが含まれる場合、一定確率で専用返信を優先する
    const matched = data.keywords.filter(k => State.postText.includes(k.key));
    if (matched.length > 0 && Math.random() < 0.4) {
      const kw = matched[Math.floor(Math.random() * matched.length)];
      return kw.replies[Math.floor(Math.random() * kw.replies.length)];
    }
    const pool = data.replies[category].texts;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function pickDM() {
    const cat = data.dm[Math.floor(Math.random() * data.dm.length)];
    const text = cat.texts[Math.floor(Math.random() * cat.texts.length)];
    const user = cat.senderNameOverride
      ? { name: cat.senderNameOverride, handle: cat.id, color: "#334155", emoji: "📩" }
      : randomUser();
    return { category: cat.id, label: cat.label, text, user };
  }

  // ---------- マイルストーン判定（いいね20/リポスト40/フォロー80ごと） ----------
  function checkMilestone(type, oldVal, newVal, step, now) {
    const oldMult = Math.floor(oldVal / step);
    const newMult = Math.floor(newVal / step);
    if (newMult > oldMult) {
      Render.pushMilestone(type, step, randomUser(), now);
    }
  }

  // ---------- 1件の通知イベントを発生させる ----------
  // 内訳: A通知(いいね/リポスト/フォロー) 83% / B通知(返信/引用) 12% / C通知(DM) 5%
  const ICON_MAP = { like: "❤️", repost: "🔁", follow: "➕" };

  function emitEvent() {
    const now = Date.now();
    State.totalNotifications++;

    const roll = Math.random();
    if (roll < 0.83) {
      // ---- A通知: いいね / リポスト / フォロー ----
      const tpl = weightedPickTemplate();
      const user = randomUser();
      const text = tpl.text.replace("{name}", user.name);

      if (tpl.type === "like") {
        const old = State.likes; State.likes++;
        checkMilestone("like", old, State.likes, 20, now);
      } else if (tpl.type === "repost") {
        const old = State.reposts; State.reposts++;
        checkMilestone("repost", old, State.reposts, 40, now);
      } else if (tpl.type === "follow") {
        const old = State.follows; State.follows++;
        checkMilestone("follow", old, State.follows, 80, now);
      }

      Render.pushNotification({
        id: now + "-" + Math.random(),
        kind: tpl.type,
        icon: ICON_MAP[tpl.type] || "🔔",
        user, text, time: now
      });
    } else if (roll < 0.95) {
      // ---- B通知: 返信 / 引用（同じリアクション文プールを共有） ----
      const isQuote = Math.random() < 0.35; // 引用は返信よりやや少なめ
      const category = pickCategory();
      const text = pickReplyText(category);
      const user = randomUser();

      State.replies++;
      if (isQuote) State.reposts++; // 引用はリポスト数にも計上（実際のSNS挙動に合わせる）
      State.replyCategoryCount[category] = (State.replyCategoryCount[category] || 0) + 1;

      if (isQuote) Render.pushQuote(user, text, now);
      else Render.pushReply(user, text, now);
    } else {
      // ---- C通知: DM ----
      const dm = pickDM();
      State.dmTotal++;
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

  // ---------- スケジューラ（1件ごとに次の発生タイミングを乱数で揺らして再設定） ----------
  function scheduleNext() {
    if (State.phase !== "running") return;
    const elapsed = Date.now() - State.startedAt;
    const t = Math.min(1, elapsed / State.durationMs);
    Render.updateProgress(t);

    if (t >= 1) {
      Engine.end();
      return;
    }

    const rate = shapeRate(t); // 件/秒
    const baseIntervalMs = 1000 / Math.max(rate, 0.01);
    const jitter = 0.5 + Math.random() * 1.0; // 完全固定間隔にならないよう揺らぎを持たせる
    const intervalMs = Math.max(15, baseIntervalMs * jitter);

    timerHandle = setTimeout(() => {
      emitEvent();
      scheduleNext();
    }, intervalMs);
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
      lastSecondBucket = { second: -1, count: 0 };

      // セッションごとの「バズり運」で基準ピーク速度を軽く上下させる
      const sessionLuck = 0.65 + Math.random() * 0.7; // 0.65〜1.35倍
      // 文字数ボーナス：10字を超えた分だけ1字ごとに0.1%ずつ通知速度を底上げ（40字で最大+3.0%）
      const len = Math.min(State.postText.length, 40);
      const bonusChars = Math.max(0, len - 10);
      const lengthBonus = 1 + bonusChars * 0.001;

      peakRatePerSec = 22 * sessionLuck * lengthBonus;

      Render.onStart();
      scheduleNext();
    },
    end() {
      if (State.phase !== "running") return;
      State.phase = "ended";
      clearTimeout(timerHandle);
      Render.onEnd();
    }
  };
})();
