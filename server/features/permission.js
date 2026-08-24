/* 
目标被调用形式（绝对不可修改）：
// 1. 加载规则
await Permission.load({
    path: "/path/to/permission.json",
})

// 2. 检查权限，先走规则表，如果是ask就向前端发请求，得到是批准还是拒绝
const result = await Permission.check({
    toolName: "edit",              // 工具名
    arguments: {                   // 工具参数，用于匹配
        path: "src/index.js",
    },
})
// result = true | false

// 3. 保存规则
await Permission.save({
    path: "/path/to/permission.json",
})
 */