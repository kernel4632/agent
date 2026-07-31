# 上下文裁剪

## 当前行为

`server/utils/compress.js` 在每次模型调用前估算 `modelMessages` 大小。它只返回请求副本，不修改：

- Session 的完整 `modelMessages`
- 前端展示的 `messages`
- 磁盘 Session
- 回退缓存

当前实现是确定性裁剪，不调用 LLM 生成摘要。

## 算法

```text
allowedTokens = floor(contextLimit * 0.8)
estimatedTokens = ceil(JSON.stringify(messages).length / 2)
```

未超过 `allowedTokens` 时返回完整结构化克隆。超过时：

1. 保留最前 4 条消息。
2. 保留最后 10 条消息。
3. 取二者之间的中段。
4. 从中段最早消息开始逐条删除。
5. 直到估算值进入 80% 预算。

```text
[head 4] + [remaining middle] + [tail 10]
```

头尾数量在当前实现中是固定值，不可配置。极端情况下，仅头尾本身也可能超过预算；当前算法不会进一步裁剪头尾。

## 上下文限制来源

按 Agent 的 Provider 和模型读取：

1. `providers[name].modelSettings[model].context`
2. `modelLimits[model].context` 旧配置
3. 默认 `128000`

模型消息只分配 80%，其余空间留给 system prompt、工具 schema 和模型输出。当前估算没有显式计算这些常驻内容的真实 token 数。

## 与 Session 的关系

| 层 | 行为 |
|---|---|
| 模型请求 | 使用裁剪副本 |
| `modelMessages` | 保存完整 AI SDK 协议历史 |
| `messages` | 保存完整用户可见历史 |
| 回退 | 同步截断或恢复两套完整历史 |
| 前端 | 不感知模型请求发生过裁剪 |

Child Run 使用相同算法，但它的私有消息只从显式 `prompt` 开始，不继承父模型历史。

## 已知限制

- 字符数除以 2 是中英混合保守近似，不使用已安装的 `tiktoken`。
- 工具调用与工具结果可能被单独裁掉，算法不保证协议消息成组保留。
- 没有摘要，因此被裁掉的中段事实不会进入后续模型请求。
- 没有压缩缓存，每轮都重新估算。

## 未来摘要模式

可以在不改变 Session 持久化格式的前提下增加摘要：

```text
head + structured summary + tail
```

摘要应保留用户约束、已执行副作用、关键决策、失败结果和下一步，并作为模型请求临时副本存在。实现前不得把该模式视为当前能力。
