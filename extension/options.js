"use strict";

const key = "showReadingProgress";
const toggle = document.getElementById("show-reading-progress");
const status = document.getElementById("settings-status");
let saved = true;

chrome.storage.local.get(key).then((data) => {
  saved = data[key] !== false;
  toggle.checked = saved;
  toggle.disabled = false;
}).catch(() => {
  status.textContent = "暂时无法读取设置，请重新打开此页。";
});

toggle.addEventListener("change", async () => {
  const enabled = toggle.checked;
  toggle.disabled = true;
  status.textContent = "";
  try {
    await chrome.storage.local.set({ [key]: enabled });
    saved = enabled;
  } catch {
    toggle.checked = saved;
    status.textContent = "暂时无法保存设置，请重试。";
  } finally {
    toggle.disabled = false;
  }
});
