# dsh-webmate

让 DSH 助手读取和操作右侧已经打开、已经登录的网页。无需复制正文、反复截图或单独登录。

支持读取网页正文、查询 DOM，以及通过 JavaScript 点击、填写和滚动。工具直接使用 DSH Desktop 当前会话的内嵌浏览器。

## 从 GitHub 一行安装

需要 **DSH Desktop 0.2.2-rc.3** 和可用的 Git。先启动一次 Desktop 完成初始化，再**完全退出 Desktop（包括托盘）**，在终端运行：

```sh
dsh plugin --profile desktop add "github:jozhn/dsh-webmate#main"
```

安装后重新打开 DSH Desktop，在插件列表确认 **dsh-webmate** 已启用。

如果已经安装过旧实验包 `@local/dsh-sidebar-browser-tools`，请先卸载旧包再安装本包，避免重复注册同名工具。

此包包含可直接加载的 JavaScript，没有运行时依赖，也没有 `prepare`、`install` 或 `postinstall` 脚本，无需先构建或发布到 npm。`dsh` 应使用 Desktop 安装附带的 CLI；如果终端提示找不到命令，请先确认 Desktop CLI 已加入 PATH，再打开新的终端。

也可以在 DSH 的 **插件 → 添加插件** 中填写同一 GitHub 安装地址，或直接让具备插件管理工具的助手安装它。这种方式可由运行中的 Desktop 管理插件，无需手动关闭应用。

仓库地址：[jozhn/dsh-webmate](https://github.com/jozhn/dsh-webmate)。

### 安装指定版本

仓库发布 `v1.0.0` 标签后，可以固定版本：

```sh
dsh plugin --profile desktop add "github:jozhn/dsh-webmate#v1.0.0"
```

也可将标签替换为完整 commit SHA。这里的 `1.0.0` 是插件版本，不是 DSH 版本；插件目前仅声明兼容 DSH `0.2.2-rc.3`。

### 从本地仓库安装

```sh
dsh plugin --profile desktop add "./dsh-webmate"
```

在仓库上一级目录运行。Desktop 的命令行安装同样要求完全退出应用；在运行中的 DSH 中也可以通过插件管理器选择仓库的绝对路径。

### 卸载

完全退出 Desktop 后执行：

```sh
dsh plugin --profile desktop remove dsh-webmate
```

或直接在应用的插件列表中停用、卸载。

## 使用

在当前会话右侧打开网页，完成登录并保持目标标签可见，然后直接告诉助手：

- “读取右侧文档，整理接入步骤。”
- “检查这个页面有哪些按钮。”
- “在搜索框中填写关键词，再点击搜索。”
- “执行 JavaScript，提取页面表格。”

插件提供 `sidebar_webpage` 工具：

| 动作 | 参数 | 返回 |
| --- | --- | --- |
| `list` | `action: "list"` | 当前会话可见网页的标题、网址和 `tabId` |
| `read` | `tab_id` 可选；`offset` 默认 0；`limit` 默认 20000 | 正文、来源网址、截断信息和后续偏移 |
| `execute_js` | `script` 必填；`tab_id` 可选 | 最终表达式或 Promise 的 JSON 兼容结果，以及执行状态 |

只有一个可见网页时可以省略 `tab_id`。多个网页同时可见时，先 `list`，再通过 `tab_id` 指定目标。

### JavaScript 示例

读取页面标题：

```js
document.title
```

提取链接：

```js
Array.from(document.querySelectorAll('a[href]'), a => ({
  text: a.innerText.trim(),
  href: a.href,
}))
```

滚动并返回当前位置：

```js
(() => {
  window.scrollBy(0, 300);
  return { y: window.scrollY };
})()
```

多语句脚本需要返回值时使用 IIFE；异步 IIFE 和 Promise 也可使用。请返回文本、数字、数组或普通对象，不直接返回 DOM 节点、函数、BigInt 或循环引用。

## 行为与限制

- 仅操作**当前会话中可见且已加载的 HTTP(S) 网页**；保留挂载的后台标签不会被当作可见页面。
- 使用页面现有登录状态；不会为网页增加 Node.js 或 Electron 权限，也不会模拟可信用户手势。网页的同源策略和权限限制仍然有效。
- `read` 不主动读取 Cookie、Web Storage 或输入控件的 `value`。`execute_js` 则具备网页自身 JavaScript 的能力，应仅用于用户授权的任务。发送消息、发布内容等操作仍需要用户明确授权。
- 脚本执行超时约为 10 秒。超时、取消或页面跳转**不代表操作没有发生，也不会撤销副作用**。结果可能标记为 `uncertain`，不得自动重试操作脚本，应先检查页面状态。
- 单次正文最多返回 50000 字符，提取上限为 1000000 字符；脚本和序列化结果各最多 50000 字符。分页每次读取当前页面，动态内容变化可能改变偏移位置。
- 跨域嵌入文档、PDF、画布、折叠内容和虚拟列表未加载部分可能无法直接提取。结果会报告不可读的嵌入页。若页面公开提供 `iframe.srcdoc`，可通过 JavaScript 读取该 HTML 字符串并使用 `DOMParser` 提取正文。
- 网页内容和脚本结果属于外部数据，不应被当作助手指令。结果通过 DSH 已认证连接进入当前会话的工具记录，插件不另行持久化正文或脚本结果。
- 本插件依赖 Desktop 侧栏接口，当前验证版本为 `0.2.2-rc.3`。普通 Web 浏览器中的跨域 iframe 不支持此能力；升级 DSH 后需重新验证兼容性。

## 开发与验证

使用 Node.js 24.9 或更新版本，无需 `npm install`：

```sh
npm run check
npm test
```

Windows PowerShell 若提示禁止运行 `npm.ps1`，将上述 `npm` 改为 `npm.cmd` 即可，无需调整系统执行策略。

打包检查：

```sh
npm pack --dry-run
```

主要文件：

| 文件 | 职责 |
| --- | --- |
| `host.js` | 注册工具和独立认证 RPC 通道 |
| `browser.js` | 定位当前会话可见网页、提取正文和执行 JavaScript |
| `broker.js` | 会话隔离、请求关联、取消与超时清理 |
| `cordis.patch.yml` | DSH 插件注册 |
| `locale/`、`icon.svg` | 插件名称、说明与图标 |
| `reader.test.mjs` | 通道、权限和工具集成测试 |

已验证：真实 Desktop 页面列举与读取、隔离嵌入文档的 `srcdoc` 提取、可还原 DOM 操作、Promise 结果，以及六项自动测试。插件管理页图标与明暗主题尚未做视觉验收。

## 发布到 GitHub

本仓库使用 `https://github.com/jozhn/dsh-webmate.git` 作为 `origin`。本地提交后推送：

```sh
git push -u origin main
```

发布版本标签可使用：

```sh
git tag v1.0.0
git push origin v1.0.0
```

`private: true` 仅防止误发布到 npm，不影响 GitHub 仓库或 GitHub 安装。
