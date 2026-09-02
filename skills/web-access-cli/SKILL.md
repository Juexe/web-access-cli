---
name: web-access-cli
description: 使用 web-access CLI 搜索实时网页信息、查找来源，并将指定 HTTP(S) 页面提取为 Markdown。用户需要联网搜索、核实近期信息、获取来源、阅读网页或提取网页正文时使用。
---

# web-access-cli

直接调用 `web-access` CLI。`search`、诊断命令和 `config edit` 的 stdout 是 JSON；`extract` 成功默认是带 YAML front matter 的 Markdown。正文来自 Provider 规范化后的 `data.document.content`，不会把 Provider 的 JSON envelope 当作正文；机器消费者必须显式追加 `--json` 以获取 schema v2 JSON envelope。

```sh
web-access search "query"
web-access extract "https://example.com"
web-access extract "https://example.com" --json
```

默认省略 `--provider`，由 CLI 使用 `auto` 路由和回退。只有用户明确指定 Instance，或自动调用失败后确认其他 Instance 可用时，才使用 `--provider <id>`。

调用失败后，可按需检查本地配置：

```sh
web-access providers
web-access doctor
```

确认替代 Instance 已启用且适合当前能力后，可显式重试一次：

```sh
web-access search "query" --provider <id>
web-access extract "https://example.com" --provider <id>
web-access extract "https://example.com" --provider <id> --json
```

`auto` 通常已经尝试可回退的 Instance，并会在 Provider 返回最终非 2xx HTTP 响应时继续 Route；成功 Instance 会成为下次同能力调用的首选，不要盲目重复请求。需要搜索过滤、数量或超时等选项时，运行 `web-access search --help` 或 `web-access extract --help`。

面向人的阅读直接运行 `extract <url>`；输出前置 YAML front matter，随后是 Markdown 正文。AnySearch Extract 使用 REST 响应的 `data.content` 字段作为正文，并使用 `data.title`/`data.url` 作为可用元数据，不输出完整 JSON 响应。

使用 `extract --json` 和 `search` 时，能力命令返回精简的 schema v2 envelope：成功读取 `data` 和 `provider`，失败读取 `error`，必要时读取精简 `attempts` 或 `partial`。`extract --pretty` 或 `extract --debug` 也会选择 JSON；extract 失败始终返回 JSON failure envelope。若出现 `warnings[].code == "provider_order_update_failed"`，主要结果仍有效，但下次调用可能继续使用旧顺序。不要在常规调用中使用 `--debug`；它只用于协议排障，会把 request、完整回退记录和脱敏 raw 放入嵌套 `debug` 对象。`providers`、`doctor` 和 `config edit` 仍返回详细诊断数据。`config edit` 使用非空 `VISUAL`，否则使用 `EDITOR`；值可包含带引号的命令路径和参数，不经 shell 解释，配置路径作为独立参数追加。两个变量都未设置或编辑器无法启动时返回 `open_failed`，命令只等待进程启动，不等待退出。

若 `web-access` 命令不存在，直接说明工具不可用；不要自动安装、构建或改用源码入口。
