/* 用户配置读取和原子保存。 */
import { deepmergeCustom } from 'deepmerge-ts'
import Store from '../store.js'

const merge = deepmergeCustom({ mergeArrays: values => values.at(-1) })
const read = () => structuredClone(Store.config)
const save = async patch => {
    Store.config = merge(Store.config, typeof patch === 'function' ? patch(Store.config) : patch)
    await Store.save('config')
    return read()
}

export default { read, save }
