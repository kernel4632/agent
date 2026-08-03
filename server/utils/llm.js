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

import { streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

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
		const provider = createOpenAI({ baseURL: apiURL, apiKey });

		const stream = streamText({
			model: provider(model),
			system: systemPrompt,
			messages,
			tools,
			abortSignal: signal,
		});

		// ── 结果容器 ──
		const contentBlocks = [];
		const toolCalls = [];
		let fullText = "";
		let usage = null;

		let currentTextBlock = null;
		let currentThinkBlock = null;

		// ── 消费流，边读边推事件 ──
		for await (const part of stream.fullStream) {
			switch (part.type) {
				case "text-delta": {
					if (!currentTextBlock) {
						currentTextBlock = { type: "text", text: "" };
						contentBlocks.push(currentTextBlock);
						onEvent?.("text-start", { blockIndex: contentBlocks.length - 1 });
					}
					currentTextBlock.text += part.textDelta;
					fullText += part.textDelta;
					onEvent?.("text-delta", {
						blockIndex: contentBlocks.length - 1,
						delta: part.textDelta,
					});
					break;
				}

				case "reasoning": {
					if (!currentThinkBlock) {
						currentThinkBlock = { type: "thinking", thinking: "" };
						contentBlocks.push(currentThinkBlock);
						onEvent?.("thinking-start", { blockIndex: contentBlocks.length - 1 });
					}
					currentThinkBlock.thinking += part.textDelta;
					onEvent?.("thinking-delta", {
						blockIndex: contentBlocks.length - 1,
						delta: part.textDelta,
					});
					break;
				}

				case "tool-call-streaming-start": {
					currentTextBlock = null;
					currentThinkBlock = null;
					const block = {
						type: "tool_call",
						toolCallId: part.toolCallId,
						toolName: part.toolName,
						input: {},
						inputRaw: "",
						status: "pending",
					};
					contentBlocks.push(block);
					onEvent?.("tool-call-start", {
						blockIndex: contentBlocks.length - 1,
						toolCallId: part.toolCallId,
						toolName: part.toolName,
					});
					break;
				}

				case "tool-call-delta": {
					const block = contentBlocks.findLast((b) => b.type === "tool_call" && b.toolCallId === part.toolCallId);
					if (block) {
						block.inputRaw += part.argsTextDelta;
						onEvent?.("tool-input-delta", {
							toolCallId: part.toolCallId,
							delta: part.argsTextDelta,
						});
					}
					break;
				}

				case "tool-call": {
					const block = contentBlocks.findLast((b) => b.type === "tool_call" && b.toolCallId === part.toolCallId);
					if (block) {
						block.input = part.args;
						delete block.inputRaw;
						onEvent?.("tool-call-ready", {
							toolCallId: part.toolCallId,
							toolName: part.toolName,
							input: part.args,
						});
					}
					toolCalls.push({
						toolCallId: part.toolCallId,
						toolName: part.toolName,
						args: part.args,
					});
					break;
				}

				case "finish": {
					usage = part.usage ? { inputTokens: part.usage.promptTokens, outputTokens: part.usage.completionTokens } : null;
					break;
				}
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
