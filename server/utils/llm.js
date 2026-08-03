/* 
LLM模块，可以用chat方法调用LLM
调用示例
const result = await LLM.chat({
  apiURL: provider.apiURL,
  apiKey: provider.apiKey,
  model: session.model,
  systemPrompt,
  messages,
  tools: toolDefinitions,
  signal: session.runner.signal,

  onEvent(type, data) {
    SSE.emit(session, type, { messageId: assistantMessage.id, ...data })
  }
})

result.content       → 完整文本
result.contentBlocks → 完整的 blocks 数组，直接塞进 assistantMessage
result.toolCalls     → 需要执行的工具列表
result.usage         → token 用量
*/

import { dynamicTool, jsonSchema, streamText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export const LLM = {
	/**
	 * @param {object} options
	 * @param {string} options.apiURL
	 * @param {string} options.apiKey
	 * @param {string} options.model
	 * @param {string} options.systemPrompt
	 * @param {array}  options.messages
	 * @param {object} options.tools
	 * @param {AbortSignal} options.signal
	 * @param {function} options.onEvent - 每个流式事件的回调 (type, data) => void
	 *
	 * @returns {Promise<{ content, contentBlocks, toolCalls, usage }>}
	 */
	async chat({ apiURL, apiKey, model, systemPrompt, messages, tools, signal, onEvent }) {
		const provider = createOpenAICompatible({ name: "agent", baseURL: apiURL, apiKey });
		const modelTools = Object.fromEntries(
			Object.entries(tools ?? {}).map(([name, tool]) => [
				name,
				dynamicTool({ description: tool.description, inputSchema: jsonSchema(tool.parameters) }),
			]),
		);

		const stream = streamText({
			model: provider(model),
			system: systemPrompt,
			messages,
			tools: modelTools,
			maxRetries: 0,
			abortSignal: signal,
			onError: () => {},
		});

		// ── 结果容器 ──
		const contentBlocks = [];
		const toolCalls = [];
		let fullText = "";
		let usage = null;

		const textBlocks = new Map();
		const thinkBlocks = new Map();
		const toolBlocks = new Map();

		// ── 消费流，边读边推事件 ──
		for await (const part of stream.fullStream) {
			switch (part.type) {
				case "text-start": {
					const block = { type: "text", text: "" };
					textBlocks.set(part.id, block);
					contentBlocks.push(block);
					onEvent?.("text-start", { blockIndex: contentBlocks.length - 1 });
					break;
				}

				case "text-delta": {
					let block = textBlocks.get(part.id);
					if (!block) {
						block = { type: "text", text: "" };
						textBlocks.set(part.id, block);
						contentBlocks.push(block);
						onEvent?.("text-start", { blockIndex: contentBlocks.length - 1 });
					}
					block.text += part.text;
					fullText += part.text;
					onEvent?.("text-delta", {
						blockIndex: contentBlocks.indexOf(block),
						delta: part.text,
					});
					break;
				}

				case "reasoning-start": {
					const block = { type: "thinking", thinking: "" };
					thinkBlocks.set(part.id, block);
					contentBlocks.push(block);
					onEvent?.("thinking-start", { blockIndex: contentBlocks.length - 1 });
					break;
				}

				case "reasoning-delta": {
					let block = thinkBlocks.get(part.id);
					if (!block) {
						block = { type: "thinking", thinking: "" };
						thinkBlocks.set(part.id, block);
						contentBlocks.push(block);
						onEvent?.("thinking-start", { blockIndex: contentBlocks.length - 1 });
					}
					block.thinking += part.text;
					onEvent?.("thinking-delta", {
						blockIndex: contentBlocks.indexOf(block),
						delta: part.text,
					});
					break;
				}

				case "tool-input-start": {
					const block = {
						type: "tool_call",
						toolCallId: part.id,
						toolName: part.toolName,
						input: {},
						inputRaw: "",
						status: "pending",
					};
					toolBlocks.set(part.id, block);
					contentBlocks.push(block);
					onEvent?.("tool-call-start", {
						blockIndex: contentBlocks.length - 1,
						toolCallId: part.id,
						toolName: part.toolName,
					});
					break;
				}

				case "tool-input-delta": {
					const block = toolBlocks.get(part.id);
					if (block) {
						block.inputRaw += part.delta;
						onEvent?.("tool-input-delta", {
							toolCallId: part.id,
							delta: part.delta,
						});
					}
					break;
				}

				case "tool-call": {
					let block = toolBlocks.get(part.toolCallId);
					if (!block) {
						block = { type: "tool_call", toolCallId: part.toolCallId, toolName: part.toolName, input: {}, status: "pending" };
						toolBlocks.set(part.toolCallId, block);
						contentBlocks.push(block);
						onEvent?.("tool-call-start", { blockIndex: contentBlocks.length - 1, toolCallId: part.toolCallId, toolName: part.toolName });
					}
					if (block) {
						block.input = part.input;
						delete block.inputRaw;
						onEvent?.("tool-call-ready", {
							toolCallId: part.toolCallId,
							toolName: part.toolName,
							input: part.input,
						});
					}
					toolCalls.push({
						toolCallId: part.toolCallId,
						toolName: part.toolName,
						args: part.input,
					});
					break;
				}

				case "finish": {
					usage = part.totalUsage ? { inputTokens: part.totalUsage.inputTokens, outputTokens: part.totalUsage.outputTokens } : null;
					break;
				}

				case "tool-error":
					throw part.error;

				case "error":
					throw part.error;

				case "abort":
					throw new DOMException("LLM request aborted", "AbortError");
			}
		}

		// ── 返回完整结果给 agent.js ──
		return {
			content: fullText,
			contentBlocks,
			toolCalls,
			usage,
		};
	},
};
