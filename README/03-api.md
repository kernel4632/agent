# API 结构

```text
API
        /config
                GET
                        获取所有配置
                PATCH
                        修改配置
        /workspace
                GET
                        获取工作区列表或单个工作区
                        workspaceId 可选
                POST
                        添加工作区
                        name、path
                PATCH
                        修改工作区名称或路径
                        workspaceId、需要修改的字段
                DELETE
                        从工作区列表移除工作区
                        workspaceId
                        不删除本地目录内容
        /session
                GET
                        获取 Session 列表或单个 Session
                        sessionId、workspaceId 均可选
                        sessionId 存在时返回完整 Session
                        workspaceId 存在时返回该工作区的 Session
                        都不提供时返回全部 Session 摘要
                POST
                        创建 Session
                        title、workspaceId
                        模型、系统提示词和权限从全局默认配置初始化
                PATCH
                        重命名 Session
                        切换模型
                        修改系统提示词、权限、工作区或任务
                        sessionId、需要修改的 Session 字段
                DELETE
                        删除 Session
                        sessionId
                /chat
                        POST
                                发送用户消息并启动执行
                                sessionId、content、messageId、files
                                files 可选，使用 multipart/form-data
                                返回 runId，实时内容通过 Session SSE 接收
                /stop
                        POST
                                停止 Session 当前执行
                                sessionId
                                自动停止该执行产生的内部子任务和工具等待
                /events
                        GET
                                订阅 Session 的 SSE 事件
                                sessionId、after 可选
                                返回文本、推理、工具、审批、任务、usage、上下文和执行状态
                                after 用于断线续传
                /approval
                        POST
                                处理工具权限请求
                                sessionId、toolCallId、decision
                                decision：deny、allow-once、always-allow
                /history
                        POST
                                回退工具步骤、回退用户消息或撤销最近一次回退
                                sessionId、action、对应目标
                                action：rollback-checkpoint、rollback-message、undo
                                rollback-checkpoint 提供 checkpoint
                                rollback-message 提供 messageId
```
