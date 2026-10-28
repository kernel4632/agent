/*
 * 工具目录指令：给设置页列出全部工具、类别和当前权限动作。
 *
 * 工具清单来自 tools/ 的扫描结果，不维护第二份名单；加一个工具只放一个文件。
 * 调用示例：
 *   const tools = await Tool.list()
 *   const kinds = Tool.kinds()
 */

import Tool from '../features/tool.js'

const list = () => Tool.list()
const kinds = () => Tool.KINDS

export default { list, kinds }
