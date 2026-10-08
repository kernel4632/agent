# agent-core 待处理反馈

来自把本项目接上 `@kernel4632/agent-core` 的真实过程。只列问题和疑问，每条最短说清。

## 1. 没有"这个工具碰哪些文件"的声明位

工具自己知道 `path` 参数是文件路径，包不知道，应用只能自己维护一份文件工具名单。这份名单和 `inputSchema` 里的 `path` 是同一件事的两份描述，加工具时漏了不会被发现，我们靠一条反推测试兜住。建议：工具对象加可选的 `touchesFiles: ['path']`，在 `ToolSet.schema` 里透出。

## 2. `ToolSet.schema` 没有具体类型

`schema` 条目里 `inputSchema` 是已编译的校验器，真正的 JSON Schema 挂在 `.jsonSchema` 里；类型声明是 `Record<string, any>`，只能打印确认。建议在文档里给出字段表。

## 3. `send` 过程中怎么拿到累计用量

`usage` 只在 `send` 结束时给一次。应用要做"自动批准的花费刹车"就需要中途累加，而 `onLLMFinish` 里带的是这一笔的用量。疑问：压缩、重试这些内部请求走不走 `onLLMFinish`？想算对一笔任务总共花了多少，该从哪里取？
