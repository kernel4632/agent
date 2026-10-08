# agent-core 使用中遇到的问题与疑惑

给 `@kernel4632/agent-core` 的反馈，来自把本项目接上去的真实过程。只列问题和疑问。

## 1. 装配好的工具表没法按名字筛选 —— **0.26.0 已修**

新增了 `Agent.tool.pick` / `Agent.tool.omit`，`schema` 和 `handlers` 一起筛。

之前的卡点：`ToolSet` 是 `{ schema, handlers }`，自己筛只能手动筛两份 record，只筛一份会出现"模型看不见、却还能被执行"的隐蔽状态；试过拼回工具对象喂 `adopt`，报"缺少 execute 函数"，但 `handlers` 的形状文档没写。

## 2. `onPermission` 返回非布尔值会被静默当放行 —— **0.26.0 已修**

现在非 `true` 一律按拒绝处理。

之前的卡点：返回 `{ allowed: false }` 工具照样执行，无任何报错。靠真机跑一次才发现。

## 3. 没有"这个工具碰哪些文件"的声明位

工具自己知道 `path` 参数是文件路径，包不知道，应用只能自己维护一份文件工具名单。这份名单和 `inputSchema` 里的 `path` 是同一件事的两份描述，加工具时漏了不会被发现，我们靠一条反推测试兜住。建议：工具对象加可选的 `touchesFiles: ['path']`，在 `ToolSet.schema` 里透出。

## 4. `maxTokens` 名字指的是上下文预算 —— **0.26.0 已修**

改名 `maxContextTokens` 是对的。改名的破坏性我们真实踩到：漏改之后 128000 的上下文预算被当成输出上限发出去，全部测试绿、没有任何报错，只能抓请求体发现。疑惑：这类破坏性改名，能否在 `send` 入口对"`maxTokens` 设了但值大得不像输出上限"给一句警告。

## 5. `ToolSet.schema` 没有具体类型

`schema` 条目里 `inputSchema` 是已编译的校验器，真正的 JSON Schema 挂在 `.jsonSchema` 里；类型声明是 `Record<string, any>`，只能打印确认。建议在文档里给出字段表。

## 6. 疑惑：`send` 过程中怎么拿到累计用量

`usage` 只在 `send` 结束时给一次。应用想做"自动批准跑飞了的刹车"（连续 N 次、花费上限）就需要中途累加，而 `onLLMFinish` 里带的是这一笔的用量。疑问：压缩、重试这些内部请求走不走 `onLLMFinish`？想算对一笔任务总共花了多少，该从哪里取？
