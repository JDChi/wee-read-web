(() => {
  "use strict";

  const HISTORY_KEY = "recentSearches";
  const HISTORY_LIMIT = 5;
  const SEARCH_INPUT = '.wr_index_page_search_bar_input[type="search"]';
  const SEARCH_WRAPPER = ".wr_index_page_search_bar_wrapper";
  const SEARCH_REQUEST_PATH = "/api/store/search";
  const RESULT_CARD = ".wr_search_content_card_content_item";

  const booksByToken = new Map();
  const shelfByBookId = new Map();
  const pendingAdds = new Set();
  const observedSearchUrls = new Set();
  let recentSearches = [];
  let historyReady = false;
  let historySave = Promise.resolve();
  let historyLoad = Promise.resolve();
  let activeKeyword = "";
  let searchGeneration = 0;
  let lastCommit = { keyword: "", at: 0 };
  let historyPanel = null;
  let renderQueued = false;
  let shelfCheckQueued = false;
  let shelfCheckRunning = false;
  let shelfCheckAgain = false;
  let statusMessage = null;

  const normalizedTerm = (value) => String(value || "").trim();

  function searchInput() {
    return document.querySelector(SEARCH_INPUT);
  }

  function rememberSearch(value) {
    const keyword = normalizedTerm(value);
    if (!keyword) return;
    historySave = historySave.then(async () => {
      await historyLoad;
      recentSearches = [keyword, ...recentSearches.filter((term) => term !== keyword)].slice(
        0,
        HISTORY_LIMIT,
      );
      historyReady = true;
      await chrome.storage.local.set({ [HISTORY_KEY]: recentSearches });
      renderHistory();
    }).catch(() => {
      showStatus("搜索记录暂时无法保存");
    });
  }

  function commitSearch(value) {
    const keyword = normalizedTerm(value);
    if (!keyword) return;
    const now = Date.now();
    if (lastCommit.keyword === keyword && now - lastCommit.at < 250) return;
    lastCommit = { keyword, at: now };
    activeKeyword = keyword;
    searchGeneration += 1;
    observedSearchUrls.clear();
    booksByToken.clear();
    shelfByBookId.clear();
    rememberSearch(keyword);
    hideHistory();
    scheduleRender();
  }

  function ensureHistoryPanel() {
    const input = searchInput();
    const wrapper = input?.closest(SEARCH_WRAPPER);
    const host = wrapper?.parentElement;
    if (!host) return null;
    if (historyPanel?.parentElement !== host) {
      historyPanel?.remove();
      historyPanel = document.createElement("div");
      historyPanel.className = "wr-helper-history";
      historyPanel.setAttribute("role", "group");
      historyPanel.setAttribute("aria-label", "最近搜索");
      historyPanel.hidden = true;
      host.classList.add("wr-helper-history-host");
      host.append(historyPanel);
    }
    return historyPanel;
  }

  function hideHistory() {
    if (historyPanel && !historyPanel.hidden) historyPanel.hidden = true;
  }

  function renderHistory() {
    const input = searchInput();
    const panel = ensureHistoryPanel();
    if (!panel) return;
    const shouldShow = historyReady && recentSearches.length > 0 &&
      document.activeElement === input && !normalizedTerm(input.value);
    if (panel.hidden === shouldShow) panel.hidden = !shouldShow;
    if (!shouldShow) return;

    panel.replaceChildren();
    const header = document.createElement("div");
    header.className = "wr-helper-history-heading";
    const title = document.createElement("span");
    title.textContent = "最近搜索";
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "wr-helper-history-clear";
    clear.textContent = "清空";
    clear.setAttribute("aria-label", "清空最近搜索");
    clear.addEventListener("click", async () => {
      await historyLoad;
      recentSearches = [];
      hideHistory();
      try {
        historySave = historySave.then(() => chrome.storage.local.set({ [HISTORY_KEY]: [] }));
        await historySave;
      } catch {
        showStatus("搜索记录暂时无法清空");
      }
      input.focus();
    });
    header.append(title, clear);
    panel.append(header);

    const list = document.createElement("div");
    list.className = "wr-helper-history-list";
    for (const term of recentSearches) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "wr-helper-history-item";
      button.textContent = term;
      button.title = term;
      button.addEventListener("click", () => {
        const currentInput = searchInput();
        if (!currentInput) return;
        currentInput.value = term;
        currentInput.focus();
        currentInput.dispatchEvent(new Event("input", { bubbles: true }));
        hideHistory();
        const enter = {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
        };
        currentInput.dispatchEvent(new KeyboardEvent("keydown", enter));
        currentInput.dispatchEvent(new KeyboardEvent("keyup", enter));
      });
      list.append(button);
    }
    panel.append(list);
  }

  function showStatus(message) {
    if (!statusMessage?.isConnected) {
      statusMessage = document.createElement("div");
      statusMessage.className = "wr-helper-status";
      statusMessage.setAttribute("role", "status");
      document.body.append(statusMessage);
    }
    statusMessage.textContent = message;
    statusMessage.hidden = false;
    clearTimeout(statusMessage.hideTimer);
    statusMessage.hideTimer = setTimeout(() => {
      statusMessage.hidden = true;
    }, 3500);
  }

  function bookToken(deepLink) {
    if (!deepLink) return null;
    try {
      const url = new URL(deepLink, location.origin);
      return url.searchParams.get("v") || url.pathname.match(/\/web\/reader\/([^/]+)/)?.[1] || null;
    } catch {
      return null;
    }
  }

  function collectBooks(response) {
    for (const section of response.results || []) {
      for (const entry of [...(section.books || []), ...(section.bookTexts || [])]) {
        const info = entry.bookInfo;
        const token = bookToken(info?.deepLink);
        if (!token || !info?.bookId || info.soldout !== 0) continue;
        booksByToken.set(token, {
          id: String(info.bookId),
          title: String(info.title || "这本书"),
        });
      }
    }
    scheduleShelfCheck();
    scheduleRender();
  }

  function handleSearchResource(resourceUrl) {
    let url;
    try {
      url = new URL(resourceUrl);
    } catch {
      return;
    }
    if (url.origin !== location.origin || url.pathname !== SEARCH_REQUEST_PATH) return;
    const keyword = normalizedTerm(url.searchParams.get("keyword"));
    if (!keyword) return;
    if (!activeKeyword) activeKeyword = normalizedTerm(searchInput()?.value);
    if (keyword !== activeKeyword || observedSearchUrls.has(url.href)) return;
    observedSearchUrls.add(url.href);
    const generation = searchGeneration;
    fetch(url.href, { credentials: "same-origin" })
      .then((response) => {
        if (!response.ok) throw new Error("搜索结果请求失败");
        return response.json();
      })
      .then((data) => {
        if (generation === searchGeneration && keyword === activeKeyword) collectBooks(data);
      })
      .catch(() => {
        // Leave the site's search experience untouched if metadata is unavailable.
      });
  }

  function scheduleShelfCheck() {
    if (shelfCheckQueued) return;
    shelfCheckQueued = true;
    queueMicrotask(() => {
      shelfCheckQueued = false;
      void checkShelf();
    });
  }

  async function checkShelf() {
    if (shelfCheckRunning) {
      shelfCheckAgain = true;
      return;
    }
    shelfCheckRunning = true;
    const generation = searchGeneration;
    let failed = false;
    let attempted = new Set();
    try {
      const ids = [...new Set([...booksByToken.values()].map((book) => book.id))]
        .filter((id) => !shelfByBookId.has(id));
      attempted = new Set(ids);
      for (let start = 0; start < ids.length; start += 40) {
        const batch = ids.slice(start, start + 40);
        const url = `/web/shelf/bookIds?bookIds=${encodeURIComponent(batch.join(","))}`;
        const response = await fetch(url, { credentials: "same-origin", cache: "no-store" });
        if (!response.ok) throw new Error("书架状态请求失败");
        const body = await response.json();
        if (generation !== searchGeneration) return;
        if (!Array.isArray(body.data)) throw new Error("书架状态不可用");
        for (const item of body.data) {
          if (batch.includes(String(item.bookId)) && (item.onShelf === 0 || item.onShelf === 1)) {
            shelfByBookId.set(String(item.bookId), item.onShelf === 1);
          }
        }
        scheduleRender();
      }
    } catch {
      failed = true;
      // Unknown membership must never produce an add button.
    } finally {
      shelfCheckRunning = false;
      if (shelfCheckAgain) {
        shelfCheckAgain = false;
        scheduleShelfCheck();
      } else if (generation === searchGeneration && !failed) {
        const newlyArrived = [...booksByToken.values()].some(
          (book) => !shelfByBookId.has(book.id) && !attempted.has(book.id),
        );
        if (newlyArrived) scheduleShelfCheck();
      }
    }
  }

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      renderButtons();
      if (historyPanel && !historyPanel.isConnected) historyPanel = null;
    });
  }

  function alignAddButton(card, metric, button) {
    const cardRect = card.getBoundingClientRect();
    const metricRect = metric.getBoundingClientRect();
    button.style.top = `${Math.round(metricRect.bottom - cardRect.top + 10)}px`;
    button.style.right = `${Math.max(0, Math.round(cardRect.right - metricRect.right))}px`;
  }

  function renderButtons() {
    for (const card of document.querySelectorAll(RESULT_CARD)) {
      const link = card.querySelector('a[href*="/web/reader/"]');
      const token = link?.getAttribute("href")?.match(/\/web\/reader\/([^/?#]+)/)?.[1];
      const book = token ? booksByToken.get(token) : null;
      const existing = card.querySelector(".wr-helper-add-button");
      const metric = card.querySelector(".wr_index_page_mini_bookInfo_content_info_extra");
      const show = book && shelfByBookId.get(book.id) === false;
      if (!show || !metric) {
        existing?.remove();
        card.classList.remove("wr-helper-card");
        card.querySelector(".wr_index_page_mini_bookInfo_content_title")?.classList.remove("wr-helper-title-row");
        continue;
      }
      if (existing?.dataset.bookId === book.id) {
        if (existing.parentElement !== card) card.append(existing);
        card.classList.add("wr-helper-card");
        const isPending = pendingAdds.has(book.id);
        const label = isPending ? "加入中…" : "加入书架";
        if (existing.disabled !== isPending) existing.disabled = isPending;
        if (existing.textContent !== label) existing.textContent = label;
        alignAddButton(card, metric, existing);
        continue;
      }
      existing?.remove();
      const button = document.createElement("button");
      button.type = "button";
      button.className = "wr-helper-add-button";
      button.dataset.bookId = book.id;
      button.textContent = "加入书架";
      button.setAttribute("aria-label", `将《${book.title}》加入书架`);
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void addToShelf(book.id);
      });
      card.classList.add("wr-helper-card");
      card.append(button);
      alignAddButton(card, metric, button);
    }
  }

  async function addToShelf(bookId) {
    if (pendingAdds.has(bookId) || shelfByBookId.get(bookId) !== false) return;
    pendingAdds.add(bookId);
    scheduleRender();
    try {
      const response = await fetch("/mp/shelf/addToShelf", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json;charset=UTF-8" },
        body: JSON.stringify({ bookIds: [bookId] }),
      });
      const body = await response.json();
      if (!response.ok || body.succ !== 1) {
        const code = body.errCode;
        if (code === -2010 || code === -2012) throw new Error("请先登录微信读书");
        if (code === -2001) throw new Error("书架已满，暂时无法加入");
        throw new Error("加入书架失败，请重试");
      }
      shelfByBookId.set(bookId, true);
      showStatus("已加入书架");
    } catch (error) {
      const knownMessages = new Set(["请先登录微信读书", "书架已满，暂时无法加入"]);
      showStatus(error instanceof Error && knownMessages.has(error.message)
        ? error.message
        : "加入书架失败，请重试");
    } finally {
      pendingAdds.delete(bookId);
      scheduleRender();
    }
  }

  document.addEventListener("submit", (event) => {
    const input = event.target?.querySelector?.(SEARCH_INPUT);
    if (input) commitSearch(input.value);
  }, true);

  document.addEventListener("keydown", (event) => {
    const input = searchInput();
    if (event.target === input && event.key === "Enter" && !event.isComposing) {
      commitSearch(input.value);
    } else if (event.target === input && event.key === "ArrowDown" && !historyPanel?.hidden) {
      const first = historyPanel.querySelector(".wr-helper-history-item");
      if (first) {
        event.preventDefault();
        first.focus();
      }
    } else if (event.key === "Escape" && !historyPanel?.hidden) {
      hideHistory();
      if (historyPanel?.contains(event.target)) input?.focus();
    } else if (historyPanel?.contains(event.target) && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      const items = [...historyPanel.querySelectorAll(".wr-helper-history-item")];
      const current = items.indexOf(event.target);
      if (current >= 0 && items.length) {
        event.preventDefault();
        const next = (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next].focus();
      }
    }
  }, true);

  document.addEventListener("focusin", (event) => {
    if (event.target === searchInput()) renderHistory();
    else if (!historyPanel?.contains(event.target)) hideHistory();
  });
  document.addEventListener("input", (event) => {
    if (event.target === searchInput()) renderHistory();
  });
  document.addEventListener("pointerdown", (event) => {
    if (event.target !== searchInput() && !historyPanel?.contains(event.target)) hideHistory();
  });
  window.addEventListener("resize", scheduleRender);

  historyLoad = chrome.storage.local.get(HISTORY_KEY).then((data) => {
    recentSearches = Array.isArray(data[HISTORY_KEY]) ? data[HISTORY_KEY].slice(0, HISTORY_LIMIT) : [];
    historyReady = true;
    renderHistory();
  }).catch(() => {
    historyReady = true;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[HISTORY_KEY]) return;
    recentSearches = Array.isArray(changes[HISTORY_KEY].newValue)
      ? changes[HISTORY_KEY].newValue.slice(0, HISTORY_LIMIT)
      : [];
    historyReady = true;
    renderHistory();
  });

  activeKeyword = normalizedTerm(searchInput()?.value);
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) handleSearchResource(entry.name);
    });
    observer.observe({ type: "resource", buffered: true });
  } catch {
    // Search history still works if resource timing is unavailable.
  }
  for (const entry of performance.getEntriesByType("resource")) handleSearchResource(entry.name);

  const domObserver = new MutationObserver(() => {
    ensureHistoryPanel();
    scheduleRender();
  });
  domObserver.observe(document.documentElement, { childList: true, subtree: true });
  ensureHistoryPanel();
})();
