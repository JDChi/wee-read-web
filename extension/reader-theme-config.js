(() => {
  "use strict";

  globalThis[Symbol.for("wr-helper-reader-theme-config")] = Object.freeze({
    themes: Object.freeze({ light: "浅色", dark: "深色", gray: "浅灰", paper: "纸纹" }),
    readerReadyTimeoutMs: 5000,
    tooltipGapPx: 6,
    paperTexture: "assets/reader-paper-texture.png"
  });
})();
