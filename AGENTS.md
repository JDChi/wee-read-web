# AGENTS.md

## 项目概况

`wee-read-web`（微小读）是微信读书网页版的非官方 Chrome Manifest V3 扩展，提供最近搜索和搜索结果快捷加入书架功能。

- 使用原生 JavaScript、CSS 和 Chrome 扩展 API，无 npm 依赖、构建步骤或后台服务。
- 仅在 `https://weread.qq.com/*` 运行，目前只申请 `storage` 权限。
- 开发时直接在 `chrome://extensions` 加载 `extension/` 目录。

## 文件导航

- `extension/manifest.json`：扩展配置、权限、注入范围和发布版本号。
- `extension/content.js`：搜索记录、搜索资源观察、书籍映射、书架查询、加入书架及 DOM 注入。
- `extension/content.css`：扩展界面样式、浮层层级、键盘焦点及深色模式。
- `extension/icons/`：随扩展分发的图标。
- `scripts/package.sh`：读取 manifest 版本并生成 `dist/wee-read-web-版本号.zip`。
- `scripts/generate_icons.py`：仅使用 Python 标准库生成 16、48、128 像素图标。
- `.github/workflows/release.yml`：推送 `v*` 标签时检查版本、打包并创建 GitHub Release。
- `README.md`、`PRIVACY.md`：安装、功能和数据处理说明。
- `store/`：商店相关素材；`dist/` 为本地产物目录，已被 Git 忽略。

## 修改约定

- 默认使用中文沟通，界面文案保持中文。
- 沿用现有风格：JavaScript 使用两空格缩进、双引号、分号，代码保留在现有严格模式 IIFE 内；CSS 类名和变量使用 `wr-helper-` 前缀。
- 优先小范围修改；不要为简单功能引入框架、依赖或构建工具。
- DOM 选择器和微信读书接口属于外部依赖，修改时以实际页面和响应为准，不把当前结构当成稳定契约。
- 注入逻辑应可重复执行，避免重复元素、重复事件和 MutationObserver 自触发循环；保留现有的渲染合并机制。
- 异步搜索结果和书架查询须防止旧请求污染新搜索，注意 `searchGeneration`、请求去重及 `pendingAdds`。
- 外部文本通过 `textContent` 等安全方式写入 DOM，不直接拼接到 `innerHTML`。

## 功能与隐私约束

- 最近搜索使用 `chrome.storage.local` 的 `recentSearches` 键，最多保留 5 个去重、去首尾空白的搜索词；保持清空、重新搜索和跨页面存储同步能力。
- 只有确认书籍可读、且书架状态明确为未加入时才显示“加入书架”；查询失败或状态未知时不显示。
- 加入书架必须由用户点击触发，防止重复提交；成功后隐藏同一本书的相关入口，失败时保留可重试能力并给出提示。
- 请求直接使用微信读书同源接口及现有登录状态，不读取、保存或输出登录凭证，不引入开发者服务器中转或数据上报。
- 元数据、存储或接口失败时，尽量保持微信读书原有搜索与阅读流程可用。
- 修改权限、域名范围、存储内容或数据流时，同步检查 `README.md`、`PRIVACY.md` 及相关商店说明。

## 验证与打包

目前没有自动化测试框架。根据修改范围执行相应检查，并在交付说明中区分静态检查和真实浏览器验证。

```sh
# JavaScript 语法检查（需要本机有 Node.js）
node --check extension/content.js

# Manifest JSON 和打包脚本语法检查
python3 -m json.tool extension/manifest.json > /dev/null
sh -n scripts/package.sh

# 打包（需要 python3 和 zip；会覆盖同版本 ZIP）
sh scripts/package.sh
```

涉及交互时，在 Chrome 刷新扩展并刷新微信读书页面，按改动范围验证：

- 最近搜索：去重、最多 5 条、刷新后保留、清空、点击重新搜索，以及中文输入法回车。
- 浮层：焦点与关闭行为、方向键和 Escape、滚动和窗口缩放后的定位、结果遮挡及深色模式。
- 书架：已加入与未加入的书、状态未知、重复点击、成功后入口隐藏、失败提示和重试。
- 动态页面：连续切换关键词、搜索结果更新或翻页后，没有旧结果串入或重复按钮。

未实际操作浏览器时，不声称交互验证通过。截图和日志如需对外展示，先检查搜索历史、账号信息等个人数据。

## 发布与协作

- 版本号以 `extension/manifest.json` 为准；只有任务涉及发布时才升级版本或创建标签。
- 发布标签必须为 `v` 加 manifest 版本号；推送标签会自动创建公开 GitHub Release，仅在用户授权发布时执行。
- 不手动修改 ZIP 内文件；修改 `extension/` 源码后通过脚本重新打包。不要提交 `dist/` 产物。
- 保留用户已有改动，不擅自覆盖、回退或提交与任务无关的文件。
- 用户要求 clone GitHub 仓库时，默认放在 `~/develop/github/`。
- 需要查看用户当前浏览器内容时，可以尝试 OpenCLI；涉及 Cloudflare 时优先使用 Wrangler。
- GitHub 操作优先使用外部终端的 `gh` CLI；不可用时再考虑适用的 Git 命令。
