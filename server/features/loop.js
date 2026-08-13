/*
Agent 循环引擎：构建上下文 → 压缩 → 请求模型 → 执行工具（回调）→ 循环控制。
直接访问 store 读取配置，工具执行通过 execute 回调由调用方定制。
调用示例：await Loop.run({ messages, provider, signal, execute, onEvent, onReply, onTools, onRetry })。
*/
import { store } from "../store.js"; // 引入全局配置
import { LLM } from "../utils/llm.js"; // 引入 LLM 流式请求能力
import { Message } from "../utils/message.js"; // 引入消息构造
import { Retry } from "../utils/retry.js"; // 引入可中断重试
import { Context } from "./context.js"; // 引入上下文构建
import { Summary } from "./summary.js"; // 引入摘要生成

// --- 运行 Agent 循环 ---
async function run({ messages, provider, signal, execute, prompts, onEvent, onReply, onTools, onRetry }) {
	let textCount = 0; // 模型连续多少轮只回文字、没调工具

	// === 主循环：一直跑，直到被停止、模型连续3轮没用工具、或工具要求停止 ===
	while (!signal.aborted) {
		// --- 把历史消息打包成上下文 ---
		let [built, tokens] = Context.build(messages);

		// --- 如果上下文太长就生成摘要---
		if (provider.maxTokens && tokens > provider.maxTokens* 0.8) {
			const summary = await Summary.generate(built);
			if (summary) {
				messages.push(summary); // 摘要作为新消息加进历史
				[built, tokens] = Context.build(messages); // 重新打包，这次会短很多
			}
		}

		// --- 如果模型已经连续2轮没用工具，额外加一句提醒 ---
		const input = textCount === 2 ? [...built, { role: "user", content: [{ type: "text", text: prompts.tool }] }] : built;

		// --- 调模型，失败会自动重试 ---
		const result = await Retry.run(
			async () => await LLM.chat({ url: provider.url, key: provider.key, model: provider.model, system: prompts.system, messages: input, tools: store.tools, signal: signal, onEvent: (type, data) => onEvent?.(type, data) }),
			{
				signal,
				onRetry: onRetry ? ({ attempt, delay, error }) => onRetry({ attempt, delay, error: error?.message ?? String(error) }) : undefined, // 重试时通知外面（第几次、等多久、什么错）
			},
		);

		// --- 回复包装 ---
		const assistant = Message.assistant(result.contentBlocks);
		if (result.usage) assistant.usage = result.usage; // 记录这轮花了多少 token

		onReply?.(assistant); // 通知外面：模型说完了，完整回复在这

		// --- 如果模型没有调工具，就把回复存进历史 ---
		if (result.toolCalls.length === 0) {
			// 模型只回了文字，没调工具
			messages.push(assistant);
			textCount += 1;

			if (textCount >= 3) return; // 连续3轮纯文字，认为任务结束，退出
			continue; // 否则继续下一轮
		}

		// --- 如果模型调了工具，让外部去执行 ---
		textCount = 0; // 用了工具，重置计数

		const toolResults = await execute(result.toolCalls); // 外部负责：审批、执行、返回结果
		const results = toolResults.map((o) => o.result); // 提取每个工具的执行结果
		const shouldStop = toolResults.some((o) => o.stop); // 任何工具说"该停了"就停

		// --- 把回复和工具结果一起存进历史 ---
		const toolMessage = Message.tool(results);
		messages.push(assistant, toolMessage); // 成对入列：助手消息 + 工具结果

		await onTools?.(toolMessage, results); // 通知外面：工具跑完了

		if (shouldStop) return; // 工具说停，就停
	}
	// 走到这里说明 signal 被中止了，静默退出
}

export const Loop = { run };
