(() => {
  "use strict";

  const installed = Symbol.for("wr-helper-reader-settings");
  if (!/^\/web\/reader\/[\w-]+\/?$/.test(location.pathname) || globalThis[installed]) return;
  globalThis[installed] = true;

  const key = "showReadingProgress";
  let settingChanged = false;
  const setProgressDisplay = (value) => {
    document.dispatchEvent(new CustomEvent("wr-helper-reading-progress-setting", {
      detail: value !== false,
    }));
  };

  // A change received during the initial read is newer than the initial snapshot.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[key]) return;
    settingChanged = true;
    setProgressDisplay(changes[key].newValue);
  });
  chrome.storage.local.get(key).then((data) => {
    if (!settingChanged) setProgressDisplay(data[key]);
  }).catch(() => {});
})();
