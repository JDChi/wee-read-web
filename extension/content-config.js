(() => {
  "use strict";

  globalThis[Symbol.for("wr-helper-content-config")] ??= Object.freeze({
    historyLimit: 5,
    previewOpenDelayMs: 300,
    previewCloseDelayMs: 180,
    previewExpandDurationMs: 200,
    previewCollapseDurationMs: 160,
    previewFadeDurationMs: 120,
  });
})();
