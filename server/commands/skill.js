/*
Skill 指令集：扫描 Agent Skills 规范目录，校验 SKILL.md，并提供按需加载工具。
启动只把名称和描述加入模型上下文；完整正文由 load_skill 触发后反馈，实现渐进披露。
调用示例：await Skill.reload()、Skill.catalogPrompt()、Skill.list()。
*/
import { readdir, readFile } from 'node:fs/promises'                  // 引入技能目录扫描和正文读取能力
import { basename, join, resolve } from 'node:path'                   // 引入目录名称校验和绝对路径定位
import { parseDocument } from 'yaml'                                  // 引入标准 YAML frontmatter 解析能力
import { Config } from './config.js'                                  // 引入技能开关和附加目录配置
import { capabilityStore } from '../store/capabilities.js'            // 引入技能元数据运行仓库
import { toolStore } from '../store/tools.js'                          // 引入按需加载工具注册表

const skillNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/                 // 官方名称只允许小写字母、数字和单连字符


// --- 读取一个 Skill 目录 ---
async function readSkill(directory) {
  const filePath = join(directory, 'SKILL.md')                         // 规范要求入口文件使用固定名称
  const source = await readFile(filePath, 'utf8')                      // 读取完整文件供 frontmatter 与后续加载共用
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/) // 只接受顶部 YAML frontmatter
  if (!match) throw new Error('SKILL.md 缺少有效 YAML frontmatter')    // 无元数据无法进入渐进披露目录
  const document = parseDocument(match[1])                             // 使用 YAML 解析器处理引号和嵌套 metadata
  if (document.errors.length) throw new Error(document.errors[0].message) // YAML 语法错误原位反馈
  const metadata = document.toJS() || {}                               // 将 YAML 映射转成普通数据
  if (!skillNamePattern.test(metadata.name || '')) throw new Error('name 必须使用小写字母、数字和单连字符') // 执行官方命名约束
  if (metadata.name !== basename(directory)) throw new Error('name 必须与父目录名称一致') // 防止目录引用产生歧义
  if (!metadata.description || metadata.description.length > 1024) throw new Error('description 必须为 1-1024 个字符') // 描述承担自动选择信号
  if (metadata.name.length > 64) throw new Error('name 不能超过 64 个字符') // 执行规范长度限制
  return { ...metadata, name: metadata.name, description: metadata.description, directory, filePath, body: match[2].trim(), source } // 保存完整来源供加载
}


// --- 扫描一个技能根目录 ---
async function scanDirectory(rootDirectory) {
  try {
    const entries = await readdir(rootDirectory, { withFileTypes: true }) // 每个直接子目录代表一个独立 Skill
    return entries.filter((entry) => entry.isDirectory()).map((entry) => join(rootDirectory, entry.name)) // 深层资源由 Skill 自己引用
  } catch (error) {
    if (error.code === 'ENOENT') return []                              // 可选目录不存在按空目录处理
    throw error                                                         // 权限等真实错误需要反馈
  }
}


// --- 注册按需加载 Skill 工具 ---
function registerLoader() {
  toolStore.items.set('load_skill', {
    name: 'load_skill',                                                   // 模型使用稳定名称激活技能
    label: '加载技能',                                                     // 对话流展示人类化动作
    description: '按名称加载一个 Agent Skill 的完整操作指令。仅当任务符合技能描述时调用。', // 明确渐进披露触发条件
    parameters: { name: { type: 'string', required: true, description: '技能目录中的 name' } }, // 只允许指定已发现名称
    source: 'skills',                                                      // 工具中心区分本地技能能力
    kind: 'skill',                                                         // 对话 UI 使用技能身份
    async execute({ name }) {
      const skill = capabilityStore.skills.get(name)                       // 从最新扫描结果读取技能
      if (!skill || !skill.enabled) throw new Error(`Skill 不存在或已禁用: ${name}`) // 名称错误或禁用状态都不能读取正文
      const resources = (await readdir(skill.directory, { withFileTypes: true })).filter((entry) => entry.name !== 'SKILL.md').map((entry) => entry.name) // 只披露可按需读取的一级资源
      return { name: skill.name, directory: skill.directory, instructions: skill.body, resources } // 将完整正文反馈给当前模型轮次
    },
  })
}


// --- 重载全部 Skill ---
async function reload() {
  capabilityStore.skills.clear()                                         // 新扫描快照替换旧元数据
  capabilityStore.skillErrors = []                                       // 清除已经修复的校验错误
  registerLoader()                                                        // 即使没有 Skill 也保留明确加载入口
  const settings = Config.get().skills || {}                              // 读取开关、禁用清单和附加目录
  if (settings.enabled === false) return { ok: true, skills: [] }          // 全局关闭时不扫描磁盘
  const extraDirectories = (settings.directories || []).flat(Infinity).filter((directory) => typeof directory === 'string' && directory.trim()) // defu 旧数组可能形成多层嵌套，先恢复可用路径列表
  const roots = [join(capabilityStore.dataDirectory, 'skills'), join(capabilityStore.workspaceDirectory, '.agent', 'skills'), ...extraDirectories].map((directory) => resolve(directory)) // 用户、项目和自定义目录按后者覆盖前者
  const directories = (await Promise.all(roots.map(scanDirectory))).flat() // 并行读取所有根目录
  for (const directory of directories) {
    try {
      const skill = await readSkill(directory)                            // 校验单个 Skill，不让坏目录阻断其他技能
      skill.enabled = !(settings.disabled || []).includes(skill.name)      // 禁用状态属于配置而不是目录有效性
      capabilityStore.skills.set(skill.name, skill)                        // 能力中心同时展示启用和禁用 Skill
    } catch (error) {
      capabilityStore.skillErrors.push({ directory, error: error.message }) // 能力中心展示具体无效目录
    }
  }
  return { ok: true, skills: list(), errors: capabilityStore.skillErrors } // 反馈真实扫描结果
}


// --- 创建模型常驻技能目录 ---
function catalogPrompt() {
  if (!capabilityStore.skills.size) return ''                            // 无技能时不占用系统上下文
  const catalog = [...capabilityStore.skills.values()].filter((skill) => skill.enabled).map((skill) => `- ${skill.name}: ${skill.description}`).join('\n') // 只保留启用 Skill 的发现元数据
  if (!catalog) return ''                                                  // 全部禁用时不注入空目录说明
  return `可用 Agent Skills：\n${catalog}\n当用户任务明确符合某项描述时，先调用 load_skill 获取完整指令，再按该指令工作。不要为无关任务加载技能。` // 告诉模型何时进入第二层披露
}


// --- 列出已发现 Skill ---
function list() {
  return [...capabilityStore.skills.values()].map(({ name, description, directory, license, compatibility, metadata, enabled }) => ({ name, description, directory, license: license || '', compatibility: compatibility || '', metadata: metadata || {}, enabled })) // API 不返回完整正文，保持渐进披露
}


export const Skill = { reload, list, catalogPrompt }                       // 导出扫描、目录提示和状态读取动作
