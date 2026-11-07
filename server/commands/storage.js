/*
存储目录指令：会话数据目录的查询、待迁移设置和取消。
真正的复制在下次启动时由 features/storage.js 完成，避免运行中读写同一个目录。
*/
import Storage from '../features/storage.js'

const status = () => Storage.status()
const setPath = body => Storage.setPath(body?.path)
const cancel = () => Storage.cancel()

export default { status, setPath, cancel }
