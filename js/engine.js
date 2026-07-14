/**
 * engine.js
 * データ読み込みと、通知発生のコアロジックを担当する。
 *
 * 【設計メモ：超大量通知の扱いについて】
 * 今回の要件では15分間で最低34万件〜最大620万件という、実際にDOM要素や
 * setTimeoutを1件ずつ生成しては到底さばききれない量の通知を扱う。
 * そのため、以下の2層構造にしている。
 *   1. 集計レイヤー：通知の発生速度（件/秒）を数式で計算し、一定間隔(TICK_MS)ごとに
 *      「このtickで何件発生したか」をまとめて計算し、いいね/リポスト/フォロー/返信/
 *      引用/DMの内部カウンターに一括加算する。ここで得られる合計値・内訳は正確。
 *   2. 表示レイヤー：実際に画面へ追加するカードは、tickごとに種別ごと最大数件のみ
 *      サンプル表示する。何百万件をすべてDOMに描画すると確実にブラウザが固まるため、
 *      「洪水のような通知を疑似的に体感できる代表サンプル」を高頻度で流し込む方式にした。
 * これにより、内部の集計（結果画面の合計値など）は要件どおりの規模で正確に積み上がりつつ、
 * 画面は最後まで滑らかに動作する。
 */
const Engine = (() => {
  let data = {
    names: null,
    notifTemplates: null,
    replies: null,
    dm: null,
    keywords: null
  };

  const TICK_MS = 120;              // 集計・描画の更新間隔
  const MAX_VISIBLE_PER_TYPE = 3;   // 1tickあたり、種別ごとに実際にカードを描画する上限数

  let tickHandle = null;
  let carryRemainder = 0;           // 端数（小数点以下）の繰り越し
  let peakRatePerSec = 0;           // 目標合計から逆算したピーク時の理論発生速度
  let lastMs = { second: -1, count: 0 };
  let notifWeightTotal = 0;
  let notifRatios = { like: 0.7, repost: 0.2, follow: 0.1 };

  const MIN_TOTAL = 340000;
  const MAX_TOTAL = 6200000;

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

    // notificationTemplates.jsonのweightから、いいね/リポスト/フォローの内部比率を算出しておく
    notifWeightTotal = data.notifTemplates.reduce((s, t) => s + t.weight, 0);
    notifRatios = {};
    data.notifTemplates.forEach(t => { notifRatios[t.type] = t.weight / notifWeightTotal; });
  }

  function randomUser() {
    return data.names[Math.floor(Math.random() * data.names.length)];
  }
  function findTemplate(type) {
    return data.notifTemplates.find(t => t.type === type);
  }

  // ---------- 通知発生の「形」を表す関数（0〜1の相対値） ----------
  // 最初は静か→指数関数的に増加→ピーク→急激に収束、という曲線の"形"のみを表す。
  // 実際の秒間発生数は、この形にpeakRatePerSecを掛けて算出する。
  function shapeRate(t) {
    const peak = 0.52;
    const minR = 0.01;
    if (t <= peak) {
      const progress = t / peak;
      return minR * Math.pow(1 / minR, progress); // 指数関数的な立ち上がり
    } else {
      const progress = (t - peak) / (1 - peak);
      const shaped = Math.pow(progress, 0.55); // 収束を立ち上がりより急にする
      return Math.pow(minR, shaped);
    }
  }

  // 曲線の時間平均を数値積分で求め、目標合計件数からピーク速度を逆算する
  function calibratePeakRate(targetTotal, durationSec) {
    const steps = 800;
    let sum = 0;
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      sum += shapeRate(t);
    }
    const avgShape = sum / steps;
    return targetTotal / durationSec / avgShape;
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
      // 一度のtickで複数回またいでいても、演出が過剰にならないよう1件だけ表示する
      Render.pushMilestone(type, step, randomUser(), now);
    }
  }

  // ---------- A通知（いいね/リポスト/フォロー）の一括処理 ----------
  function processA(count, now) {
    if (count <= 0) return;
    const likeN = Math.round(count * (notifRatios.like || 0.7));
    const repostN = Math.round(count * (notifRatios.repost || 0.2));
    const followN = Math.max(0, count - likeN - repostN);

    const oldLikes = State.likes, oldReposts = State.reposts, oldFollows = State.follows;
    State.likes += likeN;
    State.reposts += repostN;
    State.follows += followN;

    renderSampleType("like", likeN, now);
    renderSampleType("repost", repostN, now);
    renderSampleType("follow", followN, now);

    checkMilestone("like", oldLikes, State.likes, 20, now);
    checkMilestone("repost", oldReposts, State.reposts, 40, now);
    checkMilestone("follow", oldFollows, State.follows, 80, now);
  }

  function renderSampleType(type, count, now) {
    if (count <= 0) return;
    const tpl = findTemplate(type);
    const visible = Math.min(count, MAX_VISIBLE_PER_TYPE);
    for (let i = 0; i < visible; i++) {
      const user = randomUser();
      const text = tpl.text.replace("{name}", user.name);
      Render.pushNotification({
        id: now + "-" + Math.random(),
        kind: type,
        icon: { like: "❤️", repost: "🔁", follow: "➕" }[type],
        user, text, time: now
      });
    }
  }

  // ---------- B通知（返信/引用）の一括処理 ----------
  function processB(count, now) {
    if (count <= 0) return;
    const quoteN = Math.round(count * 0.35);
    const replyN = count - quoteN;

    State.replies += count;   // 返信・引用ともに「返信数」として計上
    State.reposts += quoteN;  // 引用はリポスト数にも計上（実際のSNS挙動に合わせる）

    // カテゴリ別集計（結果画面の統計用。件数分を重みで按分する）
    Object.entries(REPLY_CATEGORY_WEIGHTS).forEach(([cat, w]) => {
      const share = Math.round(count * w / REPLY_CATEGORY_TOTAL);
      State.replyCategoryCount[cat] = (State.replyCategoryCount[cat] || 0) + share;
    });

    // 表示は代表サンプルのみ
    const visibleReply = Math.min(replyN, MAX_VISIBLE_PER_TYPE);
    for (let i = 0; i < visibleReply; i++) {
      const user = randomUser();
      const category = pickCategory();
      const text = pickReplyText(category);
      Render.pushReply(user, text, now);
    }
    const visibleQuote = Math.min(quoteN, MAX_VISIBLE_PER_TYPE);
    for (let i = 0; i < visibleQuote; i++) {
      const user = randomUser();
      const category = pickCategory();
      const text = pickReplyText(category);
      Render.pushQuote(user, text, now);
    }
  }

  // ---------- C通知（DM）の一括処理 ----------
  function processC(count, now) {
    if (count <= 0) return;
    State.dmTotal += count;

    data.dm.forEach(cat => {
      const share = Math.round(count / data.dm.length);
      State.dmCategoryCount[cat.label] = (State.dmCategoryCount[cat.label] || 0) + share;
    });

    const visible = Math.min(count, MAX_VISIBLE_PER_TYPE);
    for (let i = 0; i < visible; i++) {
      const dm = pickDM();
      Render.pushDM(dm, now);
    }
  }

  function processBatch(n, now) {
    State.totalNotifications += n;

    const aCount = Math.round(n * 0.83);
    const bCount = Math.round(n * 0.12);
    const cCount = Math.max(0, n - aCount - bCount);

    processA(aCount, now);
    processB(bCount, now);
    processC(cCount, now);

    Render.updateHomeStats();
    if (n > 0) AudioEngine.playNotify(State.soundOn);
  }

  // ---------- メインループ ----------
  function tick() {
    if (State.phase !== "running") return;
    const now = Date.now();
    const elapsed = now - State.startedAt;
    const t = Math.min(1, elapsed / State.durationMs);
    Render.updateProgress(t);

    if (t >= 1) {
      Engine.end();
      return;
    }

    const rate = shapeRate(t) * peakRatePerSec; // 件/秒
    const tickSec = TICK_MS / 1000;

    // このtickの瞬間的な速度をピーク記録に反映
    State.peakNotifPerSec = Math.max(State.peakNotifPerSec, Math.round(rate));

    carryRemainder += rate * tickSec;
    const n = Math.floor(carryRemainder);
    carryRemainder -= n;

    if (n > 0) processBatch(n, now);

    tickHandle = setTimeout(tick, TICK_MS);
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
      carryRemainder = 0;
      lastMs = { second: -1, count: 0 };

      // 目標合計通知数（34万〜620万）を、やや低めに寄りつつ稀に振り切れる分布で決定
      const luck = Math.pow(Math.random(), 1.5);
      let targetTotal = MIN_TOTAL + luck * (MAX_TOTAL - MIN_TOTAL);

      // 文字数ボーナス：10字を超えた分だけ1字ごとに0.1%ずつ通知数を底上げ（40字で最大+3.0%）
      const len = Math.min(State.postText.length, 40);
      const bonusChars = Math.max(0, len - 10);
      targetTotal *= (1 + bonusChars * 0.001);
      State.targetTotal = Math.round(targetTotal);

      peakRatePerSec = calibratePeakRate(State.targetTotal, State.durationMs / 1000);

      Render.onStart();
      tick();
    },
    end() {
      if (State.phase !== "running") return;
      State.phase = "ended";
      clearTimeout(tickHandle);
      Render.onEnd();
    }
  };
})();
