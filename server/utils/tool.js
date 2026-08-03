/* 
使用示例
注册
await Tool.scan('./tools')

const tool = Tool.execute('shell', { command: 'npm install' }, {
	onOutput(chunk) {
		SSE.emit(session, 'tool-output', { toolCallId, delta: chunk })
	}
})

等结果
const { output, isError, stop } = await tool.result

如果用户停止
tool.abort()
*/

import { readdir } from "fs/promises";
import { join } from "path";

const registry = new Map();

export const Tool = {
	async scan(folder) {
		const files = await readdir(folder);
		for (const file of files) {
			if (!file.endsWith(".js")) continue;
			const mod = await import(join(folder, file));
			const tools = Array.isArray(mod.default) ? mod.default : [mod.default];
			for (const tool of tools) {
				registry.set(tool.name, {
					definition: {
						name: tool.name,
						description: tool.description,
						parameters: tool.parameters,
					},
					execute: tool.execute,
				});
			}
		}
	},

	definitions() {
		const result = {};
		for (const [name, { definition }] of registry) {
			result[name] = {
				description: definition.description,
				parameters: definition.parameters,
			};
		}
		return result;
	},

	/**
	 * @param {string} name
	 * @param {object} input
	 * @param {object} options
	 * @param {function} options.onOutput - 流式输出回调 (chunk: string) => void
	 * @returns {{ result: Promise<{ output, isError, stop }>, abort: () => void }}
	 */
	execute(name, input, { onOutput } = {}) {
		const entry = registry.get(name);

		if (!entry) {
			return {
				result: Promise.resolve({ output: `未知工具: ${name}`, isError: true, stop: false }),
				abort() {},
			};
		}

		let output = "";
		let aborted = false;
		let reader = null;

		const result = (async () => {
			try {
				const raw = await entry.execute(input);

				if (aborted) {
					return { output: output + "\n[工具被强制终止]", isError: true, stop: false };
				}

				if (raw instanceof ReadableStream) {
					reader = raw.getReader();
					while (true) {
						if (aborted) {
							reader.cancel();
							break;
						}
						const { done, value } = await reader.read();
						if (done) break;
						const chunk = typeof value === "string" ? value : new TextDecoder().decode(value);
						output += chunk;
						onOutput?.(chunk);
					}
					if (aborted) {
						return { output: output + "\n[工具被强制终止]", isError: true, stop: false };
					}
					return { output, isError: false, stop: false };
				}

				if (typeof raw === "object" && raw !== null) {
					output = raw.output ?? "";
					onOutput?.(output);
					return { output, isError: raw.isError ?? false, stop: raw.stop ?? false };
				}

				output = String(raw ?? "");
				onOutput?.(output);
				return { output, isError: false, stop: false };
			} catch (err) {
				if (aborted) {
					return { output: output + "\n[工具被强制终止]", isError: true, stop: false };
				}
				const errMsg = `工具出错: ${err.message}`;
				onOutput?.(errMsg);
				return { output: errMsg, isError: true, stop: false };
			}
		})();

		return {
			result,
			abort() {
				aborted = true;
				reader?.cancel();
			},
		};
	},
};
