<div align="center">

<img src="extension/icons/icon128.png" alt="微小读图标" width="80" height="80">

# 微小读 · 微信读书网页版助手

微信读书网页版的非官方 Chrome 扩展。看到想读的书，选中书名就能右键搜书。微信读书站内还支持最近搜索、封面简介预览、快捷加入书架和跳章后回到原阅读位置。

**[从 Chrome 应用商店安装](https://chromewebstore.google.com/detail/微小读/hphcgidfoaoaialodjonbchniaaoenki)** · [功能预览](#功能预览) · [安装指南](#开始使用) · [反馈建议](https://github.com/JDChi/wee-read-web/issues)

</div>

## 功能预览

### 右键搜书

- 在文章或书单里选中「局外人」，右键点击「在微信读书里搜索 -> 局外人」，在新标签页查看图书搜索结果。
- 没选中文字时，在网页空白处右键点击「去微信读书」，在新标签页打开首页。

### 最近搜索

点击空白搜索框，查看最近 5 个不同的搜索词。点选一条即可重搜，也可以一键清空。

![搜索框下方的最近搜索和清空按钮](docs/images/recent-searches.png)

### 封面简介预览

在首页「猜你喜欢」、榜单或搜索结果中，悬停书籍封面即可看简介。也可用 `Tab` 聚焦书籍链接打开预览，按 `Esc` 关闭。

![悬停书籍封面时展开的简介预览](docs/images/book-preview.gif)

### 快捷加入书架

搜索结果中的可读书籍若尚未加入书架，可点击「加入书架」收藏。成功后按钮自动隐藏。

![搜索结果中的加入书架按钮](docs/images/add-to-shelf.png)

### 回到刚才

在正文里点目录跳到另一章后，点击「回到刚才」，接着读跳转前的位置。翻页时按钮位于「下一页」左边，滚动阅读时可点击右侧工具栏顶部的圆形折返箭头。连续查阅多个章节时，按钮会记住第一次跳转前的位置。返回时可能在当前标签页重新加载正文。刷新页面或离开这本书后，返回点会清除。

每次从目录跳章后，净向前翻 3 次页或读过 3 屏，且在阅读页前台累计停留至少 45 秒，按钮就会自动收起。滚动阅读通过「下一章」或「下一节」继续时，当前章或节的最后一屏也计入进度。再次从目录跳章后，从新落点重新计算。

## 开始使用

安装扩展后即可使用右键菜单。打开或刷新[微信读书网页版](https://weread.qq.com/)可使用站内功能。快捷加入书架需要登录微信读书。

<details>
<summary>手动安装与更新</summary>

1. 从[最新版 Release](https://github.com/JDChi/wee-read-web/releases/latest) 的 Assets 下载并解压 `wee-read-web-版本号.zip`。
2. 在 `chrome://extensions` 开启「开发者模式」，点击「加载已解压的扩展程序」，选择包含 `manifest.json` 的文件夹。使用源码时直接选择 `extension/`。
3. 打开或刷新微信读书页面。手动更新时，将新版解压到原文件夹，再刷新扩展和页面。

</details>

## 隐私

扩展仅在微信读书网页版注入脚本。右键搜书使用你选中的文字打开微信读书搜索页，不写入微小读的「最近搜索」。站内最近搜索保存在当前浏览器，书架操作沿用微信读书登录状态。跳章前的位置只暂存在当前阅读页内存中。数据处理详见[隐私政策](PRIVACY.md)。

<details>
<summary>开发与打包</summary>

直接加载 `extension/` 开发，修改后刷新扩展和微信读书页面。打包需要 `python3` 和 `zip`。

```sh
sh scripts/package.sh
```

ZIP 和发布文档保存在 `dist/<版本号>/`，版本号取自 `extension/manifest.json`。发布步骤见 [AGENTS.md](AGENTS.md#发布)。

</details>

[查看更新记录](https://github.com/JDChi/wee-read-web/releases)
