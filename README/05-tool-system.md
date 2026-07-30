# 工具系统设计

## 设计原则

- 内置工具和自定义工具使用完全相同的格式和加载机制
- 一个文件 = 一组同类工具（如 file.js 包含所有文件操作工具）
- 用户可以用纯 JavaScript 编写工具，无需学习任何框架 API
- 工具文件自动扫描加载，新增/修改后热重载
- LLM 可以编写工具文件供后续使用
- 工具可以自由导入 npm 包

## 工具文件目录

```
~/.agent/
├── tools/
│   ├── built-in/          # 内置工具集（随程序分发）
│   │   ├── file.js        # 文件操作：read_file, write_file, list_files, search_files
│   │   ├── shell.js       # 命令执行：run_command
│   │   ├── web.js         # 网络操作：web_fetch
│   │   └── agent.js       # Agent 控制：task_done
│   └── custom/            # 用户/LLM 编写的自定义工具集
│       ├── search.js      # 搜索工具：search_web, search_docs
│       └── server.js      # 服务器管理：deploy, check_status, view_logs
├── package.json           # 工具依赖管理
└── node_modules/          # 工具使用的第三方库
```

## 工具定义格式

每个 .js 文件导出多个同类工具，每个 export 就是一个工具：

```javascript
// tools/built-in/file.js
// 文件操作工具集：读取、写入、列出、搜索文件

import { readFile, writeFile, readdir } from 'fs/promises'
import { join } from 'path'

export const read_file = {
  description: '读取指定路径的文件内容。用于查看代码、配置文件等。',
  parameters: {
    path: { type: 'string', description: '文件路径', required: true },
    encoding: { type: 'string', description: '编码格式', default: 'utf-8' }
  },
  async execute({ path, encoding = 'utf-8' }) {
    const content = await readFile(path, encoding)
    return { result: content }
  }
}

export const write_file = {
  description: '将内容写入文件。如果文件不存在则创建，存在则覆盖。',
  parameters: {
    path: { type: 'string', description: '文件路径', required: true },
    content: { type: 'string', description: '要写入的内容', required: true }
  },
  async execute({ path, content }) {
    await writeFile(path, content, 'utf-8')
    return { result: `文件已写入: ${path}` }
  }
}

export const list_files = {
  description: '列出目录下的文件和子目录。',
  parameters: {
    path: { type: 'string', description: '目录路径', required: true }
  },
  async execute({ path }) {
    const entries = await readdir(path, { withFileTypes: true })
    const list = entries.map(e => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`)
    return { result: list.join('\n') }
  }
}
```

```javascript
// tools/built-in/agent.js
// Agent 控制工具集：结束循环

export const task_done = {
  description: '当你认为任务已经全部完成时调用此工具。调用后对话循环将结束。',
  parameters: {
    summary: { type: 'string', description: '对本次任务完成情况的简短总结', required: true }
  },
  async execute({ summary }) {
    return { result: summary, stop: true }
  }
}
```

```javascript
// tools/custom/search.js
// 搜索工具集：网页搜索、文档搜索
import axios from 'axios'

export const search_web = {
  description: '搜索互联网，获取最新信息。当用户问及实时数据或你不确定的事实时使用。',
  parameters: {
    query: { type: 'string', description: '搜索关键词', required: true },
    limit: { type: 'number', description: '返回结果数量', default: 5 }
  },
  async execute({ query, limit = 5 }) {
    const { data } = await axios.get(`https://api.search.com/search?q=${query}&count=${limit}`)
    return { result: data.results.map(r => `${r.title}\n${r.url}`).join('\n\n') }
  }
}

export const search_docs = {
  description: '在项目文档中搜索关键词。',
  parameters: {
    keyword: { type: 'string', description: '搜索关键词', required: true }
  },
  async execute({ keyword }) {
    // ...
    return { result: '...' }
  }
}
```

## 返回值格式

工具 execute 函数返回一个对象：

```javascript
// 普通返回（循环继续）
return { result: '文件内容...' }

// 带 stop 字段（循环终止）
return { result: '任务已完成', stop: true }
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| result | string | 是 | 工具执行结果，传递给 LLM |
| stop | boolean | 否 | 为 true 时终止 Agent 循环 |

## 参数类型

parameters 中支持的 type 值：

| type | 说明 | 示例 |
|------|------|------|
| `string` | 字符串 | 文件路径、搜索关键词 |
| `number` | 数字 | 数量、端口号 |
| `boolean` | 布尔 | 开关标志 |
| `array` | 数组 | 文件列表 |
| `object` | 对象 | 复杂结构参数 |

每个参数可选字段：

| 字段 | 说明 |
|------|------|
| type | 参数类型（必填） |
| description | 参数含义描述（必填） |
| required | 是否必填（默认 false） |
| default | 默认值 |
| enum | 可选值列表 |

## 工具加载机制

### 加载逻辑

加载器扫描目录中的所有 .js 文件，对每个文件遍历所有命名导出（named exports），每个导出注册为一个独立工具：

```javascript
const mod = await import(filePath)
for (const [exportName, tool] of Object.entries(mod)) {
  if (exportName === 'default') continue          // 跳过 default export
  if (!tool.description || !tool.execute) continue // 跳过非工具导出
  registry.set(exportName, { ...tool, source: filePath })
}
```

### 启动时加载

Agent Server 启动时扫描 `tools/built-in/` 和 `tools/custom/` 目录，加载所有 .js 文件中的全部工具。

### 热重载

使用文件监听器（chokidar）监控工具目录：

- 新增 .js 文件 → 加载该文件中的所有工具
- 修改 .js 文件 → 卸载该文件旧的工具，重新加载
- 删除 .js 文件 → 从注册表移除该文件注册的所有工具

### LLM 编写工具

流程：
1. LLM 调用内置 `write_file` 工具 → 写入 `tools/custom/xxx.js`
2. 文件监听器检测到新文件 → 自动加载该文件中的所有工具
3. 下一轮循环 LLM 即可使用新工具

无需用户确认。

## 依赖管理

工具目录下有一个 `package.json`，用户可以安装第三方包：

```bash
cd ~/.agent && bun add axios cheerio
```

工具文件可以直接 `import` 这些包（见上方 search.js 示例）。

## 工具加载错误处理

单个文件加载失败不影响其他文件。错误信息记录到日志，可通过 `/tool/reload` 响应查看：

```json
{
  "ok": true,
  "loaded": 12,
  "files": 5,
  "errors": [
    { "file": "broken.js", "error": "SyntaxError: Unexpected token" }
  ]
}
```
