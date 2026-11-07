/*
文件系统浏览指令：路径选择器只通过这里读服务端目录，不直接暴露 fs 到前端。
*/
import Filesystem from '../features/filesystem.js'

const entries = query => Filesystem.entries({
    path: query?.path,
    mode: query?.mode,
})

export default { entries }
