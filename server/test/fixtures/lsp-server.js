/* LSP 测试服务：完成标准生命周期并提供诊断、定义、引用和悬停结果。 */
import { createMessageConnection } from 'vscode-jsonrpc/node'          // 引入官方 JSON-RPC Content-Length 实现

const connection = createMessageConnection(process.stdin, process.stdout) // 将子进程 stdio 作为 LSP 传输
const documents = new Map()                                             // 保存客户端打开的真实文档文本

connection.onRequest('initialize', () => ({ capabilities: { textDocumentSync: 1, definitionProvider: true, referencesProvider: true, hoverProvider: true } })) // 声明测试能力
connection.onNotification('initialized', () => {})                      // 接受标准初始化完成通知
connection.onNotification('textDocument/didOpen', ({ textDocument }) => {
  documents.set(textDocument.uri, textDocument.text)                     // 保存客户端同步文本
  const diagnostics = textDocument.text.includes('BROKEN') ? [{ severity: 1, source: 'fixture-lsp', message: '真实 LSP 诊断', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } } }] : [] // 根据真实内容产生诊断
  connection.sendNotification('textDocument/publishDiagnostics', { uri: textDocument.uri, diagnostics }) // 异步发布诊断
})
connection.onNotification('textDocument/didChange', ({ textDocument, contentChanges }) => documents.set(textDocument.uri, contentChanges.at(-1)?.text || '')) // 接受 full sync
connection.onRequest('textDocument/definition', ({ textDocument }) => ({ uri: textDocument.uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } } })) // 返回同文件定义
connection.onRequest('textDocument/references', ({ textDocument }) => [{ uri: textDocument.uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } } }]) // 返回同文件引用
connection.onRequest('textDocument/hover', () => ({ contents: { kind: 'markdown', value: '`fixtureSymbol: string`' } })) // 返回真实 MarkupContent
connection.onRequest('shutdown', () => null)                            // 完成标准关闭请求
connection.onNotification('exit', () => process.exit(0))                // 收到 exit 后退出子进程
connection.listen()                                                      // 开始处理 JSON-RPC 消息
