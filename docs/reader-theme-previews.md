# 微信读书阅读页主题预览

微小读的阅读主题设计记录，供后续预览和实现复用。两套样式在 Dia 的微信读书阅读页试过，均为当前标签页的临时预览。

## 配色与范围

| 区域 | 浅灰 | 纸纹 |
| --- | --- | --- |
| 正文纸面 | `#EBEBEB` | `#F4F1E8`，平铺细颗粒纸纹 |
| 外围和顶部栏 | `#DEDEDE` | 约 `#EBE7DB`，用同一张纹理叠一层 7% 的暖灰色 |
| 正文默认字色 | `#2B2B2B`，约 11.9:1 | `#34312D`，相对米白底约 11.5:1 |
| 圆形工具按钮 | `#EBEBEB`，悬停 `#E0E0E0` | `#F1EDE3`，悬停 `#E7E1D4` |

纸纹版的正文和外围使用同一个 512 × 384 PNG，以 256 × 192 CSS 像素的尺寸和同一个视口原点平铺。纹理由均值接近零的细颗粒与缓慢变化的明暗叠加而成，单个色值相对米白底最多偏离 6 级。正文使用较浅的纸面和很轻的暖色阴影，保留圆角轮廓和书籍自己的章节强调色。

可直接复用按下方算法生成的原始尺寸图块。 [纸纹图块 PNG](images/reader-paper-texture.png)

## 在当前阅读页复现

在 `https://weread.qq.com/web/reader/…` 打开能正常阅读的章节，在当前网页的开发者工具控制台运行下方代码。开头的 `theme` 值用 `"gray"` 或 `"paper"`。改值后重新运行整段即可切换预览，刷新页面可撤回。

```js
(() => {
  const theme = "paper";
  if (location.origin !== "https://weread.qq.com" ||
      !/^\/web\/reader\/[\w-]+\/?$/.test(location.pathname) ||
      !document.body?.matches(".wr_page_reader") ||
      !document.querySelector(".readerChapterContent")) {
    throw new Error("请在已加载正文的微信读书阅读页运行");
  }

  function createPaperTile() {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 384;
    const context = canvas.getContext("2d");
    const pixels = context.createImageData(canvas.width, canvas.height);
    const cell = 8;
    const columns = canvas.width / cell;
    const rows = canvas.height / cell;
    let seed = 184371;

    function random() {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    }

    const grain = Float32Array.from({ length: columns * rows }, () => random() * 2 - 1);
    const mix = (start, end, position) => start * (1 - position) + end * position;
    for (let y = 0; y < canvas.height; y++) {
      const row = Math.floor(y / cell);
      const nextRow = (row + 1) % rows;
      const dy = y / cell - row;
      for (let x = 0; x < canvas.width; x++) {
        const column = Math.floor(x / cell);
        const nextColumn = (column + 1) % columns;
        const dx = x / cell - column;
        const top = mix(grain[row * columns + column], grain[row * columns + nextColumn], dx);
        const bottom = mix(grain[nextRow * columns + column], grain[nextRow * columns + nextColumn], dx);
        const noise = Math.round(3 * mix(top, bottom, dy) + 3 * (random() - random()));
        const offset = (y * canvas.width + x) * 4;
        pixels.data[offset] = 244 + noise;
        pixels.data[offset + 1] = 241 + noise;
        pixels.data[offset + 2] = 232 + noise;
        pixels.data[offset + 3] = 255;
      }
    }
    context.putImageData(pixels, 0, 0);
    return canvas.toDataURL("image/png");
  }

  const marker = Symbol.for("wr-helper-reader-theme-preview");
  const previous = window[marker];
  const light = "body.wr_page_reader.wr_whiteTheme";
  const outside = `html:has(${light} .readerChapterContent),
    ${light}:has(.readerChapterContent),
    ${light} :is(#app, .readerChapterContent_container, .readerTopBar)`;

  const gray = `
    ${outside} { background-color: #dedede !important; }
    ${light} :is(.readerChapterContent, .readerControls_item, .readerCatalog,
        .readerCatalog_content, .readerCatalog_list) { background-color: #ebebeb !important; }
    ${light} :is(.readerChapterContent, .readerChapterContent :is(p, h1, h2, h3, h4, h5),
        .readerCatalog) { color: #2b2b2b !important; }
    ${light} :is(.readerTopBar_title_link, .readerTopBar_link, .readerTopBar_addToShelf_icon,
        .readerFooter, .readerFooter_content, .readerControls_item, .readerCatalog_list_item,
        .renderTargetPageInfo_header_chapterTitle, .wr-helper-reading-remaining) { color: #505050 !important; }
    ${light} .readerTopBar .wr-helper-reading-remaining { background-color: #dedede !important; }
    ${light} :is(.readerControls_item, .readerCatalog_list_item):hover { background-color: #e0e0e0 !important; }
  `;

  const texture = theme === "paper" ? previous?.texture ?? createPaperTile() : previous?.texture;
  const shade = "rgba(115, 92, 50, .07)";
  const paper = `
    ${outside} {
      background-color: #ebe7db !important;
      background-image: linear-gradient(${shade}, ${shade}), url("${texture}") !important;
      background-position: 0 0 !important;
      background-size: auto, 256px 192px !important;
      background-repeat: no-repeat, repeat !important;
      background-attachment: fixed !important;
    }
    ${light} .readerChapterContent {
      background: #f4f1e8 url("${texture}") 0 0 / 256px 192px repeat fixed !important;
      color: #34312d !important;
      box-shadow: 0 8px 30px rgba(73, 56, 30, .045) !important;
    }
    ${light} .readerControls_item { background-color: #f1ede3 !important; }
    ${light} .readerControls_item:hover { background-color: #e7e1d4 !important; }
    ${light} .readerTopBar .wr-helper-reading-remaining { background-color: transparent !important; }
  `;

  const sheet = previous?.sheet ?? new CSSStyleSheet();
  sheet.replaceSync(theme === "paper" ? paper : gray);
  if (!document.adoptedStyleSheets.includes(sheet)) {
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }

  const redrawReader = () => requestAnimationFrame(() => {
    if (document.querySelector(".readerChapterContent")) window.dispatchEvent(new Event("resize"));
  });
  if (!previous) {
    let wasLight = document.body.matches(light);
    const observer = new MutationObserver(() => {
      const isLight = document.body.matches(light);
      if (isLight === wasLight) return;
      wasLight = isLight;
      redrawReader();
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  }
  window[marker] = { sheet, texture };
  redrawReader();
})();
```

## 后续复用与验证

- 浅色阅读页用 `body.wr_page_reader.wr_whiteTheme` 标记。让预览规则随这个类自动启停，即可把官方深色模式的纸面、字色和工具按钮交还给原站。切回浅色时，预览恢复，阅读器重新绘制正文。
- `.readerChapterContent` 是正文纸面，`.readerChapterContent_container` 是页边，`.readerTopBar` 是顶部栏。纸纹版按同一坐标给这些表面设置背景。只给 `html` 设背景时，Dia 在切回浅色后曾显示成白底。
- 双栏阅读器会把正文绘进 Canvas。CSS 计算字色更新后，画布可能仍保留旧笔画。验证时等阅读器重绘，再抽样画布里普通正文笔画的颜色。浅灰版应为 `rgb(43, 43, 43)`，纸纹版应为 `rgb(52, 49, 45)`。
- 在同一段正文对照原版和预览，检查圆角边界、两栏间空白、原有划线和按钮。点月亮确认原生深色，点太阳确认预览恢复。若后续做成扩展选项，再验证滚动阅读、换章和翻页。

## 正式主题接管（待实现）

### 主题选择和恢复

微小读的主题按钮提供「浅色」「深色」「浅灰」「纸纹」四个选项。最后一次选择存入 `chrome.storage.local` 的 `readerTheme`，值分别为 `light`、`dark`、`gray`、`paper`。刷新或打开另一本书时，以这项设置为准。首次使用时沿用原站主题，直到用户作出选择。

阅读页内容脚本将选中的值写入根节点的 `data-wr-helper-theme`。四套样式均以该标记为启用条件，覆盖纸面、外围、章节目录、工具栏和弹层。官网可以继续恢复自己的亮暗状态。它的 `wr_whiteTheme` 变化用来判断是否需要重新绘制正文，当前显示的主题由微小读保留的选择决定。

### 首帧时序和重绘

- **首帧闪屏。** 官网可能先画出原样式，尤其是主题设置读取较晚或纸纹图片尚未就绪时。将阅读页的主题样式和读取逻辑提前到 `document_start`，读出设置后尽早加上主题标记，再应用纸纹素材。即使提前注入，本地存储的异步读取和原站首次绘制仍可能竞争。
- **背景和笔画不一致。** 双栏正文可能已用原站颜色画进 Canvas，官网恢复亮暗时也可能再绘制一次。应用配色后通过现有页面事件通道请求阅读器重绘。先验证已在预览中起效的 `resize` 路径。如果某个阅读模式仍复用旧字色，再定位阅读器实际获取或应用正文颜色的位置，只在那里接入主题设置。
- **慢加载和失败回退。** 如果实测仍会闪动，可让正文区域短暂只显示主题底色，等正确的正文首帧绘出后再显示文字。给等待设置超时。读取设置或重绘失败时，撤回临时遮挡和自定义样式，恢复原站阅读。自定义按钮成功挂载后再替换原生入口。挂载或后续恢复失败时，显示原生入口。

### 验收场景

- 让官网记住深色，微小读分别记住纸纹和浅灰。检查冷启动、刷新和换书，记录首帧是否短暂出现官网配色，并确认最终显示微小读选中的主题。
- 四套主题来回切换，在双栏和滚动模式中检查正文笔画、插图、划线、纸面和页边。实际打开目录、字体面板等弹层，确认文字和控件配色一致。
- 模拟偏好读取失败、自定义按钮挂载失败以及正文等待超时，确认原站的阅读、翻页和主题入口可用。
