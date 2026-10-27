/*
 * 模型品牌图标的原始 SVG：集中在这里，组件只拿最终字符串。
 * 图标来自 LobeHub Icons（MIT），来源和许可见 assets/model-icons/README.md。
 */
import openai from '../assets/model-icons/openai.svg?raw'
import claude from '../assets/model-icons/claude-color.svg?raw'
import gemini from '../assets/model-icons/gemini-color.svg?raw'
import deepseek from '../assets/model-icons/deepseek-color.svg?raw'
import qwen from '../assets/model-icons/qwen-color.svg?raw'
import glm from '../assets/model-icons/zhipu-color.svg?raw'
import kimi from '../assets/model-icons/kimi-color.svg?raw'
import doubao from '../assets/model-icons/doubao-color.svg?raw'
import mistral from '../assets/model-icons/mistral-color.svg?raw'
import meta from '../assets/model-icons/meta-color.svg?raw'
import gemma from '../assets/model-icons/gemma-color.svg?raw'
import grok from '../assets/model-icons/grok.svg?raw'
import openrouter from '../assets/model-icons/openrouter.svg?raw'
import ollama from '../assets/model-icons/ollama.svg?raw'
import minimax from '../assets/model-icons/minimax-color.svg?raw'
import hunyuan from '../assets/model-icons/hunyuan-color.svg?raw'
import stepfun from '../assets/model-icons/stepfun-color.svg?raw'
import cohere from '../assets/model-icons/cohere-color.svg?raw'
import perplexity from '../assets/model-icons/perplexity-color.svg?raw'
import nvidia from '../assets/model-icons/nvidia-color.svg?raw'
import anthropic from '../assets/model-icons/anthropic.svg?raw'
import longcat from '../assets/model-icons/longcat-color.svg?raw'
import mimo from '../assets/model-icons/xiaomimimo.svg?raw'
import siliconflow from '../assets/model-icons/siliconflow.svg?raw'
import { modelIconKey } from './model-icon.js'

export const MODEL_ICONS = {
  openai,
  claude,
  gemini,
  deepseek,
  qwen,
  glm,
  kimi,
  doubao,
  mistral,
  meta,
  gemma,
  grok,
  openrouter,
  ollama,
  minimax,
  hunyuan,
  stepfun,
  cohere,
  perplexity,
  nvidia,
  anthropic,
  longcat,
  mimo,
  siliconflow,
}

export function modelIconSvg(model = '', provider = '') {
  return MODEL_ICONS[modelIconKey(model, provider)] || ''
}
