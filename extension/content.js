(() => {
  "use strict";

  const HISTORY_KEY = "recentSearches";
  const READING_PROGRESS_KEY = "showReadingProgress";
  const HISTORY_LIMIT = 5;
  const SEARCH_INPUT = '.wr_index_page_search_bar_input[type="search"]';
  const SEARCH_WRAPPER = ".wr_index_page_search_bar_wrapper";
  const SEARCH_REQUEST_PATH = "/api/store/search";
  const RESULT_CARD = ".wr_search_content_card_content_item";
  const FULL_RESULT_CARD = ".search_bookDetail_list > .wr_bookList_item";
  const HOME_SUGGESTION = ".wr_index_page_top_section_content_suggestions > a.wr_suggestion_card_wrapper";
  const HOME_RANK_BOOK = ".wr_index_page_rank_list_card_content_info > a.wr_index_page_mini_bookInfo";
  const PREVIEW_ID = "wr-helper-book-preview";
  const PREVIEW_DELAY = 300;
  const PREVIEW_CLOSE_DELAY = 180;
  const PREVIEW_EXPAND_DURATION = 200;
  const PREVIEW_COLLAPSE_DURATION = 160;
  const PREVIEW_FADE_DURATION = 120;

  const booksByToken = new Map();
  const previewBooksByToken = new Map();
  const bookDetailsByUrl = new Map();
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
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
  let previewPanel = null;
  let previewSurface = null;
  let previewContent = null;
  let previewMotion = null;
  let activePreview = null;
  let hoveredPreview = null;
  let previewSelectionPointer = null;
  let previewOpenTimer;
  let previewCloseTimer;

  const normalizedTerm = (value) => String(value || "").trim();

  if (/^\/web\/reader\/[\w-]+\/?$/.test(location.pathname)) {
    let settingChanged = false;
    const setProgressDisplay = (value) => {
      document.dispatchEvent(new CustomEvent("wr-helper-reading-progress-setting", {
        detail: value !== false,
      }));
    };
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes[READING_PROGRESS_KEY]) return;
      settingChanged = true;
      setProgressDisplay(changes[READING_PROGRESS_KEY].newValue);
    });
    chrome.storage.local.get(READING_PROGRESS_KEY).then((data) => {
      if (!settingChanged) setProgressDisplay(data[READING_PROGRESS_KEY]);
    }).catch(() => {});
  }

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
    previewBooksByToken.clear();
    shelfByBookId.clear();
    hoveredPreview = null;
    closePreview();
    rememberSearch(keyword);
    hideHistory();
    scheduleRender();
  }

  function ensureHistoryPanel() {
    const input = searchInput();
    const wrapper = input?.closest(SEARCH_WRAPPER);
    const host = wrapper?.parentElement;
    if (!host || !document.body) {
      hideHistory();
      return null;
    }
    if (!historyPanel) {
      historyPanel = document.createElement("div");
      historyPanel.className = "wr-helper-history";
      historyPanel.setAttribute("role", "group");
      historyPanel.setAttribute("aria-label", "最近搜索");
      historyPanel.hidden = true;
    }
    if (historyPanel.parentElement !== document.body) document.body.append(historyPanel);
    return historyPanel;
  }

  function positionHistoryPanel() {
    if (!historyPanel || historyPanel.hidden) return;
    const host = searchInput()?.closest(SEARCH_WRAPPER)?.parentElement;
    if (!host) return hideHistory();
    const rect = host.getBoundingClientRect();
    historyPanel.style.top = `${rect.bottom + 8}px`;
    historyPanel.style.left = `${rect.left}px`;
    historyPanel.style.width = `${rect.width}px`;
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
    positionHistoryPanel();

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
        if (!info?.bookId) continue;
        const token = bookToken(info?.deepLink);
        const readerUrl = previewBookUrl(info.readerLink);
        const previewToken = readerUrl?.pathname.split("/")[3] || token;
        if (previewToken) {
          const intro = typeof info.intro === "string" ? info.intro.trim() : "";
          const previous = previewBooksByToken.get(previewToken);
          previewBooksByToken.set(previewToken, {
            title: normalizedTerm(info.title) || previous?.title,
            author: normalizedTerm(info.author) || previous?.author,
            intro: intro || previous?.intro,
          });
        }
        if (!token || info.soldout !== 0) continue;
        booksByToken.set(token, {
          id: String(info.bookId),
          title: String(info.title || "这本书"),
        });
      }
    }
    if (activePreview?.waitingForBook && previewBooksByToken.has(activePreview.token)) {
      activePreview.waitingForBook = false;
      void showPreview(activePreview);
    }
    scheduleShelfCheck();
    scheduleRender();
  }

  function previewBookUrl(href) {
    if (!href) return null;
    try {
      const url = new URL(href, location.origin);
      if (url.origin === location.origin && /^\/web\/(reader|bookDetail)\/[\w-]+\/?$/.test(url.pathname)) {
        return new URL(url.pathname.replace(/\/$/, ""), location.origin);
      }
    } catch {
      // Skip cards whose book link cannot be identified.
    }
    return null;
  }

  function introductionText(node) {
    const copy = node.cloneNode(true);
    for (const br of copy.querySelectorAll("br")) br.replaceWith("\n");
    return copy.textContent.trim();
  }

  function pointerOverRect(pointer, rect) {
    return pointer.clientX >= rect.left && pointer.clientX < rect.right &&
      pointer.clientY >= rect.top && pointer.clientY < rect.bottom;
  }

  function getPreviewTarget(element, pointer) {
    const card = element.closest(`${RESULT_CARD}, ${FULL_RESULT_CARD}, ${HOME_SUGGESTION}, ${HOME_RANK_BOOK}`);
    if (!card) return null;
    const full = card.matches(FULL_RESULT_CARD);
    const compactSearch = card.matches(RESULT_CARD);
    const home = !full && !compactSearch;
    if (home && location.pathname !== "/") return null;
    const suggestion = home && card.matches(HOME_SUGGESTION);
    const link = home ? card : card.querySelector(full ? ".wr_bookList_item_link" : ".wr_index_page_mini_bookInfo");
    const coverSelector = full ? ".wr_bookList_item_cover"
      : suggestion ? ".wr_suggestion_card_cover" : ".wr_index_page_mini_bookInfo_cover_wrapper";
    const cover = card.querySelector(coverSelector);
    const url = previewBookUrl(link?.getAttribute("href"));
    if (!cover || !url) return null;

    if (pointer) {
      // The full search card's link can overlay the cover as a sibling.
      if (!cover.contains(element) && !link.contains(element)) return null;
      if (!pointerOverRect(pointer, cover.getBoundingClientRect())) return null;
    } else if (element !== link) {
      return null;
    }

    const token = url.pathname.split("/")[3];
    const homePoint = home && pointer ? { clientX: pointer.clientX, clientY: pointer.clientY } : null;
    return { card, cover, link, url, token, full, compactSearch, suggestion, homePoint, hover: Boolean(pointer), page: location.href };
  }

  function fetchBookDetails(url) {
    if (bookDetailsByUrl.has(url.href)) return bookDetailsByUrl.get(url.href);
    const request = (async () => {
      try {
        const response = await fetch(url.href, {
          credentials: "omit",
          redirect: "error",
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) return null;
        const page = new DOMParser().parseFromString(await response.text(), "text/html");
        const dialog = page.querySelector(".introDialog_content");
        const paragraphs = dialog?.querySelectorAll(".introDialog_content_intro_para") || [];
        const flyleaf = page.querySelector(".wr_flyleaf_page_bookIntro_content");
        const intro = [...paragraphs].map(introductionText).filter(Boolean).join("\n\n") ||
          (flyleaf ? introductionText(flyleaf) : "");
        const publication = new Map();
        for (const row of dialog?.querySelectorAll(".introDialog_content_pub_line") || []) {
          const label = row.querySelector(".introDialog_content_pub_title");
          const value = row.lastElementChild;
          if (label && value && value !== label) {
            publication.set(label.textContent.trim(), value.textContent.trim());
          }
        }
        return { intro, publisher: publication.get("出版社"), published: publication.get("出版时间") };
      } catch {
        return null;
      }
    })().then((details) => {
      if (!details?.intro && !details?.publisher && !details?.published) bookDetailsByUrl.delete(url.href);
      return details;
    });
    bookDetailsByUrl.set(url.href, request);
    return request;
  }

  function describePreview(visible) {
    const link = activePreview?.link;
    previewPanel?.setAttribute("aria-hidden", String(!visible));
    if (!link) return;
    const previous = (link.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
    const descriptions = previous.filter((id) => id !== PREVIEW_ID);
    if (visible) descriptions.push(PREVIEW_ID);
    if (descriptions.length) link.setAttribute("aria-describedby", descriptions.join(" "));
    else if (previous.length) link.removeAttribute("aria-describedby");
  }

  function stopPreviewMotion() {
    if (!previewMotion) return;
    const { frame, genie } = previewMotion;
    previewMotion = null;
    cancelAnimationFrame(frame);
    if (genie) removePreviewGenie(genie);
    previewSurface.style.opacity = "";
    previewPanel.classList.remove("wr-helper-book-preview-moving");
  }

  function closePreview() {
    clearTimeout(previewOpenTimer);
    previewOpenTimer = undefined;
    previewSelectionPointer = null;
    cancelPreviewClose();
    stopPreviewMotion();
    if (previewPanel?.hidden === false) {
      describePreview(false);
      previewPanel.hidden = true;
    }
    activePreview = null;
  }

  function settlePreviewMotion() {
    if (previewMotion?.closing) closePreview();
    else stopPreviewMotion();
  }

  // The clipped DOM strips and projective mapping follow Raphael Salaja’s “The Genie Effect”.
  // https://www.raphaelsalaja.com/work/genie#drawing-it-on-the-web
  // Here the strips follow our Canvas Bézier outline, with a fixed cap on DOM copies.
  function createPreviewGenieStrips(canvas, panel, horizontal, style) {
    const layer = previewElement("div", "genie-text");
    layer.style.cssText = canvas.style.cssText;
    layer.setAttribute("aria-hidden", "true");
    layer.inert = true;
    const depth = horizontal ? panel.width : panel.height;
    const across = horizontal ? panel.height : panel.width;
    const count = Math.min(16, Math.ceil(depth / 24));
    // Account for the hidden scrollbar so the copies preserve text wrapping and scroll position.
    const scrollbarWidth = previewSurface.offsetWidth - previewSurface.clientWidth -
      Number.parseFloat(style.borderLeftWidth) - Number.parseFloat(style.borderRightWidth);
    const contentWidth = panel.width - Math.max(0, scrollbarWidth);
    const scrollTop = previewSurface.scrollTop;
    const strips = [];
    for (let index = 0; index < count; index += 1) {
      // A subpixel overlap keeps the antialiased edges of adjacent strips from leaving seams.
      const from = Math.max(0, depth * index / count - 0.35);
      const to = Math.min(depth, depth * (index + 1) / count + 0.35);
      const element = previewElement("div", "genie-strip");
      element.style.width = `${horizontal ? to - from : across}px`;
      element.style.height = `${horizontal ? across : to - from}px`;
      const copy = previewSurface.cloneNode(true);
      copy.style.left = `${horizontal ? -from : 0}px`;
      copy.style.top = `${horizontal ? 0 : -from}px`;
      copy.style.width = `${contentWidth}px`;
      copy.style.height = `${panel.height}px`;
      copy.style.removeProperty("opacity");
      element.append(copy);
      layer.append(element);
      strips.push({ element, copy, from, to });
    }
    previewPanel.append(canvas, layer);
    if (scrollTop) {
      for (const { copy } of strips) copy.scrollTop = scrollTop;
    }
    return { layer, strips, depth, across };
  }

  function createPreviewGenie(cover, panel) {
    const right = panel.left - cover.right;
    const left = cover.left - panel.right;
    const below = panel.top - cover.bottom;
    const above = cover.top - panel.bottom;
    const horizontal = Math.max(right, left) >= 4;
    const forward = horizontal ? right >= left : below >= above;
    const gap = horizontal ? Math.max(right, left) : Math.max(below, above);
    if (gap < 4 || !cover.width || !cover.height || !panel.width || !panel.height) return null;

    const x = Math.max(0, Math.floor(Math.min(cover.left, panel.left)) - 2);
    const y = Math.max(0, Math.floor(Math.min(cover.top, panel.top)) - 2);
    const width = Math.min(document.documentElement.clientWidth, Math.ceil(Math.max(cover.right, panel.right)) + 2) - x;
    const height = Math.min(document.documentElement.clientHeight, Math.ceil(Math.max(cover.bottom, panel.bottom)) + 2) - y;
    if (width <= 0 || height <= 0) return null;
    const canvas = previewElement("canvas", "genie");
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.ceil(width * ratio);
    canvas.height = Math.ceil(height * ratio);
    canvas.style.left = `${x}px`;
    canvas.style.top = `${y}px`;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.setAttribute("aria-hidden", "true");
    const context = canvas.getContext("2d");
    if (!context) return null;

    // In local coordinates x runs from the cover toward the panel; y runs along the edges.
    const center = horizontal ? cover.top + cover.height / 2 : cover.left + cover.width / 2;
    const edge = horizontal ? (forward ? cover.right : cover.left) : (forward ? cover.bottom : cover.top);
    const direction = forward ? 1 : -1;
    const depthOrigin = edge - (horizontal ? x : y);
    const crossOrigin = center - (horizontal ? y : x);
    context.setTransform(horizontal ? direction * ratio : 0, horizontal ? 0 : direction * ratio,
      horizontal ? 0 : ratio, horizontal ? ratio : 0,
      (horizontal ? depthOrigin : crossOrigin) * ratio, (horizontal ? crossOrigin : depthOrigin) * ratio);
    const style = getComputedStyle(previewSurface);
    context.fillStyle = style.backgroundColor;
    context.strokeStyle = style.borderTopColor;
    context.lineWidth = 1;
    return {
      ...createPreviewGenieStrips(canvas, panel, horizontal, style),
      canvas, context, gap, horizontal, direction, depthOrigin, crossOrigin,
      start: (horizontal ? panel.top : panel.left) - center,
      end: (horizontal ? panel.bottom : panel.right) - center,
      throat: Math.min((horizontal ? cover.height : cover.width) * 0.13,
        (horizontal ? panel.height : panel.width) * 0.065),
      radius: Number.parseFloat(style.borderTopLeftRadius) || 0,
    };
  }

  function easePreview(progress) {
    return progress * progress * (3 - 2 * progress);
  }

  function previewGenieSection(frame, fraction) {
    const { x1, x2, inner1, inner2, top1, top2, bottom1, bottom2 } = frame;
    const x = x1 + (x2 - x1) * fraction;
    if (x <= inner1) return { x, top: top1, bottom: bottom1 };
    if (x >= inner2) return { x, top: top2, bottom: bottom2 };

    // Invert the x component by bisection, using the same control points as drawPreviewGenie.
    const target = (x - inner1) / (inner2 - inner1);
    let low = 0;
    let high = 1;
    for (let step = 0; step < 12; step += 1) {
      const t = (low + high) / 2;
      const u = 1 - t;
      const depth = 3 * u * t * (0.45 * u + 0.55 * t) + t * t * t;
      if (depth < target) low = t;
      else high = t;
    }
    const mix = easePreview((low + high) / 2);
    return { x, top: top1 + (top2 - top1) * mix, bottom: bottom1 + (bottom2 - bottom1) * mix };
  }

  function projectPreviewGenieStrips(genie, frame) {
    const { strips, horizontal, direction, depthOrigin, crossOrigin, depth, across } = genie;
    for (const { element, from, to } of strips) {
      // Strip order follows the screen axes. Sample the outline in reverse for leftward and upward warps.
      const first = previewGenieSection(frame, direction > 0 ? from / depth : 1 - from / depth);
      const last = previewGenieSection(frame, direction > 0 ? to / depth : 1 - to / depth);
      const span = first.bottom - first.top;
      const ratio = span / (last.bottom - last.top);
      if (span <= 0 || ratio <= 0 || !Number.isFinite(ratio)) return false;

      // Parallel sides make perspective depend on depth alone. The divisor w goes from 1
      // at the first edge to span / lastSpan at the last, giving each edge its own scale.
      const length = to - from;
      const alongStart = depthOrigin + direction * first.x;
      const acrossStart = crossOrigin + first.top;
      const along = (ratio * (depthOrigin + direction * last.x) - alongStart) / length;
      const shear = (ratio * (crossOrigin + last.top) - acrossStart) / length;
      const scale = span / across;
      const perspective = (ratio - 1) / length;
      const matrix = horizontal
        ? [along, shear, 0, perspective, 0, scale, 0, 0, 0, 0, 1, 0, alongStart, acrossStart, 0, 1]
        : [scale, 0, 0, 0, shear, along, 0, perspective, 0, 0, 1, 0, acrossStart, alongStart, 0, 1];
      element.style.transform = `matrix3d(${matrix.join(",")})`;
    }
    return true;
  }

  function drawPreviewGenie(genie, progress) {
    const { canvas, context, gap, depth, start, end, throat } = genie;
    context.save();
    context.resetTransform();
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.restore();

    // The far edge leads while the near edge stays narrow and attached to the cover.
    const far = easePreview(Math.min(progress / 0.86, 1));
    const nearStart = 0.44;
    const near = easePreview(Math.max(0, (progress - nearStart) / (1 - nearStart)));
    const x1 = gap * near;
    const x2 = (gap + depth) * far;
    genie.layer.hidden = x2 - x1 < 1;
    if (genie.layer.hidden) return true;
    const top1 = -throat + (start + throat) * near;
    const top2 = -throat + (start + throat) * far;
    const bottom1 = throat + (end - throat) * near;
    const bottom2 = throat + (end - throat) * far;
    const radius = Math.min(genie.radius, (x2 - x1) / 3, (bottom1 - top1) / 2, (bottom2 - top2) / 2);
    const inner1 = x1 + radius;
    const inner2 = x2 - radius;
    const control1 = inner1 + (inner2 - inner1) * 0.45;
    const control2 = inner2 - (inner2 - inner1) * 0.45;

    context.beginPath();
    context.moveTo(x1, top1 + radius);
    context.quadraticCurveTo(x1, top1, inner1, top1);
    context.bezierCurveTo(control1, top1, control2, top2, inner2, top2);
    context.quadraticCurveTo(x2, top2, x2, top2 + radius);
    context.lineTo(x2, bottom2 - radius);
    context.quadraticCurveTo(x2, bottom2, inner2, bottom2);
    context.bezierCurveTo(control2, bottom2, control1, bottom1, inner1, bottom1);
    context.quadraticCurveTo(x1, bottom1, x1, bottom1 - radius);
    context.closePath();
    context.fill();
    context.stroke();
    return projectPreviewGenieStrips(genie, { x1, x2, inner1, inner2, top1, top2, bottom1, bottom2 });
  }

  function removePreviewGenie(genie) {
    // Restore the original surface so scrolling, selection, and backdrop blur can resume.
    genie.canvas.remove();
    genie.layer.remove();
    previewPanel.classList.remove("wr-helper-book-preview-shaping");
  }

  function paintPreviewMotion(motion) {
    if (motion.genie) {
      if (drawPreviewGenie(motion.genie, motion.progress)) return;
      removePreviewGenie(motion.genie);
      motion.genie = null;
    }
    previewSurface.style.opacity = String(easePreview(motion.progress));
  }

  function stepPreviewMotion(now) {
    const motion = previewMotion;
    if (!motion) return;
    if (!activePreview || !previewIsCurrent(activePreview)) return closePreview();
    const { closing, genie } = motion;
    const duration = genie ? (closing ? PREVIEW_COLLAPSE_DURATION : PREVIEW_EXPAND_DURATION) : PREVIEW_FADE_DURATION;
    const change = Math.max(0, now - motion.time) / duration;
    motion.time = now;
    motion.progress = Math.max(0, Math.min(1, motion.progress + (closing ? -change : change)));
    if (motion.progress === (closing ? 0 : 1)) {
      settlePreviewMotion();
      return;
    }
    paintPreviewMotion(motion);
    motion.frame = requestAnimationFrame(stepPreviewMotion);
  }

  function playPreviewMotion(closing) {
    if (!activePreview.hover || reducedMotion.matches) {
      if (closing) closePreview();
      else stopPreviewMotion();
      return;
    }
    if (previewMotion) {
      // Keep the current geometry and progress when the pointer reverses the animation.
      previewMotion.closing = closing;
      previewMotion.time = performance.now();
      return;
    }
    stopPreviewMotion();
    const genie = createPreviewGenie(activePreview.cover.getBoundingClientRect(), previewPanel.getBoundingClientRect());
    const progress = closing ? 1 : 0;
    previewPanel.classList.add("wr-helper-book-preview-moving");
    if (genie) previewPanel.classList.add("wr-helper-book-preview-shaping");
    previewMotion = { closing, genie, progress, time: performance.now(), frame: null };
    paintPreviewMotion(previewMotion);
    previewMotion.frame = requestAnimationFrame(stepPreviewMotion);
  }

  function previewIsCurrent(preview) {
    return activePreview === preview && preview.page === location.href && preview.cover.isConnected &&
      preview.link.isConnected && previewBookUrl(preview.link.getAttribute("href"))?.href === preview.url.href;
  }

  function retryHomePreview(previous, attempts = 2) {
    previewOpenTimer = setTimeout(() => {
      previewOpenTimer = undefined;
      if (hoveredPreview !== previous || previous.page !== location.href) return;
      const point = previous.homePoint;
      const element = document.elementFromPoint(point.clientX, point.clientY);
      const replacement = element && getPreviewTarget(element, point);
      if (replacement?.homePoint) {
        hoveredPreview = replacement;
        activePreview = replacement;
        void showPreview(replacement);
      } else if (attempts > 1) {
        retryHomePreview(previous, attempts - 1);
      }
    }, PREVIEW_DELAY);
  }

  function positionPreview() {
    if (!activePreview) return;
    if (!previewIsCurrent(activePreview)) {
      const previous = activePreview;
      closePreview();
      if (hoveredPreview === previous && previous.homePoint && previous.page === location.href) {
        // The homepage briefly leaves the cover position empty when replacing its cards.
        retryHomePreview(previous);
      }
      return;
    }
    if (previewPanel?.hidden !== false) return;
    const cover = activePreview.cover.getBoundingClientRect();
    const width = document.documentElement.clientWidth;
    const height = document.documentElement.clientHeight;
    if (cover.width <= 0 || cover.height <= 0 || cover.top >= height || cover.bottom <= 0 ||
        cover.left >= width || cover.right <= 0) return closePreview();
    const gap = 8;
    const panelWidth = previewPanel.offsetWidth;
    const panelHeight = previewPanel.offsetHeight;
    const side = cover.right + gap + panelWidth <= width - gap ? cover.right + gap : cover.left - gap - panelWidth;
    const stacked = side < gap;
    const below = cover.bottom + gap + panelHeight <= height - gap;
    const top = stacked ? (below ? cover.bottom + gap : cover.top - gap - panelHeight) : cover.top;
    previewPanel.style.left = `${Math.max(gap, Math.min(width - panelWidth - gap, stacked ? cover.left : side))}px`;
    previewPanel.style.top = `${Math.max(gap, Math.min(height - panelHeight - gap, top))}px`;
  }

  function previewTitle(preview, info) {
    if (!preview.full && info?.title) return info.title;
    const selector = preview.full ? ".wr_bookList_item_title"
      : preview.suggestion ? ".wr_suggestion_card_content_title" : ".wr_index_page_mini_bookInfo_content_title";
    const title = preview.card.querySelector(selector)?.cloneNode(true);
    title?.querySelector(".wr_index_page_mini_bookInfo_content_info_extra")?.remove();
    return title?.textContent.trim() || info?.title || "书籍简介";
  }

  function previewElement(tag, part, text = "") {
    const element = document.createElement(tag);
    element.className = `wr-helper-book-preview-${part}`;
    if (text) element.textContent = text;
    return element;
  }

  function updatePreviewTitle(event) {
    const titleRow = previewContent.firstElementChild;
    if (!titleRow) return;
    const scrollTop = Math.max(0, event.currentTarget.scrollTop);
    const progress = Math.min(1, scrollTop / 32);
    titleRow.firstElementChild.style.setProperty("--wr-helper-preview-title-scale", 1 - 0.16 * progress);
    titleRow.nextElementSibling.style.setProperty("--wr-helper-preview-scroll-top", `${scrollTop}px`);
  }

  function renderPreviewContent(preview, info, details, intro) {
    const titleRow = previewElement("div", "title-row");
    titleRow.append(previewElement("div", "title", previewTitle(preview, info)));
    const header = previewElement("div", "header");
    const authorSelector = preview.full ? ".wr_bookList_item_author"
      : preview.suggestion ? ".wr_suggestion_card_content_author" : ".wr_index_page_mini_bookInfo_content_author";
    const author = info?.author || preview.card.querySelector(authorSelector)?.textContent.trim();
    if (author) header.append(previewElement("div", "author", author));
    const publication = [details?.publisher, details?.published].filter(Boolean).join(" · ");
    if (publication) header.append(previewElement("div", "publication", publication));

    const body = previewElement("div", "intro");
    // Some WeRead introductions flatten paragraph breaks to one space after Chinese sentence punctuation.
    const formatted = intro.replace(/\r\n?/g, "\n")
      .replace(/([。！？]) (?=\p{Script=Han})/gu, "$1\n\n");
    for (const paragraph of formatted.split(/\n[^\S\n]*\n/)) {
      if (!paragraph.trim()) continue;
      const text = document.createElement("p");
      text.textContent = paragraph.trim();
      body.append(text);
    }
    const scrollContent = previewElement("div", "scroll-content");
    scrollContent.append(header, body);
    previewContent.replaceChildren(titleRow, scrollContent);
  }

  async function showPreview(preview) {
    if (!previewIsCurrent(preview)) return;
    const info = previewBooksByToken.get(preview.token);
    if (preview.compactSearch && !info) {
      preview.waitingForBook = true;
      return;
    }
    const introNode = preview.full ? preview.card.querySelector(".wr_bookList_item_desc") : null;
    const available = (introNode && introductionText(introNode)) || info?.intro;
    if (!available && !preview.url.pathname.startsWith("/web/reader/")) return closePreview();
    const details = await (available ? bookDetailsByUrl.get(preview.url.href) : fetchBookDetails(preview.url));
    if (!previewIsCurrent(preview)) return;
    const intro = available || details?.intro;
    if (!intro) return closePreview();
    if (!previewPanel?.isConnected) {
      previewPanel = document.createElement("div");
      previewPanel.id = PREVIEW_ID;
      previewPanel.className = "wr-helper-book-preview";
      previewPanel.setAttribute("role", "tooltip");
      previewPanel.hidden = true;
      previewPanel.addEventListener("pointerenter", cancelPreviewClose);
      previewSurface = previewElement("div", "surface");
      previewSurface.addEventListener("scroll", updatePreviewTitle, { passive: true });
      previewSurface.addEventListener("pointerdown", (event) => {
        if (event.pointerType !== "mouse" || event.button !== 0) return;
        previewSelectionPointer = event.pointerId;
        hoveredPreview = null;
        cancelPreviewClose();
      });
      previewContent = previewElement("div", "content");
      previewSurface.append(previewContent);
      previewPanel.append(previewSurface);
      document.body.append(previewPanel);
    }
    renderPreviewContent(preview, info, details, intro);
    previewPanel.hidden = false;
    previewSurface.scrollTop = 0;
    positionPreview();
    if (!previewIsCurrent(preview)) return;
    describePreview(true);
    playPreviewMotion(false);
  }

  function startPreview(preview) {
    cancelPreviewClose();
    if (activePreview?.cover === preview.cover && activePreview.url.href === preview.url.href &&
        previewIsCurrent(activePreview)) {
      if (!preview.hover) {
        activePreview.hover = false;
        if (previewOpenTimer !== undefined) {
          clearTimeout(previewOpenTimer);
          previewOpenTimer = undefined;
          void showPreview(activePreview);
        }
      }
      if (previewMotion?.closing) {
        describePreview(true);
        playPreviewMotion(false);
      } else if (!preview.hover) {
        stopPreviewMotion();
      }
      return;
    }
    closePreview();
    activePreview = preview;
    if (preview.hover) {
      previewOpenTimer = setTimeout(() => {
        previewOpenTimer = undefined;
        void showPreview(preview);
      }, PREVIEW_DELAY);
    } else {
      void showPreview(preview);
    }
  }

  function cancelPreviewClose() {
    clearTimeout(previewCloseTimer);
    previewCloseTimer = undefined;
  }

  function previewSelectionInUse() {
    if (previewSelectionPointer !== null) return true;
    if (previewPanel?.hidden !== false) return false;
    const selection = window.getSelection();
    return Boolean(selection && !selection.isCollapsed && previewSurface.contains(selection.anchorNode));
  }

  function finishPreviewSelection() {
    if (previewSelectionPointer === null) return;
    previewSelectionPointer = null;
    if (!previewPanel?.matches(":hover")) leavePreview();
  }

  function leavePreview() {
    if (!activePreview || previewMotion?.closing || activePreview.link.matches(":focus-visible") ||
        previewSelectionInUse()) return;
    if (previewPanel?.hidden !== false) return closePreview();
    previewCloseTimer ??= setTimeout(() => {
      previewCloseTimer = undefined;
      if (previewPanel.matches(":hover") || previewSelectionInUse()) return;
      if (!previewIsCurrent(activePreview)) return closePreview();
      describePreview(false);
      playPreviewMotion(true);
    }, PREVIEW_CLOSE_DELAY);
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
      positionPreview();
      if (historyPanel && !historyPanel.isConnected) historyPanel = null;
    });
  }

  function alignAddButton(card, metric, button) {
    const cardRect = card.getBoundingClientRect();
    const metricRect = metric.getBoundingClientRect();
    button.style.top = `${Math.round(metricRect.top - cardRect.top + metricRect.height / 2)}px`;
    button.style.right = `${Math.round(cardRect.right - metricRect.left + 8)}px`;
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
        if (existing.disabled !== isPending) existing.disabled = isPending;
        alignAddButton(card, metric, existing);
        continue;
      }
      existing?.remove();
      const button = document.createElement("button");
      button.type = "button";
      button.className = "wr-helper-add-button";
      button.dataset.bookId = book.id;
      button.disabled = pendingAdds.has(book.id);
      button.title = "加入书架";
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
    if (event.key === "Escape" && (activePreview || previewOpenTimer !== undefined)) closePreview();
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
    if (event.target.matches?.(":focus-visible")) {
      const preview = getPreviewTarget(event.target);
      if (preview) startPreview(preview);
    }
  });
  document.addEventListener("focusout", (event) => {
    if (activePreview?.link === event.target && hoveredPreview?.cover !== activePreview.cover &&
        !previewSelectionInUse()) closePreview();
  });
  document.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse" || !(event.target instanceof Element)) return;
    // A release outside the window may only be visible once the pointer returns.
    if (previewSelectionPointer === event.pointerId && !(event.buttons & 1)) finishPreviewSelection();
    if (previewPanel?.contains(event.target)) {
      hoveredPreview = null;
      cancelPreviewClose();
      return;
    }
    if (previewSelectionInUse()) return;
    const preview = getPreviewTarget(event.target, event);
    if (!preview) {
      hoveredPreview = null;
      if (previewMotion && !previewMotion.closing && pointerOverRect(event, previewPanel.getBoundingClientRect())) {
        cancelPreviewClose();
      } else {
        leavePreview();
      }
      return;
    }
    if (hoveredPreview?.cover === preview.cover && hoveredPreview.url.href === preview.url.href) {
      hoveredPreview.homePoint = preview.homePoint;
      return;
    }
    hoveredPreview = preview;
    startPreview(preview);
  }, { capture: true, passive: true });
  document.addEventListener("pointerout", (event) => {
    if (event.pointerType === "mouse" && !event.relatedTarget) {
      hoveredPreview = null;
      leavePreview();
    }
  }, { capture: true, passive: true });
  document.addEventListener("input", (event) => {
    if (event.target === searchInput()) renderHistory();
  });
  document.addEventListener("pointerdown", (event) => {
    if (event.target !== searchInput() && !historyPanel?.contains(event.target)) hideHistory();
    if (!previewPanel?.contains(event.target)) closePreview();
  });
  for (const eventName of ["pointerup", "pointercancel"]) {
    document.addEventListener(eventName, (event) => {
      if (event.pointerId === previewSelectionPointer) finishPreviewSelection();
    }, true);
  }
  window.addEventListener("blur", finishPreviewSelection);
  window.addEventListener("resize", () => {
    positionHistoryPanel();
    settlePreviewMotion();
    scheduleRender();
  });
  document.addEventListener("scroll", positionHistoryPanel, { capture: true, passive: true });
  document.addEventListener("scroll", (event) => {
    if (!previewPanel?.contains(event.target)) {
      settlePreviewMotion();
      positionPreview();
    }
  }, { capture: true, passive: true });
  reducedMotion.addEventListener("change", settlePreviewMotion);

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
  domObserver.observe(document.documentElement, { childList: true, subtree: true, attributeFilter: ["href"] });
  ensureHistoryPanel();
})();
