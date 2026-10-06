# wee-read-web

**让微信读书网页版的找书与管理书架更顺手。**

一个轻量的 Chrome 扩展，为微信读书网页版补上常用的小功能。搜索记录保存在当前浏览器，书架操作沿用你已登录的微信读书账号。

[下载最新版](https://github.com/JDChi/wee-read-web/releases/latest) · [查看更新记录](https://github.com/JDChi/wee-read-web/releases) · [隐私政策](PRIVACY.md)

## 功能

- **最近搜索**：搜索框下方保留最近 5 个不同的搜索词，点击记录即可重新搜索，也可以一键清空。
- **快捷加入书架**：搜索结果中，尚未加入书架的可读书籍会显示“加入书架”入口。已在书架中的书不会显示；加入成功后，相关入口随即隐藏。
- **轻量与本地**：无需注册扩展账号。搜索记录保存在 Chrome 本地，扩展不经过自建服务器中转。

## 安装

### 普通安装：下载发布包

1. 前往[最新版 Release](https://github.com/JDChi/wee-read-web/releases/latest)，在 **Assets** 中下载 `wee-read-web-版本号.zip`。
2. 将 ZIP 解压到一个固定位置，保留解压后的文件夹。
3. 在 Chrome 地址栏打开 `chrome://extensions`，开启右上角的“开发者模式”。
4. 点击“加载已解压的扩展程序”，选择刚才解压后**直接包含 `manifest.json` 的文件夹**。
5. 打开[微信读书网页版](https://weread.qq.com/)并登录，即可使用。

更新扩展时，将新版文件解压覆盖到原文件夹，再回到 `chrome://extensions` 点击扩展卡片上的刷新按钮。

### 开发体验：从源码加载

克隆本仓库后，在 `chrome://extensions` 开启“开发者模式”，点击“加载已解压的扩展程序”，选择仓库内的 `extension` 文件夹。修改代码后点击扩展卡片上的刷新按钮，并刷新微信读书页面。

## 隐私说明

扩展只在 `weread.qq.com` 页面运行。最近搜索保存在当前浏览器的 Chrome 扩展存储中；书籍查询与书架操作直接请求微信读书网站，并使用你当前的登录状态。扩展不会把这些数据发送到开发者服务器。完整说明见[隐私政策](PRIVACY.md)。

本项目是独立开发的非官方扩展，与微信读书或腾讯无隶属关系。

## 本地开发与打包

扩展使用 Chrome Manifest V3，无需安装依赖。图标资源位于 `extension/icons`。

```sh
# 打包成可加载或提交商店审核的 ZIP
sh scripts/package.sh
```

生成的文件位于 `dist/wee-read-web-版本号.zip`。GitHub Actions 会在推送与 `manifest.json` 版本一致的 `v*` 标签时，自动打包并创建 GitHub Release。

## 反馈与贡献

欢迎通过 [GitHub Issues](https://github.com/JDChi/wee-read-web/issues) 反馈问题或提出建议。微信读书网页结构或接口调整时，部分功能可能需要更新适配。
