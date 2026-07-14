/**
 * render.js
 * DOM操作全般（画面切替、通知/DM/引用の描画、カウンターアニメーション、
 * プルリフレッシュ、リザルト画面の生成）を担当する。ロジック側(engine.js)から呼び出される。
 */
const Render = (() => {
  const els = {};
  let activeTab = "home";
  let notifTabLastOpenedAt = 0;
  let dmTabLastOpenedAt = 0;
  let dmUnread = 0;

  const MAX_LIST_ITEMS = 260;      // 通知/DMタブのDOM肥大化防止用の上限
  const MAX_HOME_QUOTES = 60;      // ホーム画面の引用ポスト欄の上限

  function cacheEls() {
    els.app = document.getElementById("app");
    els.postInput = document.getElementById("post-input");
    els.postBtn = document.getElementById("post-btn");
    els.composer = document.getElementById("composer");
    els.myPost = document.getElementById("my-post");
    els.myPostText = document.getElementById("my-post-text");
    els.statLike = document.getElementById("stat-like");
    els.statRepost = document.getElementById("stat-repost");
    els.statReply = document.getElementById("stat-reply");
    els.statLikeWrap = document.querySelector(".stat.like");
    els.statRepostWrap = document.querySelector(".stat.repost");
    els.statReplyWrap = document.querySelector(".stat.reply");

    els.homeQuotes = document.getElementById("home-quotes");
    els.homeQuotesList = document.getElementById("home-quotes-list");

    els.notifList = document.getElementById("notif-list");
    els.notifEmpty = document.getElementById("notif-empty");
    els.dmList = document.getElementById("dm-list");
    els.dmEmpty = document.getElementById("dm-empty");

    els.badgeNotif = document.getElementById("badge-notif");
    els.badgeDm = document.getElementById("badge-dm");

    els.tabbar = document.getElementById("tabbar");
    els.tabs = Array.from(document.querySelectorAll(".tab"));

    els.progressFill = document.getElementById("progress-fill");

    els.screens = {
      home: document.getElementById("screen-home"),
      notifications: document.getElementById("screen-notifications"),
      dm: document.getElementById("screen-dm"),
      result: document.getElementById("screen-result"),
    };

    els.startOverlay = document.getElementById("start-overlay");
    els.overlayStartBtn = document.getElementById("overlay-start-btn");

    els.pullIndicator = document.getElementById("pull-indicator");
  }

  function formatCount(n) {
    if (n < 1000) return String(n);
    if (n < 1000000) return (n / 1000).toFixed(1) + "K";
    return (n / 1000000).toFixed(1) + "M";
  }

  function bump(el) {
    if (!el) return;
    el.classList.remove("bump");
    void el.offsetWidth; // reflow強制でアニメーションを再トリガー
    el.classList.add("bump");
  }

  function switchScreen(name) {
    activeTab = name;
    Object.entries(els.screens).forEach(([key, el]) => {
      el.classList.toggle("hidden", key !== name);
    });
    els.tabs.forEach(t => t.classList.toggle("active", t.dataset.tab === name));

    if (name === "notifications") {
      notifTabLastOpenedAt = Date.now();
      State.unreadCount = 0;
      updateBadge(els.badgeNotif, 0);
    }
    if (name === "dm") {
      dmTabLastOpenedAt = Date.now();
      dmUnread = 0;
      updateBadge(els.badgeDm, 0);
    }
  }

  function updateBadge(el, count) {
    if (count <= 0) {
      el.classList.remove("show");
      el.textContent = "0";
      return;
    }
    el.textContent = count > 99 ? "99+" : String(count);
    if (!el.classList.contains("show")) {
      el.classList.add("show");
    } else {
      el.classList.remove("badge-pop");
      void el.offsetWidth;
      el.classList.add("badge-pop");
    }
  }

  function trimList(container, emptyEl) {
    while (container.children.length > MAX_LIST_ITEMS) {
      container.removeChild(container.lastElementChild);
    }
    if (emptyEl) emptyEl.style.display = container.children.length ? "none" : "block";
  }

  function avatarHtml(user, size = "") {
    return `<div class="avatar ${size}" style="background:${user.color}">${user.emoji}</div>`;
  }

  function quoteEmbedHtml() {
    const text = (State.postText || "").length > 60 ? State.postText.slice(0, 60) + "…" : State.postText;
    return `
      <div class="quote-embed">
        <div class="quote-embed-head">@you</div>
        <div class="quote-embed-text">${escapeHtml(text)}</div>
      </div>`;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ---------- 未読バッジ加算（3秒間の猶予付き） ----------
  function bumpNotifBadge(now) {
    const graceActive = activeTab === "notifications" && (now - notifTabLastOpenedAt < 3000);
    if (!graceActive) {
      State.unreadCount++;
      updateBadge(els.badgeNotif, State.unreadCount);
    }
  }
  function bumpDmBadge(now) {
    const graceActive = activeTab === "dm" && (now - dmTabLastOpenedAt < 3000);
    if (!graceActive) {
      dmUnread++;
      updateBadge(els.badgeDm, dmUnread);
    }
  }

  // ---------- プルリフレッシュ ----------
  function bindPullToRefresh() {
    const el = els.screens.home;
    const indicator = els.pullIndicator;
    let startY = 0, pulling = false, pull = 0;

    el.addEventListener("pointerdown", (e) => {
      if (el.scrollTop <= 0) { startY = e.clientY; pulling = true; }
    });
    el.addEventListener("pointermove", (e) => {
      if (!pulling) return;
      const dy = e.clientY - startY;
      if (dy > 0 && el.scrollTop <= 0) {
        pull = Math.min(dy * 0.5, 90);
        indicator.style.transform = `translate(-50%, ${pull}px)`;
        indicator.style.opacity = Math.min(pull / 55, 1);
      }
    });
    const release = () => {
      if (!pulling) return;
      pulling = false;
      if (pull > 55) {
        indicator.classList.add("refreshing");
        indicator.style.transform = `translate(-50%, 46px)`;
        indicator.style.opacity = 1;
        setTimeout(() => {
          indicator.classList.remove("refreshing");
          indicator.style.transform = "";
          indicator.style.opacity = 0;
          bump(els.statLikeWrap && els.statLikeWrap.querySelector(".num"));
          bump(els.statRepostWrap && els.statRepostWrap.querySelector(".num"));
          bump(els.statReplyWrap && els.statReplyWrap.querySelector(".num"));
        }, 500);
      } else {
        indicator.style.transform = "";
        indicator.style.opacity = 0;
      }
      pull = 0;
    };
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
    el.addEventListener("pointerleave", release);
  }

  return {
    init() {
      cacheEls();
      bindPullToRefresh();
    },

    setTheme(theme) {
      els.app.dataset.theme = theme;
      document.documentElement.dataset.theme = theme;
    },

    switchScreen,

    bindTabs(onTabClick) {
      els.tabs.forEach(tab => {
        tab.addEventListener("click", () => onTabClick(tab.dataset.tab));
      });
    },

    onStart() {
      els.composer.style.display = "none";
      els.myPost.style.display = "block";
      els.myPostText.textContent = State.postText;
      els.notifList.innerHTML = "";
      els.dmList.innerHTML = "";
      els.homeQuotesList.innerHTML = "";
      els.homeQuotes.classList.add("hidden");
      els.notifEmpty.style.display = "block";
      els.dmEmpty.style.display = "block";
      this.updateHomeStats();
    },

    updateHomeStats() {
      els.statLike.textContent = formatCount(State.likes);
      els.statRepost.textContent = formatCount(State.reposts);
      els.statReply.textContent = formatCount(State.replies);
    },

    updateProgress(t) {
      els.progressFill.style.width = `${Math.min(100, t * 100)}%`;
    },

    // ---------- A通知（いいね/リポスト/フォロー） ----------
    pushNotification(item) {
      const now = item.time;
      bumpNotifBadge(now);

      const div = document.createElement("div");
      div.className = "list-item";
      div.innerHTML = `
        ${avatarHtml(item.user)}
        <div class="content">
          <div class="line1">${escapeHtml(item.text)}</div>
          <div class="sub">@${escapeHtml(item.user.handle)}</div>
        </div>
        <div class="icon-mark">${item.icon}</div>
      `;
      els.notifList.prepend(div);
      trimList(els.notifList, els.notifEmpty);
    },

    // ---------- マイルストーン通知（複数人まとめて） ----------
    pushMilestone(type, step, sampleUser, now) {
      bumpNotifBadge(now);
      const actionMap = {
        like: "あなたのポストをいいねしました",
        repost: "あなたのポストをリポストしました",
        follow: "あなたをフォローしました",
      };
      const iconMap = { like: "❤️", repost: "🔁", follow: "➕" };

      // スタック表示用に追加のアバターをランダム生成
      const stackColors = ["#60A5FA", "#F472B6", "#34D399", "#FBBF24", "#A78BFA"];
      const stackEmojis = ["😀", "😆", "🙂", "😎", "🥳"];
      let stackHtml = avatarHtml(sampleUser, "small");
      for (let i = 0; i < 4; i++) {
        stackHtml += `<div class="avatar small" style="background:${stackColors[i % stackColors.length]}">${stackEmojis[i % stackEmojis.length]}</div>`;
      }

      const div = document.createElement("div");
      div.className = "list-item milestone-item";
      div.innerHTML = `
        <div class="avatar-stack">${stackHtml}</div>
        <div class="content">
          <div class="line1"><b>${escapeHtml(sampleUser.name)}</b>さん他${step}人が${actionMap[type]}</div>
        </div>
        <div class="icon-mark">${iconMap[type]}</div>
      `;
      els.notifList.prepend(div);
      trimList(els.notifList, els.notifEmpty);
    },

    // ---------- B通知：返信 ----------
    pushReply(user, text, now) {
      bumpNotifBadge(now);
      const div = document.createElement("div");
      div.className = "list-item";
      div.innerHTML = `
        ${avatarHtml(user)}
        <div class="content">
          <div class="line1"><b>${escapeHtml(user.name)}</b> <span class="sub-handle">@${escapeHtml(user.handle)}</span></div>
          <div class="sub reply-line"><span class="reply-to">@you</span> ${escapeHtml(text)}</div>
        </div>
        <div class="icon-mark">💬</div>
      `;
      els.notifList.prepend(div);
      trimList(els.notifList, els.notifEmpty);
    },

    // ---------- B通知：引用（本文埋め込み表示） ----------
    pushQuote(user, text, now) {
      bumpNotifBadge(now);
      const html = `
        ${avatarHtml(user)}
        <div class="content">
          <div class="line1"><b>${escapeHtml(user.name)}</b> <span class="sub-handle">@${escapeHtml(user.handle)}</span> さんが引用しました</div>
          <div class="quote-comment">${escapeHtml(text)}</div>
          ${quoteEmbedHtml()}
        </div>
      `;

      const div = document.createElement("div");
      div.className = "list-item quote-item";
      div.innerHTML = html;
      els.notifList.prepend(div);
      trimList(els.notifList, els.notifEmpty);

      // ホーム画面の「引用ポスト」欄にも追加更新していく
      els.homeQuotes.classList.remove("hidden");
      const homeDiv = document.createElement("div");
      homeDiv.className = "list-item quote-item";
      homeDiv.innerHTML = html;
      els.homeQuotesList.prepend(homeDiv);
      while (els.homeQuotesList.children.length > MAX_HOME_QUOTES) {
        els.homeQuotesList.removeChild(els.homeQuotesList.lastElementChild);
      }
    },

    // ---------- C通知：DM ----------
    pushDM(dm, now) {
      bumpDmBadge(now);
      const div = document.createElement("div");
      div.className = "list-item";
      div.innerHTML = `
        ${avatarHtml(dm.user, "small")}
        <div class="content">
          <div class="line1"><b>${escapeHtml(dm.user.name)}</b> <span class="sub-handle">・${escapeHtml(dm.label)}</span></div>
          <div class="sub">${escapeHtml(dm.text)}</div>
        </div>
      `;
      els.dmList.prepend(div);
      trimList(els.dmList, els.dmEmpty);
    },

    onEnd() {
      els.tabbar.classList.add("hidden");

      const impressions = Math.round(
        (State.likes + State.reposts + State.replies) * (15 + Math.random() * 25) + State.totalNotifications * 1.6
      );

      const topReplyCat = Object.entries(State.replyCategoryCount).sort((a, b) => b[1] - a[1])[0];
      const catLabelMap = { empathy: "共感", normal: "普通", discussion: "議論", negative: "否定", meme: "ミーム" };
      const topDmCat = Object.entries(State.dmCategoryCount).sort((a, b) => b[1] - a[1])[0];

      let rank = "S";
      const score = State.totalNotifications;
      if (score > 4000000) rank = "LEGEND";
      else if (score > 1500000) rank = "SSS";
      else if (score > 600000) rank = "SS";
      else rank = "S";

      document.getElementById("result-rank").textContent = rank;
      document.getElementById("result-rank").className = "result-rank " + rank;
      document.getElementById("result-sub").textContent =
        rank === "LEGEND" ? "伝説的なバズを記録しました" :
        rank === "SSS" ? "驚異的な拡散を記録しました" :
        rank === "SS" ? "大きな反響がありました" : "しっかり反応がありました";

      document.getElementById("r-impressions").textContent = formatCount(impressions);
      document.getElementById("r-likes").textContent = formatCount(State.likes);
      document.getElementById("r-reposts").textContent = formatCount(State.reposts);
      document.getElementById("r-replies").textContent = formatCount(State.replies);
      document.getElementById("r-dms").textContent = formatCount(State.dmTotal);
      document.getElementById("r-total").textContent = formatCount(State.totalNotifications);
      document.getElementById("r-peak").textContent = `${formatCount(State.peakNotifPerSec)}/秒`;
      document.getElementById("r-trend").textContent =
        score > 1500000 ? "1位" : score > 600000 ? `${Math.ceil(Math.random() * 5) + 1}位` : `${Math.ceil(Math.random() * 20) + 5}位`;

      document.getElementById("r-top-reply").textContent = topReplyCat && topReplyCat[1] > 0 ? catLabelMap[topReplyCat[0]] : "-";
      document.getElementById("r-top-dm").textContent = topDmCat && topDmCat[1] > 0 ? topDmCat[0] : "-";

      switchScreen("result");
    },

    showStartOverlay() {
      els.startOverlay.classList.remove("hidden");
    },
    hideStartOverlay() {
      els.startOverlay.classList.add("hidden");
    },

    bindOverlayStart(fn) {
      els.overlayStartBtn.addEventListener("click", fn);
    },
    bindPostInput(fn) {
      els.postInput.addEventListener("input", fn);
    },
    bindPostBtn(fn) {
      els.postBtn.addEventListener("click", fn);
    },
    getPostBtn() { return els.postBtn; },
    getPostInputValue() { return els.postInput.value.trim(); },
  };
})();
