# 工具系统设计

## 设计原则

- 内置工具和自定义工具使用完全相同的格式和加载机制
- 用户可以用纯 JavaScript 编写工具，无需学习任何框架 API
- 工具文件自动扫描加载，新增/修改后热重载
- LLM 可以编写工具文件供后续使用
- 工具可以自由导入 npm 包

## 工具文件目录

```
~/.agent/
├── tools/
│   ├── built-in/          # 内置工具（随程序分发）
│   │   ├── read-file.js
│   │   ├── write-file.js
│   │   ├── run-command.js
│   │   ├── list-files.js
│   │   ├── search-files.js
│   │   ├── web-fetch.js
│   │   └── task-done.js
│   └── custom/            # 用户/LLM 编写的自定义工具
│       ├── search-web.js
│       └── deploy-server.js
├── package.json           # 工具依赖管理
└── node_modules/          # 工具使用的第三方库
```

## 工具定义格式

每个 .js 文件导出以下字段：

```javascript
// 工具名：LLM 用这个名字来调用
export const name = 'web_search'

// 描述：告诉 LLM 这个工具能做什么、什么时候该用
export const description = '搜索互联网，获取最新信息。当用户问及实时数据或你不确定的事实时使用。'

// 参数定义：每个参数说清楚类型、含义、是否必填
export const parameters = {
  query: {
    type: 'string',
    description: '搜索关键词',
    required: true
  },
  limit: {
    type: 'number',
    description: '返回结果数量',
    default: 5
  }
}

// 执行函数：接收参数对象，返回结果
export async function execute({ query, limit = 5 }) {
  const response = await fetch(`https://api.search.com/search?q=${query}&count=${limit}`)
  const data = await response.json()
  return {
    result: data.results.map(r => `${r.title}\n${r.url}\n${r.snippet}`).join('\n\n')
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

| 字段     | 类型      | 必填 | 说明                  |
| ------ | ------- | -- | ------------------- |
| result | string  | 是  | 工具执行结果，传递给 LLM      |
| stop   | boolean | 否  | 为 true 时终止 Agent 循环 |

## 内置 task\_done 工具

专门用于让 LLM 主动结束循环的内置工具：

```javascript
export const name = 'task_done'

export const description = '当你认为任务已经全部完成时调用此工具。调用后对话循环将结束。必须在任务完成时调用。'

export const parameters = {
  summary: {
    type: 'string',
    description: '对本次任务完成情况的简短总结',
    required: true
  }
}

export async function execute({ summary }) {
  return { result: summary, stop: true }
}
```

## 参数类型

parameters 中支持的 type 值：

| type      | 说明  | 示例         |
| --------- | --- | ---------- |
| `string`  | 字符串 | 文件路径、搜索关键词 |
| `number`  | 数字  | 数量、端口号     |
| `boolean` | 布尔  | 开关标志       |
| `array`   | 数组  | 文件列表       |
| `object`  | 对象  | 复杂结构参数     |

每个参数可选字段：

| 字段          | 说明             |
| ----------- | -------------- |
| type        | 参数类型（必填）       |
| description | 参数含义描述（必填）     |
| required    | 是否必填（默认 false） |
| default     | 默认值            |
| enum        | 可选值列表          |

## 工具加载机制

### 启动时加载

Agent Server 启动时扫描 `tools/built-in/` 和 `tools/custom/` 目录，加载所有 .js 文件。

### 热重载

使用文件监听器（chokidar）监控工具目录：

- 新增 .js 文件 → 自动加载并注册
- 修改 .js 文件 → 重新加载该工具
- 删除 .js 文件 → 从注册表移除

### LLM 编写工具

流程：

1. LLM 调用内置 `file_write` 工具 → 写入 `tools/custom/xxx.js`
2. 文件监听器检测到新文件 → 自动加载注册
3. 下一轮循环 LLM 即可使用新工具

无需用户确认。

## 依赖管理

工具目录下有一个 `package.json`，用户可以安装第三方包：

```bash
cd ~/.agent && bun add axios cheerio
```

工具文件可以直接 `import` 这些包：

```javascript
import axios from 'axios'
import * as cheerio from 'cheerio'

export async function execute({ url }) {
  const { data } = await axios.get(url)
  const $ = cheerio.load(data)
  return { result: $('title').text() }
}
```

## 工具加载错误处理

加载失败的工具不会阻止其他工具注册。错误信息记录到日志，可通过 `/tool/reload` 响应查看：

```json
{
  "ok": true,
  "loaded": 7,
  "errors": [
    { "file": "broken-tool.js", "error": "SyntaxError: Unexpected token" }
  ]
}
```

