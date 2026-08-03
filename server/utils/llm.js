/*
LLM 流工具：请求 OpenAI-compatible 模型，处理单轮超时，并返回完整内容块和工具调用。
本文件只依赖调用参数和模型 SDK，不读取 store、会话或 SSE 客户端。
调用示例：await LLM.chat({ apiURL, apiKey, model, messages, tools, signal, onEvent })。
*/
import { dynamicTool, jsonSchema, streamText } from 'ai' // 引入 AI SDK 流式文本和动态工具能力
import { createOpenAICompatible } from '@ai-sdk/openai-compatible' // 引入 OpenAI-compatible 模型客户端

const defaultTimeoutMS = 120000                          // 单轮模型请求默认最多等待两分钟


// --- 请求一轮 LLM ---
async function chat({ apiURL, apiKey, model, systemPrompt, messages, tools, signal, onEvent }) {
  const configuredTimeout = Number(process.env.AGENT_REQUEST_TIMEOUT_MS ?? defaultTimeoutMS) // 读取可选单轮请求预算
  const timeoutMS = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? Math.floor(configuredTimeout) : defaultTimeoutMS // 非法值回退默认预算
  const timeoutSignal = AbortSignal.timeout(timeoutMS)   // 超时只结束本轮，外层可以决定是否重试
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal // 调用方停止和超时共享底层请求
  const provider = createOpenAICompatible({ name: 'agent', baseURL: apiURL, apiKey }) // 为当前配置创建模型供应商
  const modelTools = Object.fromEntries(Object.entries(tools ?? {}).map(([name, tool]) => [
    name,
    dynamicTool({ description: tool.description, inputSchema: jsonSchema(tool.parameters) }), // 把通用 JSON Schema 转成 SDK 工具
  ]))

  try {
    const stream = streamText({
			model: provider(model),
			system: systemPrompt,
			messages,
			tools: modelTools,
			maxRetries: 0,
			abortSignal: requestSignal,
			onError: () => {},
		})

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
    requestSignal.throwIfAborted()                       // 供应商未抛中止事件时也不能吞掉停止
		return {
			content: fullText,
			contentBlocks,
			toolCalls,
			usage,
		}
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? new DOMException('operation aborted', 'AbortError') // 用户停止保持原始中止语义
    if (timeoutSignal.aborted) throw Object.assign(new Error(`model request timed out after ${timeoutMS}ms`), { status: 408 }) // 超时提供可重试状态
    const failure = error instanceof Error ? error : Object.assign(new Error(String(error)), error) // 任意 SDK 抛出值转成 Error
    if (failure.status === undefined && failure.statusCode !== undefined) failure.status = failure.statusCode // 统一 SDK HTTP 状态字段
    if (failure.code === undefined && failure.cause?.code !== undefined) failure.code = failure.cause.code // 统一底层网络错误代码
    throw failure                                        // 调用方决定最终状态或重试
  }
}


export const LLM = { chat }                              // 导出完整单轮模型请求能力
