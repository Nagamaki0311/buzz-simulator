/**
 * render.js
 * DOM操作全般（画面切替、通知/DMリストの描画、カウンターアニメーション、
 * リザルト画面の生成）を担当する。ロジック側(engine.js)から呼び出される。
 */
const Render = (() => {
  const els = {};
  let activeTab = "home";
  let notifTabLastOpenedAt = 0;
  let dmTabLastOpenedAt = 0;

  const MAX_LIST_ITEMS = 260; // DOM肥大化を防ぐための表示上限（内部カウンタは別途無制限に加算）

  function cacheEls() {
    els.app = document.getElementById("app");
    els.postInput = document.getElementById("post-input");
    els.postBtn = document.getElementById("post-btn");
    els.composer = document.getElementById("composer");
    els.myPost = document.getElementById("my-post");
    els.myPostText = document.getElementById("my-post-text");
    els.homeHint = document.getElementById("home-hint");
    els.statLike = document.getElementById("stat-like");
    els.statRepost = document.getElementById("stat-repost");
    els.statReply = document.getElementById("stat-reply");
    els.statLikeWrap = document.querySelector(".stat.like");
    els.statRepostWrap = document.querySelector(".stat.repost");
    els.statReplyWrap = document.querySelector(".stat.reply");

    els.notifList = document.getElementById("notif-list");
    els.notifEmpty = document.getElementById("notif-empty");
    els.dmList = document.getElementById("dm-list");
    els.dmEmpty = document.getElementById("dm-empty");

    els.badgeNotif = document.getElementById("badge-notif");
    els.badgeDm = document.getElementById("badge-dm");

    els.tabbar = document.getElementById("tabbar");
    els.tabs = Array.from(document.querySelectorAll(".tab"));

    els.progressFill = document.getElementById("progress-fill");
    els.statusStrip = document.getElementById("status-strip");
    els.timerLabel = document.getElementById("timer-label");

    els.screens = {
      home: document.getElementById("screen-home"),
      notifications: document.getElementById("screen-notifications"),
      dm: document.getElementById("screen-dm"),
      result: document.getElementById("screen-result"),
    };

    els.startOverlay = document.getElementById("start-overlay");
    els.overlayStartBtn = document.getElementById("overlay-start-btn");
  }

  function formatCount(n) {
    if (n < 1000) return String(n);
    if (n < 1000000) return (n / 1000).toFixed(1) + "K";
    return (n / 1000000).toFixed(1) + "M";
  }

  function formatClock(ms) {
    const totalSec = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function bump(el) {
    el.classList.remove("bump");
    // reflow強制でアニメーションを再トリガー
    void el.offsetWidth;
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
    emptyEl.style.display = container.children.length ? "none" : "block";
  }

  function avatarHtml(user, size = "") {
    return `<div class="avatar ${size}" style="background:${user.color}">${user.emoji}</div>`;
  }

  return {
    init() {
      cacheEls();
    },

    setTheme(theme) {
      els.app.dataset.theme = theme;
    },

    switchScreen,

    bindTabs(onTabClick) {
      els.tabs.forEach(tab => {
        tab.addEventListener("click", () => onTabClick(tab.dataset.tab));
      });
    },

    onStart() {
      els.composer.style.display = "none";
      els.homeHint.style.display = "none";
      els.myPost.style.display = "block";
      els.myPostText.textContent = State.postText;
      els.statusStrip.style.display = "flex";
      els.notifList.innerHTML = "";
      els.dmList.innerHTML = "";
      els.notifEmpty.style.display = "block";
      els.dmEmpty.style.display = "block";
      this.updateHomeStats();
    },

    updateHomeStats() {
      els.statLike.textContent = formatCount(State.likes);
      els.statRepost.textContent = formatCount(State.reposts);
      els.statReply.textContent = formatCount(State.replies);
      bump(els.statLikeWrap.querySelector(".num"));
      bump(els.statRepostWrap.querySelector(".num"));
      bump(els.statReplyWrap.querySelector(".num"));
    },

    updateProgress(t, remainingMs) {
      els.progressFill.style.width = `${Math.min(100, t * 100)}%`;
      els.timerLabel.textContent = formatClock(remainingMs);
    },

    pushNotification(item) {
      State.notifications.unshift(item);

      // 未読バッジ加算判定：通知タブを開いた直後3秒間は加算を抑制する
      const now = Date.now();
      const graceActive = activeTab === "notifications" && (now - notifTabLastOpenedAt < 3000);
      if (!graceActive) {
        State.unreadCount++;
        updateBadge(els.badgeNotif, State.unreadCount);
      }

      const div = document.createElement("div");
      div.className = "list-item";
      div.innerHTML = `
        <div class="icon-mark">${item.icon}</div>
        <div class="content">
          <div class="line1"><b>${item.user.name}</b> <span style="color:var(--text-sub)">@${item.user.handle}</span></div>
          <div class="sub">${item.text.replace(item.user.name, "").trim() || item.text}</div>
        </div>
        <div class="time">たった今</div>
      `;
      els.notifList.prepend(div);
      trimList(els.notifList, els.notifEmpty);
    },

    pushDM(dm, timestamp) {
      State.dms.unshift({ ...dm, time: timestamp });

      const now = Date.now();
      const graceActive = activeTab === "dm" && (now - dmTabLastOpenedAt < 3000);
      if (!graceActive) {
        const unread = (els.badgeDm.textContent === "0" ? 0 : parseInt(els.badgeDm.textContent) || 0) + 1;
        updateBadge(els.badgeDm, unread);
      }

      const div = document.createElement("div");
      div.className = "list-item";
      div.innerHTML = `
        ${avatarHtml(dm.user, "small")}
        <div class="content">
          <div class="line1"><b>${dm.user.name}</b> <span style="color:var(--text-sub)">・${dm.label}</span></div>
          <div class="sub">${dm.text}</div>
        </div>
      `;
      els.dmList.prepend(div);
      trimList(els.dmList, els.dmEmpty);
    },

    onEnd() {
      els.statusStrip.style.display = "none";
      els.tabbar.classList.add("hidden");

      const impressions = Math.round(
        (State.likes + State.reposts + State.replies) * (15 + Math.random() * 25) + State.totalNotifications * 2
      );

      const topReplyCat = Object.entries(State.replyCategoryCount).sort((a, b) => b[1] - a[1])[0];
      const catLabelMap = { empathy: "共感", normal: "普通", discussion: "議論", negative: "否定", meme: "ミーム" };
      const topDmCat = Object.entries(State.dmCategoryCount).sort((a, b) => b[1] - a[1])[0];

      let rank = "S";
      const score = State.likes + State.reposts * 2 + State.replies * 1.5 + State.dms.length * 3;
      if (score > 20000) rank = "LEGEND";
      else if (score > 8000) rank = "SSS";
      else if (score > 3000) rank = "SS";
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
      document.getElementById("r-dms").textContent = formatCount(State.dms.length);
      document.getElementById("r-total").textContent = formatCount(State.totalNotifications);
      document.getElementById("r-peak").textContent = `${State.peakNotifPerSec}/秒`;
      document.getElementById("r-trend").textContent =
        score > 8000 ? "1位" : score > 3000 ? `${Math.ceil(Math.random() * 5) + 1}位` : `${Math.ceil(Math.random() * 20) + 5}位`;

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
