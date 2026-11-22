(() => {
  "use strict";

  const installed = Symbol.for("wr-helper-reader-theme-renderer");
  if (globalThis[installed]) return;
  globalThis[installed] = true;

  const connected = new WeakSet();
  const themeAttribute = "data-wr-helper-theme";
  let lastTheme;
  let ink;
  let inkRgb;

  function currentInk() {
    const root = document.documentElement;
    const theme = root?.getAttribute(themeAttribute);
    if (theme !== lastTheme) {
      lastTheme = theme;
      ink = theme ? getComputedStyle(root).getPropertyValue("--wr-theme-text").trim() : "";
      inkRgb = ink ? `rgb(${[1, 3, 5].map((start) => parseInt(ink.slice(start, start + 2), 16)).join(", ")})` : "";
    }
    return ink;
  }

  function connect(runtime) {
    if (!runtime?.c || connected.has(runtime)) return;
    for (const module of Object.values(runtime.c)) {
      const style = module?.exports?.default?.style;
      if (typeof style?.getNodeColorRaw !== "function" || typeof style.getNodeFontRaw !== "function") continue;
      const getNodeColorRaw = style.getNodeColorRaw;
      style.getNodeColorRaw = function (node, computed, isWhite) {
        const colors = getNodeColorRaw.apply(this, arguments);
        currentInk();
        const raw = computed?.color;
        const nativeDefault = isWhite ? "rgb(13, 20, 30)" : "rgb(208, 211, 216)";
        if (raw !== nativeDefault && (!inkRgb || raw !== inkRgb)) return colors;

        // Collected glyphs are reused when a theme changes. Resolve only their
        // default ink at paint time and keep authored colors and highlights.
        const light = raw === nativeDefault ? colors.colorOnWhite : "#0d141e";
        const dark = raw === nativeDefault ? colors.colorOnBlack : "#d0d3d8";
        return {
          get colorOnWhite() { return currentInk() || light; },
          get colorOnBlack() { return currentInk() || dark; }
        };
      };
      connected.add(runtime);
      break;
    }
  }

  globalThis[Symbol.for("wr-helper-reader-theme-connect")] = connect;
})();
