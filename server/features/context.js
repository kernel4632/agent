/*
上下文构建功能：

有摘要时拼接：
[开头 3 条] + [摘要前 3 条] + [摘要] + [摘要后全部]

调用：
const [built, tokens] = Context.build(messages);
*/

import Tokenizer from "ai-tokenizer";
import * as o200kBase from "ai-tokenizer/encoding/o200k_base";

// 只把 o200k_base 当作通用估算尺子。
// 不关心用户实际使用什么模型，也不读取 modelId。
const tokenizer = new Tokenizer(o200kBase);

function build(messages) {
	let summaryIndex = -1;

	// 从末尾往前找最近的一条摘要。
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].summary) {
			summaryIndex = i;
			break;
		}
	}

	let view = messages;

	if (summaryIndex !== -1) {
		view = [
			...messages.slice(0, Math.min(3, summaryIndex)),
			...messages.slice(Math.max(3, summaryIndex - 3), summaryIndex),
			messages[summaryIndex],
			...messages.slice(summaryIndex + 1),
		];
	}

	// 删除你自己添加的字段，保留 AI SDK message 的其他字段。
	const built = view.map(({ summary, usage, ...message }) => message);

	// 对最终构建出来的标准 messages 统一估算 token。
	const tokens = tokenizer.count(JSON.stringify(built));

	return [built, tokens];
}

export const Context = { build };
