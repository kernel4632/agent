# 用 `@kernel4632/agent-core` 0.25.0 做完整应用时遇到的摩擦

这份清单来自把本项目接到 `agent-core` 0.25.0 上的真实过程，不是读文档推出来的猜测。
每条都写清「想做什么、卡在哪、建议怎么改」，以及它值多少优先级。

先说结论：**这个包的能力边界划得很准**。把 MCP、技能、会话存储留给应用，核心只管
循环和工具执行，是对的；`capabilities`、`cache`、`stream`、`toolMode` 这些默认值也
正好就是"默认全原生"想要的样子，我几乎没有为了默认行为写过补偿代码。下面都是
边角上的粗糙，不是方向问题。

---

## 1. 装配好的工具表没法筛选，做不出"计划模式"（优先级：高）

### 想做什么

opencode 有 plan / build 两种模式：plan 只允许只读工具，模型只能看不能改。
我想在应用层实现它，做法是拿到装配好的工具表，按名字筛掉写工具。

### 卡在哪

`Agent.tool.from()` / `merge()` 返回的 `ToolSet` 是 `{ schema, handlers }`。
我想按这两份表各自筛一遍再交回去，就先试了「把 schema 和 handler 拼回工具对象、
再喂给 `adopt`」：

```js
const filtered = Object.fromEntries(
    Object.keys(merged.schema)
        .filter(name => config.toolFilter(name))
        .map(name => [name, { ...merged.schema[name], execute: merged.handlers[name] }]),
)
Agent.tool.adopt(filtered)
```

拿到的是：

```text
TypeError: 工具 finish、ask、edit、file_read、file_write、file_list、glob、grep、
apply_patch、shell、todo、webfetch、skill、task 缺少 execute 函数
```

也就是说 `handlers[name]` 不是能直接当 `execute` 用的形状，但它是什么形状文档没写，
`ToolSet` 的 JSDoc 只有类型名没有字段说明。最后我只能放弃 `adopt`，手动筛两份 record：

```js
const allowed = Object.keys(merged.schema).filter(config.toolFilter)
const tools = {
    schema: Object.fromEntries(allowed.map(name => [name, merged.schema[name]])),
    handlers: Object.fromEntries(allowed.map(name => [name, merged.handlers[name]])),
}
```

这样能用，但我是靠试错试出来的，而且"两份表必须同时筛"这件事完全靠注释传达——
只筛一份会得到"模型看不见但执行器还能跑"的隐蔽状态。

### 建议

给一个官方的子集操作，名字直白：

```js
Agent.tool.pick(tools, ['file_read', 'grep', 'glob'])   // 按名字留一部分
Agent.tool.omit(tools, ['file_write', 'shell'])         // 按名字去掉一部分
```

或者至少把 `handlers` 的形状写进 README 的类型表，并在 `adopt` 的错误信息里说清
"要传 execute，不是 handler；已有的工具表直接用 `merge` 组合，不要拆开重构"。

---

## 2. `onPermission` 返回非布尔值会被静默当成放行（优先级：高）

### 想做什么

我想在审批回调里带上"是哪条规则挡下的"，于是返回了一个对象：

```js
onPermission: ({ toolName, input }) => {
    if (blocked(toolName, input)) return { allowed: false, reason: '被 .env 规则挡住' }
    return { allowed: true }
}
```

### 卡在哪
**所有工具都被放行了，包括我明确想拦住的 `.env` 读取**，而且没有任何报错或警告。

我起了一个假的 OpenAI 兼容服务（第一轮要求调用工具、第二轮结束），跑真实的
`agent.send()`，逐个试不同的返回值，看工具到底有没有被执行：

| `onPermission` 返回 | 工具被执行了吗 |
| --- | --- |
| `false` | 否 |
| `true` | 是 |
| `{}` | **是** |
| `{ allowed: false }` | **是** |

最后一行是问题所在：我返回 `{ allowed: false }`，语义上明确表达了"不许执行"，
但工具照样跑起来了。原因是对象总是真值，核心按 `if (await onPermission(...))` 判断。

文档里 `onPermission` 的类型写的是 `boolean | Promise<boolean>`，但运行时不校验，
传错就静默降级成"全部允许"——对安全相关的回调来说，这个默认方向是危险的。
代码看起来完全正确，只是不生效，我是靠真机跑一次才发现的。

### 建议

两件事任选其一或都做：

- 运行时检查返回值类型，不是布尔就抛错（或者退一步：`console.warn` 一次）
- 失败方向反过来：拿到不认识的值时按**拒绝**处理，而不是放行

理由和 `capabilities` 的 `mediaFallback` 一样——安全相关的默认值要选"拦住"。

---

## 3. 没有地方声明"这个工具有副作用"（优先级：中）

### 卡在哪

我要实现两件依赖"这次工具调用会碰哪些文件"的功能：

- 改文件之前存快照，回退时恢复（`features/snapshot.js`）
- 拦住碰到密钥文件的调用（`features/ignore.js`）

`agent-core` 知道每个工具的 `inputSchema`，但不知道 **`path` 这个字段代表一个会被
写入的文件**。这个语义只有工具自己清楚，所以我在应用里维护了一份名单：

```js
// server/utils/tool-files.js
export const FILE_TOOLS = ['file_read', 'file_write', 'file_list', 'edit', 'apply_patch', 'glob', 'grep']
```

问题在于这份名单和工具自己的 `inputSchema.properties.path` 是**同一件事的两份描述**。
我加一个内置工具时要记得回这里加一笔，忘了不会被发现——所以我另外写了一条测试，
从 `tools.schema` 里反推哪些工具带 `path`/`patches` 参数，和这份名单比对
（`server/tests/contract.test.js` 的「碰文件的工具都登记进了忽略规则」）。

测试能兜住，但这是应用在为包的结构补漏。

### 建议

工具对象上加一个可选的声明位，让包把这份知识透出来：

```js
export default {
    name: 'file_write',
    description: '...',
    inputSchema: { ... },
    touchesFiles: ['path'],          // 参数里这几个字段是文件路径
    // 或者更通用：effects: ['write'], effects: ['read']
    async execute({ path, content }) { ... },
}
```

然后 `ToolSet.schema[name].touchesFiles` 就能读到，应用不用再自己维护名单。
这同时能让"默认只读模式"变成包的一等能力：

```js
Agent.create({ config: { readOnly: true } })   // 或者 toolMode 再扩一个值
```

---

## 4. `maxTokens` 这个名字指的是上下文预算，不是输出上限（优先级：中）

### 卡在哪

第一次读配置表时我把它理解成"单次生成最多多少 token"，配了一个 4096，
结果自动压缩在很短的会话里就被触发。README 里其实写了：

> `maxTokens` | `128000` | 上下文预算，**默认开启自动压缩**……
> 注意区别于 `provider.maxOutputTokens`（那是单次生成上限）

文档是清楚的，但名字本身会把人带偏。一个只看配置名、不看文档的人（比如接手者）
很容易踩到，而症状是"模型回复被截断"或"压缩触发太早"，和名字联想的方向不一致。

### 建议

保留 `maxTokens` 做兼容，同时接受一个不会误读的别名：

```js
config: {
    contextBudget: 128000,   // 和 maxTokens 同义，二选一
}
```

---

## 5. `ToolSet.schema` 里到底有哪些字段（优先级：低）
### 卡在哪

我要判断一个工具碰不碰文件，得知道 schema 条目里有没有代表路径的参数。
打印出来才确定：

```text
schema 条目的字段: name, description, inputSchema
inputSchema 的键 = _type, jsonSchema, validate
```

也就是说 `inputSchema` 是一个**已编译的校验器**（`_type` / `jsonSchema` / `validate`），
真正的 JSON Schema 在 `.jsonSchema` 里，而且外面还可能有 `{ jsonSchema: {...} }` 这一层。
类型声明里 `ToolSet.schema` 是 `Record<string, any>`，`any` 把这块信息藏起来了，
所以只能靠打印确认。

### 建议

给 `ToolSet` 一个具体类型，哪怕只是文档表格：

| 字段 | 说明 |
| --- | --- |
| `schema[name].description` | 给模型看的说明 |
| `schema[name].inputSchema.jsonSchema` | 参数结构（已编译的校验器上挂着原始 schema） |
| `handlers[name]` | 执行器内部形状；不要自己构造，原样传回 `merge` |

---

## 6. 做得好的地方（这些别改）

写下来是因为它们省了我不少事，改版本时别顺手破坏：

- **`toolMode: 'native'` + `system` 默认空** —— 正好就是"不做任何提示词注入"想要的样子。
  我不需要写任何代码来保证 `system` 干净，只要用户没填就是 `''`。
- **`cache` 和 `stream` 默认开** —— 默认值即最优，应用不用配。
- **`capabilities` 逐项开关** —— 名字和 AI SDK 一致，界面上的开关可以直接透传，不用翻译。
- **每个出口都补一条模型能读的结果** —— 没遇到过"调用缺结果导致 400"的情况，
  这个设计确实避掉了一整类难题。
- **`noToolPrompt` 只在当次请求挂上、不写进 `history`** —— 让"提醒模型继续用工具"
  不需要污染应用自己保存的历史。
- **`Agent.tool.execute({ name, input, handlers })`** —— 按名字单独跑一个工具，
  我做工具级回退时靠它验证过某次调用的实际效果。
- **错误信息具体** —— `缺少 execute 函数` 直接列出了所有出问题的工具名，
  比只报"参数不合法"有用得多。

---

## 优先级汇总

| # | 问题 | 影响 | 优先级 |
| --- | --- | --- | --- |
| 1 | 装配好的工具表没法筛选 | 做不出"计划模式"这类能力，只能手动筛两份 record | 高 |
| 2 | `onPermission` 非布尔返回值静默放行 | 安全规则整体失效且无提示 | 高 |
| 3 | 没有"工具有副作用"的声明位 | 应用要重复维护一份文件工具名单 | 中 |
| 4 | `maxTokens` 名字指上下文预算 | 易误配，症状和字面联想相反 | 中 |
| 5 | `ToolSet.schema` 无具体类型 | 得靠试错确定字段形状 | 低 |

第 1 和第 2 条是我这次真的被卡住、并且花了时间调试的；第 3 条是我为了让代码符合
"数据只有一个来源"而不得不额外写测试兜住的。其余是顺手的观察。
