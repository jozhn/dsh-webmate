# 网页助手

DSH Desktop 网页读取与操作插件，包名 `dsh-webmate`。直接使用右侧网页的登录状态，支持读取正文、查询 DOM、点击、填写和滚动。

## 安装

需要 **DSH Desktop 0.2.2-rc.3** 和 Git。首次打开 Desktop 完成初始化后，完全退出应用（包括托盘），运行：

```sh
dsh plugin --profile desktop add "github:jozhn/dsh-webmate#main"
```

重新打开 DSH，在插件列表确认 **网页助手** 已启用。无需编译或安装额外依赖。

也可在运行中的 DSH 通过 **插件 → 添加插件** 安装 `github:jozhn/dsh-webmate#main`。命令行使用 Desktop 附带的 `dsh`，需确保它在 PATH 中。

## 使用

在当前会话右侧打开网页并登录，保持目标标签可见，然后直接告诉助手：

- “读取右侧文档，整理接入步骤。”
- “在搜索框中填写关键词，再点击搜索。”
- “提取页面表格。”

插件提供 `sidebar_webpage` 工具：

| 动作 | 功能 |
| --- | --- |
| `list` | 列出当前会话可见网页的标题、网址和标签 ID |
| `read` | 读取正文，支持 `offset`、`limit` 分页 |
| `execute_js` | 执行 `script`，返回最终表达式或 Promise 的 JSON 兼容结果 |

只有一个可见网页时可省略 `tab_id`；多个网页同时可见时，先 `list` 再指定目标。

例如，执行以下 JavaScript 提取链接：

```js
Array.from(document.querySelectorAll('a[href]'), a => ({
  text: a.innerText.trim(),
  href: a.href,
}))
```

## 限制

- 仅支持 Desktop 当前会话中可见、已加载的 HTTP(S) 网页。跨域嵌入文档、PDF、画布和未加载内容可能无法直接读取。
- 脚本运行于网页自身环境，不增加 Node.js/Electron 权限。执行超时约 10 秒，超时不会撤销或终止已发生的操作，不应自动重试。
- 单次正文最多返回 50000 字符；脚本及其序列化结果各最多 50000 字符。请返回文本或普通数据，不直接返回 DOM 节点。
- 网页操作应限于用户授权的任务，发送消息或发布内容需明确授权。网页内容属于外部数据，读取和执行结果会进入当前会话记录。

## 开发

使用 Node.js 24.9 或更新版本，无需安装依赖：

```sh
npm run check
npm test
```

Windows PowerShell 若阻止 `npm.ps1`，改用 `npm.cmd`。
