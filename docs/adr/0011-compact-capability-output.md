# ADR 0011：能力命令默认精简输出

- 状态：已接受
- 日期：2026-08-19
- 说明：extract 成功的默认表示方式由 ADR 0014 补充；`--json`、`--pretty`、`--debug` 和失败路径仍使用本 ADR 的精简 envelope。

## 背景

`search` 和 `extract` 主要由 Agent 调用。v1 envelope 在规范化 `data` 之外重复输出 request、耗时、完整 attempts 和 Provider raw；提取正文还会让 raw 与 data 大量重复，造成上下文噪音和不必要的敏感数据暴露。

## 决策

能力命令的 JSON 模式使用 output schema v2。`search` 和 `extract --json` 的成功 envelope 只包含 schema 版本、`ok`、最终 Instance ID 和规范化 `data`；默认失败 envelope 包含精简 `error`，以及可选的 Provider ID/错误码/HTTP status attempts 和不含 raw 的 `partial`。extract 成功的默认 Markdown 表示由 ADR 0014 定义。

`search` 和 `extract` 的 `--debug` 选项在同一个精简 envelope 中增加嵌套 `debug` 对象，提供 request、耗时、完整 attempts、ProviderRef 和经过现有规则脱敏的 raw。诊断命令与配置编辑命令保留详细数据，但统一使用 schema v2。旧版 v1 和兼容输出路径不再维护。

## 结果

正常 Agent 调用的输出大小与 Provider 原始响应大小脱钩，同时保留必要的规范化业务数据和最终 Provider 信息。协议排障仍可显式获取完整上下文，但调用方必须承担 raw 可能较大的成本。破坏性字段变更通过 schema 版本升级和同步 README、Skill、JSON Schema 公开记录。
