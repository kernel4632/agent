/* 用户配置读取和原子保存，数组补丁直接替换旧数组。 */
import { deepmergeCustom } from 'deepmerge-ts'
import Store from '../store.js'

const mergeConfig = deepmergeCustom({
    mergeArrays: values => values.at(-1),
})

const read = () => {
    return structuredClone(Store.config)
}

const save = async patch => {
    Store.config = mergeConfig(Store.config, patch)
    await Store.save('config')
    return read()
}

export default { read, save }
