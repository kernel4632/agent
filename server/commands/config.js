/* 用户配置读取和原子保存，数组补丁直接替换旧数组。 */
import { deepmergeCustom } from 'deepmerge-ts' // 使用成熟库合并嵌套配置。
import Store from '../store.js' // 读取和保存唯一的配置真相。

const mergeConfig = deepmergeCustom({ // 数组配置由最新提交完整替换。
    mergeArrays: values => values.at(-1), // 避免权限、模型列表被意外拼接。
})

const read = () => {
    return structuredClone(Store.config) // 调用方不能改写内存中的原始配置。
}

const save = async patch => {
    Store.config = mergeConfig(Store.config, patch) // 只覆盖请求明确提供的配置项。
    await Store.save('config') // 先把新配置安全落盘。
    return read() // 返回隔离副本给 HTTP 调用方。
}

export default { read, save } // 暴露配置读取和更新入口。
