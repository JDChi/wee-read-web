# AGENTS.md

微小读是微信读书网页版的非官方 Chrome 扩展。功能和安装方式见 [README](README.md)，权限、站点范围和版本以 [manifest](extension/manifest.json) 为准。

## 修改约定

- 默认用中文沟通，界面用中文。沿用现有代码风格和 `wr-helper-` 前缀，优先小范围修改，保持扩展无需构建即可加载。保留用户已有改动。
- 选择器和接口以微信读书实际页面与响应为准。扩展失败时应保持原站搜索和阅读可用。
- 注入须可重复执行，避免重复元素、事件或观察器自触发。保留渲染合并与请求去重，防止旧搜索或书架响应污染新结果。外部文本用 `textContent` 等安全方式写入。

## 功能与隐私约束

- 右键搜书仅在用户点击菜单时读取选中文字，直接打开微信读书图书搜索页，不写入最近搜索。网页空白处的「去微信读书」打开首页。站内脚本仅注入微信读书网页版。
- 最近搜索保持本地存储、清空、重新搜索和跨页面同步。
- 书籍可读且确认未加入书架时才显示「加入书架」，状态未知时隐藏。由用户点击触发同源书架操作，防止重复提交。成功后隐藏同书入口，失败时提示并允许重试。
- 预览优先用已有简介，缺少时按需请求同源公开阅读页，使用 `credentials: "omit"`，仅在当前页面缓存。渲染前确认触发对象仍有效，并保留简介原有段落和换行。
- 禁止读取、保存或输出登录凭证，禁止经开发者服务器中转或上报用户数据。修改权限、域名、存储或数据流时，同步检查 [隐私政策](PRIVACY.md)、[README](README.md) 和[商店说明](store/LISTING.md)。

## 验证

按改动范围执行静态检查。

```sh
node --check extension/background.js
node --check extension/content.js
python3 -m json.tool extension/manifest.json > /dev/null
sh -n scripts/package.sh
```

交互变更后，在 Chrome 刷新扩展和微信读书页面，按需验证有无选中文字时的右键菜单及跳转、中文输入法回车、快速切换搜索、预览的 `Tab` 和 `Esc`、书架失败重试。交付时区分静态检查和浏览器实测。公开截图或日志前，检查其中的搜索历史、账号等个人信息。

## 发布

仅在发布任务中更新 [manifest](extension/manifest.json) 版本。创建 tag 前完成以下准备。

1. 优先复用 `dist/<上一版本号>/` 的材料。缺少本地副本时参考上个发布 tag，无历史材料时从仓库现有文档开始。保留已有更新，按本版变化调整 `README.md` 和 `AGENTS.md`，在 `store/LISTING.md` 准备商店文案，并与 manifest 的名称和短描述对齐。
2. 验证后运行 `sh scripts/package.sh`（需 `python3` 和 `zip`）。核对 `dist/<版本号>/` 中的 `wee-read-web-<版本号>.zip`、`README.md`、`AGENTS.md`、`LISTING.md`，确认 ZIP 内的 manifest 版本及文档副本与本版一致。源码或文档变更后重新打包，`dist/` 产物留在本地。
3. 在包含本版源码和发布文档的提交上创建 `v<版本号>` tag，版本须与 manifest 一致。获得发布授权后推送 tag，GitHub Actions 会自动创建公开 Release。
