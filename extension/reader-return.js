(() => {
  "use strict";

  const READER_PATH = /^\/web\/reader\/[\w-]+\/?$/;
  const CATALOG_ITEM = ".readerCatalog_list > .readerCatalog_list_item";
  const BUTTON_CLASS = "wr-helper-reader-return";
  const PAGER_BUTTON_CLASS = "renderTarget_pager_button";
  const TOOLBAR_BUTTON_CLASS = "readerControls_item";
  const NEXT_PAGE_BUTTON = ".renderTarget_pager_content_right > .renderTarget_pager_button_right";
  const DISTANCE_TO_DISMISS = 3;
  const FOREGROUND_MS_TO_DISMISS = 45000;
  const SCREEN_ROUNDING_TOLERANCE = 1e-9;
  const installed = Symbol.for("wr-helper-reader-return");
  if (!READER_PATH.test(location.pathname) || window[installed]) return;
  window[installed] = true;

  let reader = null;
  let catalogOrigin = null;
  let clickOrigin = null;
  let pendingJump = null;
  let returnPoint = null;
  let returnButton = null;
  let readingProgress = null;
  let pageTurn = null;
  let dismissalTimer;
  let showRemaining = false;
  let remainingLabel = null;
  let remainingTimer;

  function clearRemaining() {
    clearTimeout(remainingTimer);
    remainingTimer = undefined;
    remainingLabel?.remove();
    remainingLabel = null;
  }

  function readWholeBookProgress(instance) {
    if (!instance?.bookId || !isReadablePage(instance) || instance.isNeedPay ||
        instance.isPDFBookType || !instance.isShowRenderTarget || !instance.$refs?.renderTargetContainer ||
        !Number.isFinite(instance.currentChapter?.wordCount) || !instance.chapterInfos?.length) return null;

    // The native calculation can fall back to the stored progress when
    // layout or word counts are missing. Only display a current position.
    if (typeof instance.handleNavigateNext === "function") {
      if (!instance.chapterInfos.some((chapter) => chapter.wordCount > 0) ||
          !instance.getCurrentChapterPages?.()?.length) return null;
    } else if (!(instance.bookInfo?.totalWords > 0)) {
      return null;
    }

    const { progress, offset } = instance.computeProgressData({
      computeSummary: false,
      computeProgress: true
    }) || {};
    return Number.isInteger(progress) && progress >= 0 && progress <= 100 &&
      Number.isSafeInteger(offset) && offset >= 0 ? progress : null;
  }

  function updateRemaining() {
    remainingTimer = undefined;
    if (!showRemaining) return;
    let progress;
    try {
      progress = readWholeBookProgress(reader);
    } catch {
      // If the reader changes its data shape, leave its own progress alone.
    }
    const topBar = reader?.$el?.querySelector?.(".readerTopBar_inner");
    const actions = topBar?.querySelector(".readerTopBar_right");
    if (progress == null || !actions || actions.parentElement !== topBar) {
      clearRemaining();
      return;
    }
    if (!remainingLabel) {
      remainingLabel = document.createElement("div");
      remainingLabel.className = "wr-helper-reading-remaining";
    }
    if (typeof reader.handleNavigateNext === "function") {
      if (remainingLabel.nextElementSibling !== actions) actions.before(remainingLabel);
    } else if (actions.firstElementChild !== remainingLabel) {
      actions.prepend(remainingLabel);
    }
    const text = `全书剩余 ${100 - progress}%`;
    if (remainingLabel.textContent !== text) remainingLabel.textContent = text;
  }

  function scheduleRemaining() {
    if (showRemaining && reader && remainingTimer === undefined) {
      remainingTimer = setTimeout(updateRemaining, 100);
    }
  }

  document.addEventListener("wr-helper-reading-progress-setting", (event) => {
    showRemaining = event.detail === true;
    if (showRemaining) scheduleRemaining();
    else clearRemaining();
  });

  function clearReturnPoint() {
    clearTimeout(dismissalTimer);
    readingProgress = null;
    catalogOrigin = null;
    clickOrigin = null;
    pendingJump = null;
    returnPoint = null;
    returnButton?.remove();
    returnButton = null;
  }

  function currentChapterUid(instance) {
    return instance.currentChapterUid ?? instance.currentChapter?.chapterUid;
  }

  function inForeground() {
    return document.visibilityState === "visible" && document.hasFocus();
  }

  function checkDismissal() {
    clearTimeout(dismissalTimer);
    const progress = readingProgress;
    if (!progress) return;

    const now = performance.now();
    if (!inForeground()) {
      if (progress.foregroundSince !== null) {
        progress.foregroundMs += now - progress.foregroundSince;
        progress.foregroundSince = null;
      }
      return;
    }

    progress.foregroundSince ??= now;
    if (progress.distance < DISTANCE_TO_DISMISS - SCREEN_ROUNDING_TOLERANCE ||
        pendingJump || returnButton?.disabled) return;
    const remaining = FOREGROUND_MS_TO_DISMISS - progress.foregroundMs - (now - progress.foregroundSince);
    if (remaining <= 0) clearReturnPoint();
    else dismissalTimer = setTimeout(checkDismissal, remaining);
  }

  function advanceReading(progress, distance) {
    if (progress !== readingProgress) return;
    progress.distance += distance;
    checkDismissal();
  }

  function getScrollPosition() {
    const viewport = document.documentElement;
    const height = viewport.clientHeight;
    if (!height) return null;
    const maxY = Math.max(0, (document.scrollingElement ?? viewport).scrollHeight - height);
    return {
      height,
      maxY,
      y: Math.min(maxY, Math.max(0, window.scrollY))
    };
  }

  function sampleScroll(countMovement) {
    const progress = readingProgress;
    if (!progress || progress.paged) return;
    if (reader.isReaderCatalogShowing || pendingJump || returnButton?.disabled) {
      progress.scroll = null;
      return;
    }

    const position = getScrollPosition();
    if (!position) return;
    const { height, maxY, y } = position;
    const layout = [
      currentChapterUid(reader), reader.getCurrentSectionIdx, document.documentElement.clientWidth, height, maxY,
      reader.fontSizeLevel, reader.fontFamily, reader.renderContentsVersion
    ].join("/");
    const previous = progress.scroll;
    progress.scroll = { layout, y };
    // A change in layout only establishes a new baseline.
    if (countMovement && inForeground() && previous?.layout === layout && y !== previous.y) {
      advanceReading(progress, (y - previous.y) / height);
    }
  }

  function countScrollNavigation(instance, navigate, args, direction) {
    const progress = readingProgress;
    if (instance !== reader || !progress || progress.paged) return navigate.apply(instance, args);

    sampleScroll(true);
    const before = getScrollPosition();
    const chapter = currentChapterUid(instance);
    const section = instance.getCurrentSectionIdx;
    const result = navigate.apply(instance, args);
    if (before && typeof result?.then === "function") {
      result.then((value) => {
        if (!value?.success || reader !== instance || readingProgress !== progress || instance.isNeedPay ||
            (currentChapterUid(instance) === chapter && instance.getCurrentSectionIdx === section)) return;
        const after = getScrollPosition();
        if (!after) return;

        // Scrolling stops at the start of the last visible screen. Crossing
        // the boundary goes past that screen, even for a short chapter.
        const distance = direction > 0
          ? (before.maxY - before.y) / before.height + 1 + after.y / after.height
          : -(before.y / before.height + 1 + (after.maxY - after.y) / after.height);
        sampleScroll(false);
        advanceReading(progress, distance);
      }, () => {});
    }
    return result;
  }

  function resetReadingProgress(instance) {
    readingProgress = {
      paged: typeof instance.handleNavigateNext === "function",
      distance: 0,
      foregroundMs: 0,
      foregroundSince: null,
      scroll: null
    };
    sampleScroll(false);
    checkDismissal();
  }

  function isReadablePage(instance) {
    return !instance.showCoverPage && !instance.showCoverBackPage && !instance.showNeedPayPage;
  }

  function readPosition() {
    if (!reader?.bookId || reader.isPDFBookType || reader.isNeedPay || reader.showCoverPage) return null;
    const chapterUid = reader.leftPageChapterInfo?.chapterUid ?? currentChapterUid(reader);
    if (!Number.isSafeInteger(chapterUid) || chapterUid <= 0) return null;
    const { offset } = reader.computeProgressData({ computeSummary: false, computeProgress: false }) || {};
    if (!Number.isSafeInteger(offset) || offset < 0) return null;
    const bookId = reader.bookId;
    const path = reader.readerURL?.(bookId, { chapterUid, jumpType: "switchFormat", offset });
    const url = path ? new URL(path, location.origin) : null;
    const href = url?.origin === location.origin && READER_PATH.test(url.pathname) ? url.href : null;
    return { bookId, chapterUid, offset, href };
  }

  function setReturnLabel(button, text) {
    const label = button.lastElementChild;
    const toolbar = button.classList.contains(TOOLBAR_BUTTON_CLASS);
    label.textContent = text;
    label.classList.toggle("wr-helper-reader-return-tooltip", toolbar);
    if (toolbar) {
      button.setAttribute("aria-label", text);
      label.setAttribute("aria-hidden", "true");
    } else {
      button.removeAttribute("aria-label");
      label.removeAttribute("aria-hidden");
    }
  }

  async function returnToPosition() {
    const point = returnPoint;
    const instance = reader;
    const button = returnButton;
    if (!point || !button || button.disabled || instance?.bookId !== point.bookId) return;
    const hadFocus = document.activeElement === button;
    clearTimeout(dismissalTimer);
    button.disabled = true;
    setReturnLabel(button, "正在返回…");
    const scrollTo = { chapterOffset: point.offset };

    try {
      if (currentChapterUid(instance) === point.chapterUid) {
        instance.scrollTo(scrollTo);
      } else {
        const result = await instance.changeChapter({ chapterUid: point.chapterUid, scrollTo });
        if (!result?.success || currentChapterUid(instance) !== point.chapterUid) {
          throw new Error("Reader did not restore the chapter");
        }
      }
      if (returnPoint === point) {
        clearReturnPoint();
        if (hadFocus) instance.$el.querySelector(".readerControls_item.catalog")?.focus({ preventScroll: true });
      }
    } catch {
      if (returnPoint === point && returnButton === button) {
        if (point.href) {
          // The reader can also restore its position when opening a deep link.
          location.replace(point.href);
          return;
        }
        setReturnLabel(button, "返回失败，重试");
        button.disabled = false;
        if (hadFocus && document.activeElement === document.body) button.focus({ preventScroll: true });
      }
    }
  }

  function showReturnButton() {
    if (!returnPoint) return;
    const root = reader?.$el;
    const paged = typeof reader?.handleNavigateNext === "function";
    const next = paged ? root?.querySelector?.(NEXT_PAGE_BUTTON) : null;
    const controls = paged
      ? (next?.getClientRects().length ? next.parentElement : null)
      : root?.querySelector?.(".readerControls");
    if (!controls) {
      returnButton?.remove();
      return;
    }
    if (!returnButton) {
      returnButton = document.createElement("button");
      returnButton.type = "button";
      returnButton.className = BUTTON_CLASS;
      const icon = document.createElement("span");
      icon.className = "renderTarget_pager_icon";
      icon.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.textContent = "回到刚才";
      returnButton.append(icon, label);
      returnButton.addEventListener("click", returnToPosition);
    }

    if (paged) {
      if (returnButton.nextElementSibling === next) return;
      returnButton.classList.remove(TOOLBAR_BUTTON_CLASS);
      returnButton.classList.add(PAGER_BUTTON_CLASS);
      setReturnLabel(returnButton, returnButton.lastElementChild.textContent);
      // Match the native pager's Vue-scoped styles in the current reader.
      for (const name of next.getAttributeNames()) {
        if (!name.startsWith("data-v-")) continue;
        returnButton.setAttribute(name, "");
        returnButton.firstElementChild.setAttribute(name, "");
      }
      next.before(returnButton);
      return;
    }

    if (controls.firstElementChild !== returnButton) {
      returnButton.classList.remove(PAGER_BUTTON_CLASS);
      returnButton.classList.add(TOOLBAR_BUTTON_CLASS);
      setReturnLabel(returnButton, returnButton.lastElementChild.textContent);
      controls.prepend(returnButton);
    }
  }

  document.addEventListener("click", (event) => {
    if (!event.isTrusted || !(event.target instanceof Element) ||
        !reader?.$el?.contains(event.target)) return;
    if (event.target.closest(".readerControls_item.catalog")) {
      if (returnPoint) return;
      try {
        // The catalog locks scrolling in the vertical reader.
        catalogOrigin = readPosition();
      } catch {
        catalogOrigin = null;
      }
      return;
    }

    const item = event.target.closest(CATALOG_ITEM);
    if (!item || item.matches(".readerCatalog_list_item_selected, .readerCatalog_list_item_disabled")) return;
    try {
      const point = returnPoint ?? pendingJump?.point ?? catalogOrigin ?? readPosition();
      clickOrigin = point;
      // The browser may run microtasks between the capture and catalog handlers.
      setTimeout(() => { if (clickOrigin === point) clickOrigin = null; }, 0);
    } catch {
      clickOrigin = null;
    }
  }, true);
  window.addEventListener("pagehide", () => {
    clearReturnPoint();
    clearRemaining();
  });
  window.addEventListener("pageshow", scheduleRemaining);
  window.addEventListener("resize", () => {
    sampleScroll(false);
    showReturnButton();
    scheduleRemaining();
  });
  window.addEventListener("scroll", () => {
    sampleScroll(true);
    scheduleRemaining();
  }, { passive: true });
  for (const [target, event] of [[document, "visibilitychange"], [window, "focus"], [window, "blur"]]) {
    target.addEventListener(event, () => {
      sampleScroll(false);
      checkDismissal();
    });
  }

  function connectReader(options) {
    const nativeChangeChapter = options.methods.changeChapter;
    options.methods.changeChapter = function (target) {
      const point = this === reader ? clickOrigin : null;
      const turn = this === reader ? pageTurn : null;
      const changesChapter = target?.chapterUid && target.chapterUid !== currentChapterUid(this);
      clickOrigin = null;
      if (point) catalogOrigin = null;
      if (turn && changesChapter) turn.loadsChapter = true;
      const result = nativeChangeChapter.apply(this, arguments);
      if (!changesChapter || typeof result?.then !== "function") return result;
      if (turn) {
        result.then((value) => {
          if (value?.success && reader === this && currentChapterUid(this) === target.chapterUid && isReadablePage(this)) {
            advanceReading(turn.progress, turn.direction);
          }
        }, () => {});
      }
      if (!point) return result;

      const jump = pendingJump ??= { point, inFlight: 0 };
      jump.inFlight++;
      const settle = (success) => {
        if (pendingJump !== jump) return;
        if (--jump.inFlight === 0) pendingJump = null;
        if (success && reader === this && this.bookId === point.bookId &&
            currentChapterUid(this) === target.chapterUid) {
          returnPoint ??= jump.point;
          resetReadingProgress(this);
          showReturnButton();
        } else if (!pendingJump) {
          sampleScroll(false);
          checkDismissal();
        }
      };
      result.then((value) => settle(value?.success), () => settle(false));
      return result;
    };

    for (const [method, direction] of [["handleNavigateNext", 1], ["handleNavigatePrev", -1]]) {
      const navigate = options.methods[method];
      if (typeof navigate !== "function") continue;
      options.methods[method] = function () {
        const progress = readingProgress;
        if (this !== reader || !progress?.paged) return navigate.apply(this, arguments);
        const page = this.leftRenderPageIdx;
        const turn = { progress, direction, loadsChapter: false };
        pageTurn = turn;
        try {
          const result = navigate.apply(this, arguments);
          if (!turn.loadsChapter && (this.leftRenderPageIdx - page) * direction > 0 && isReadablePage(this)) {
            advanceReading(progress, direction);
          }
          return result;
        } finally {
          pageTurn = null;
        }
      };
    }

    const scrollToOffsetTop = options.methods.scrollToOffsetTop;
    if (typeof scrollToOffsetTop === "function") {
      options.methods.scrollToOffsetTop = function () {
        const result = scrollToOffsetTop.apply(this, arguments);
        if (this === reader) sampleScroll(false);
        return result;
      };

      for (const [method, direction] of [
        ["handleNextChapter", 1], ["handlePrevChapter", -1],
        ["handleNextSection", 1], ["handlePrevSection", -1]
      ]) {
        const navigate = options.methods[method];
        if (typeof navigate !== "function") continue;
        options.methods[method] = function () {
          return countScrollNavigation(this, navigate, arguments, direction);
        };
      }
    }

    function addHook(name, hook) {
      const previous = options[name];
      options[name] = previous ? [].concat(previous, hook) : [hook];
    }

    addHook("mounted", function () {
      stopWatchingLoader();
      clearReturnPoint();
      clearRemaining();
      reader = this;
      scheduleRemaining();
      this.$watch("bookId", () => {
        if (reader !== this) return;
        clearReturnPoint();
        clearRemaining();
        scheduleRemaining();
      });
      this.$watch("isReaderCatalogShowing", () => {
        if (reader === this) sampleScroll(false);
      });
    });
    addHook("updated", function () {
      if (reader !== this) return;
      showReturnButton();
      scheduleRemaining();
    });
    addHook("beforeDestroy", function () {
      if (reader !== this) return;
      reader = null;
      clearReturnPoint();
      clearRemaining();
    });
  }

  // WeRead uses a Vue build without DOM-to-component references. Attach only
  // to the two reader components as their existing factories are loaded.
  const chunks = window.webpackJsonp ??= [];
  if (!Array.isArray(chunks) || chunks.push !== Array.prototype.push) return;
  let nativePush = chunks.push;
  let observedPush = nativePush;
  const wrappedFactories = new WeakSet();
  const connectedOptions = new WeakSet();

  function observeChunk(chunk) {
    const factories = chunk?.[1];
    for (const [key, factory] of Object.entries(factories || {})) {
      if (typeof factory !== "function" || wrappedFactories.has(factory)) continue;
      const source = Function.prototype.toString.call(factory);
      if (!source.includes("computeProgressData") || !source.includes("renderTargetContainer")) continue;
      const wrapper = function (module) {
        const result = factory.apply(this, arguments);
        try {
          const options = module.exports?.default;
          const methods = options?.methods;
          if (typeof methods?.computeProgressData === "function" && typeof methods.changeChapter === "function" &&
              typeof methods.scrollTo === "function" && !connectedOptions.has(options)) {
            connectReader(options);
            connectedOptions.add(options);
          }
        } catch {
          // Keep the original module usable if its component shape changes.
        }
        return result;
      };
      factories[key] = wrapper;
      wrappedFactories.add(wrapper);
    }
  }

  const loaderTimeout = setTimeout(stopWatchingLoader, 30000);
  function stopWatchingLoader() {
    clearTimeout(loaderTimeout);
    const descriptor = Object.getOwnPropertyDescriptor(chunks, "push");
    if (descriptor?.get !== getObservedPush) return;
    if (nativePush === Array.prototype.push) delete chunks.push;
    else Object.defineProperty(chunks, "push", { configurable: true, writable: true, value: nativePush });
  }

  function getObservedPush() {
    return observedPush;
  }

  Object.defineProperty(chunks, "push", {
    configurable: true,
    get: getObservedPush,
    set(push) {
      nativePush = push;
      try {
        for (const chunk of chunks) observeChunk(chunk);
      } catch {
        // Continue loading WeRead even if its chunk format changes.
      }
      observedPush = function (...incoming) {
        try {
          for (const chunk of incoming) observeChunk(chunk);
        } catch {
          // Let the site's loader process unsupported chunks directly.
        }
        return Reflect.apply(push, this, incoming);
      };
    }
  });
})();
