/*
 * 模型图标测试：模型名和供应商名要认出同一套品牌图标。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { modelIconKey } from '../src/ui/model-icon.js'

test('model brands are recognized from model ids', () => {
  assert.equal(modelIconKey('gpt-4.1'), 'openai')
  assert.equal(modelIconKey('o3-mini'), 'openai')
  assert.equal(modelIconKey('claude-sonnet-4'), 'claude')
  assert.equal(modelIconKey('gemini-2.5-pro'), 'gemini')
  assert.equal(modelIconKey('deepseek-chat'), 'deepseek')
  assert.equal(modelIconKey('qwen3-max'), 'qwen')
  assert.equal(modelIconKey('glm-flash-latest'), 'glm')
  assert.equal(modelIconKey('kimi-k2.6'), 'kimi')
  assert.equal(modelIconKey('doubao-pro'), 'doubao')
  assert.equal(modelIconKey('grok-4'), 'grok')
})

test('provider names are used when the model id is generic', () => {
  assert.equal(modelIconKey('chat', 'OpenRouter'), 'openrouter')
  assert.equal(modelIconKey('chat', 'Ollama'), 'ollama')
  assert.equal(modelIconKey('chat', '硅基流动'), 'siliconflow')
  assert.equal(modelIconKey('chat', '智谱'), 'glm')
})

test('unknown models get no brand icon', () => {
  assert.equal(modelIconKey('test-model', 'Test Provider'), '')
  assert.equal(modelIconKey(''), '')
})
