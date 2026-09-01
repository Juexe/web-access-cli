# ADR 0014：extract 默认输出 Markdown

- 状态：已接受
- 日期：2026-09-01

## 背景

`extract` 主要用于阅读和传递网页正文。默认 JSON envelope 包含调用元数据，不适合作为人的直接阅读结果；同时已有机器消费者需要稳定的 schema v2 JSON。

## 决策

`extract` 成功时默认在 stdout 输出 Markdown。正文前使用 YAML front matter，固定字段顺序为 `provider`、`url`、可选的 `title`：

- `provider` 是最终 Provider Instance ID。
- `url` 是 `data.document.sourceUrl`。
- `title` 是去除首尾空白后的非空 `data.document.title`；为空时省略。

三个值统一使用 JSON 双引号标量编码，front matter 结束后保留一个空行，正文末尾至少有一个换行。正文内容和 Provider 协议不变，也不暴露 `contentType`、raw、attempts 或 headers。

`extract --json` 保留现有 schema v2 JSON 成功输出。`--pretty` 或 `--debug` 自动选择 JSON；extract 的失败、取消和 partial 结果始终输出 JSON envelope。其他命令的 JSON 输出不变。

## 结果

人类调用无需解析 envelope 即可阅读 Markdown；脚本和 Agent 必须显式使用 `--json`。本决策只改变 CLI 表示层，不改变 `ExtractRequest`、`ExtractData`、`OutputEnvelope`、Router、fallback 或 JSON Schema，因此不升级 schemaVersion。它取代 ADR 0003 和 ADR 0011 中关于 extract 成功默认输出为 JSON 的条款，但保留其 JSON 模式契约。
