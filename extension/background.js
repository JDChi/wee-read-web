"use strict";

const HOME_MENU_ID = "wr-helper-open-home";
const SEARCH_MENU_ID = "wr-helper-search-selection";
const WEREAD_HOME_URL = "https://weread.qq.com/";
const WEB_PAGES = ["http://*/*", "https://*/*"];

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    if (chrome.runtime.lastError) return;
    chrome.contextMenus.create({
      id: HOME_MENU_ID,
      title: "去微信读书",
      contexts: ["page"],
      documentUrlPatterns: WEB_PAGES,
    });
    chrome.contextMenus.create({
      id: SEARCH_MENU_ID,
      title: "在微信读书里搜索 -> %s",
      contexts: ["selection"],
      documentUrlPatterns: WEB_PAGES,
    });
  });
});

function openWeRead(url) {
  chrome.tabs.create({ url }, () => {
    if (chrome.runtime.lastError) console.warn("无法打开微信读书");
  });
}

chrome.contextMenus.onClicked.addListener(({ menuItemId, selectionText }) => {
  if (menuItemId === HOME_MENU_ID) {
    openWeRead(WEREAD_HOME_URL);
    return;
  }
  if (menuItemId !== SEARCH_MENU_ID || !selectionText) return;
  const keyword = selectionText.trim().replace(/^《([^《》]*)》$/u, "$1").trim();
  if (!keyword) return;

  const url = new URL("/web/search/books", WEREAD_HOME_URL);
  url.searchParams.set("keyword", keyword);
  openWeRead(url.href);
});
