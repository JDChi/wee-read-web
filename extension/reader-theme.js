(() => {
  "use strict";

  const key = "readerTheme";
  const marker = Symbol.for("wr-helper-reader-theme");
  const config = globalThis[Symbol.for("wr-helper-reader-theme-config")];
  if (!config || globalThis[marker] || !/^\/web\/reader\/[\w-]+\/?$/.test(location.pathname)) return;
  globalThis[marker] = true;

  const themeAttribute = "data-wr-helper-theme";
  const nativeAttribute = "data-wr-helper-theme-replaced";
  const nativeSelector = ".readerControls button.readerControls_item:is(.white, .dark)";
  const controlsSelector = ".readerControls";
  const storage = chrome.storage;
  const paperImage = `url("${chrome.runtime.getURL(config.paperTexture)}")`;
  let preference = null;
  let preferenceRevision = 0;
  let writeQueue = Promise.resolve();
  let readerReady = false;
  let readerTimedOut = false;
  let nativeButton;
  let control;
  let menu;
  let trigger;
  let status;
  let body;
  let wasLight;
  let scheduled = false;
  let redrawPending = false;
  const options = new Map();

  function scheduleRedraw() {
    if (redrawPending) return;
    redrawPending = true;
    requestAnimationFrame(() => {
      redrawPending = false;
      if (!document.querySelector(".readerChapterContent")) return;
      const needsResize = document.dispatchEvent(new Event("wr-helper-reader-theme-redraw", { cancelable: true }));
      if (needsResize) window.dispatchEvent(new Event("resize"));
    });
  }

  function setPageTheme(theme) {
    const root = document.documentElement;
    if (!root || root.getAttribute(themeAttribute) === theme) return;
    if (theme === "paper") {
      root.style.setProperty("--wr-helper-paper-image", paperImage);
    } else {
      root.style.removeProperty("--wr-helper-paper-image");
    }
    if (theme) root.setAttribute(themeAttribute, theme);
    else root.removeAttribute(themeAttribute);
    scheduleRedraw();
  }

  function selectedTheme() {
    return preference ?? (wasLight ? "light" : "dark");
  }

  function reflectSelection() {
    if (!trigger) return;
    for (const [theme, button] of options) {
      button.setAttribute("aria-checked", String(theme === selectedTheme()));
    }
  }

  function receivePreference(value) {
    preference = Object.hasOwn(config.themes, value) ? value : null;
    if (control?.isConnected || (!readerReady && !readerTimedOut)) setPageTheme(preference);
    reflectSelection();
  }

  function showMenu(open, restoreFocus = false) {
    menu.hidden = !open;
    trigger.setAttribute("aria-expanded", String(open));
    if (open) options.get(selectedTheme()).focus();
    else if (restoreFocus) trigger.focus();
  }

  function chooseTheme(theme) {
    showMenu(false, true);
    status.textContent = "";
    writeQueue = writeQueue.then(async () => {
      try {
        await storage.local.set({ [key]: theme });
        status.textContent = "";
      } catch {
        status.textContent = "主题保存失败";
        return;
      }
      // An unchanged key may produce no change event after an initial read failure.
      await readPreference().catch(() => {});
    });
  }

  async function readPreference() {
    const revision = preferenceRevision;
    const data = await storage.local.get(key);
    if (revision === preferenceRevision) receivePreference(data[key]);
  }

  function createControl() {
    control = document.createElement("div");
    control.className = "wr_tooltip_container wr-helper-theme-control";
    trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "readerControls_item wr-helper-theme-trigger";
    trigger.setAttribute("aria-label", "主题");
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-controls", "wr-helper-theme-menu");
    trigger.setAttribute("aria-expanded", "false");
    trigger.addEventListener("click", () => showMenu(menu.hidden));
    trigger.addEventListener("keydown", (event) => {
      if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
      event.preventDefault();
      showMenu(true);
    });

    menu = document.createElement("div");
    menu.id = "wr-helper-theme-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "阅读主题");
    menu.hidden = true;
    menu.style.setProperty("--wr-helper-paper-image", paperImage);
    for (const [theme, label] of Object.entries(config.themes)) {
      const option = document.createElement("button");
      option.type = "button";
      option.tabIndex = -1;
      option.setAttribute("role", "menuitemradio");
      const preview = document.createElement("span");
      preview.className = "wr-helper-theme-preview";
      preview.dataset.theme = theme;
      preview.setAttribute("aria-hidden", "true");
      option.setAttribute("aria-label", label);
      option.append(preview);
      option.addEventListener("click", () => void chooseTheme(theme));
      options.set(theme, option);
      menu.append(option);
    }
    control.addEventListener("keydown", (event) => {
      if (menu.hidden) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        showMenu(false, true);
        return;
      }
      const buttons = [...options.values()];
      const index = buttons.indexOf(document.activeElement);
      const next = {
        ArrowDown: (index + 2) % buttons.length,
        ArrowUp: (index - 2 + buttons.length) % buttons.length,
        ArrowRight: (index + 1) % buttons.length,
        ArrowLeft: (index - 1 + buttons.length) % buttons.length,
        Home: 0,
        End: buttons.length - 1
      }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      buttons[next].focus();
    });
    control.addEventListener("focusout", (event) => {
      if (!control.contains(event.relatedTarget)) showMenu(false);
    });
    status = document.createElement("span");
    status.className = "wr-helper-theme-status";
    status.setAttribute("role", "status");
    const hint = document.createElement("div");
    hint.className = "wr_tooltip_item wr_tooltip_item--right";
    hint.setAttribute("role", "tooltip");
    hint.textContent = "主题";
    // The native tooltip uses an inline right-side offset from its trigger.
    hint.style.left = `calc(100% + ${config.tooltipGapPx}px)`;
    control.append(trigger, hint, menu, status);
    reflectSelection();
  }

  function reconcile() {
    const nextBody = document.body;
    if (body !== nextBody) {
      bodyObserver.disconnect();
      body = nextBody;
      if (body) bodyObserver.observe(body, { attributes: true, attributeFilter: ["class"] });
    }
    const isLight = body?.classList.contains("wr_whiteTheme");
    if (isLight !== wasLight) {
      wasLight = isLight;
      reflectSelection();
      if (preference) scheduleRedraw();
    }

    // Wait for Vue to hydrate the original toolbar before inserting our control.
    if (!readerReady && !readerTimedOut) return;
    const button = readerReady && body?.matches(".wr_page_reader")
      ? [...body.querySelectorAll(nativeSelector)].find((item) =>
        item.closest(controlsSelector)?.getClientRects().length &&
        ((item.closest(".wr_tooltip_container") ?? item) === nativeButton || item.getClientRects().length))
      : null;
    const candidate = button?.closest(".wr_tooltip_container") ?? button;
    if (candidate !== nativeButton) {
      nativeButton?.removeAttribute(nativeAttribute);
      nativeButton = candidate;
    }
    if (!nativeButton) {
      if (control?.isConnected) {
        showMenu(false);
        control.remove();
      }
      setPageTheme(null);
      return;
    }
    if (!control) createControl();
    if (control.nextElementSibling !== nativeButton) nativeButton.before(control);
    if (!control.isConnected) {
      nativeButton.removeAttribute(nativeAttribute);
      setPageTheme(null);
      return;
    }
    nativeButton.setAttribute(nativeAttribute, "");
    setPageTheme(preference);
  }

  function scheduleReconcile() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      reconcile();
    });
  }

  const bodyObserver = new MutationObserver(scheduleReconcile);
  const controlsObserver = new MutationObserver((records) => {
    if (records.some(({ addedNodes, removedNodes, target }) =>
      target.matches?.(controlsSelector) ||
      [...addedNodes, ...removedNodes].some((node) => node.nodeType === Node.ELEMENT_NODE &&
        (node.matches("body, .readerControls") || node.querySelector(controlsSelector))))) {
      scheduleReconcile();
    }
  });
  controlsObserver.observe(document, { childList: true, subtree: true });
  document.addEventListener("wr-helper-reader-ready", () => {
    readerReady = true;
    scheduleReconcile();
    if (preference) scheduleRedraw();
  });
  window.addEventListener("load", () => {
    setTimeout(() => {
      readerTimedOut = true;
      scheduleReconcile();
    }, config.readerReadyTimeoutMs);
  }, { once: true });
  window.addEventListener("pageshow", scheduleReconcile);
  document.addEventListener("pointerdown", (event) => {
    if (control?.isConnected && !control.contains(event.target)) showMenu(false);
  }, true);

  // A storage event can be newer than the initial snapshot even if the get resolves later.
  storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[key]) return;
    preferenceRevision++;
    receivePreference(changes[key].newValue);
  });
  void readPreference().catch(() => {
    if (!preferenceRevision) receivePreference(null);
  });
  scheduleReconcile();
})();
