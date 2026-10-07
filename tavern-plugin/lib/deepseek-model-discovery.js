// 为「设置 → 模型」里的 DeepSeek 提供方（llm-deepseek）补上“获取模型列表”：宿主只给自定义提供方注册了模型发现。
const SETTINGS_NS = 'llm-deepseek'
const DEFAULT_KEY_REF = 'DEEPSEEK_API_KEY'
const DEFAULT_BASE_URL = 'https://api.deepseek.com'
const MAX_BYTES = 2 * 1024 * 1024
const TIMEOUT_MS = 15000

function capacity(...values) {
  for (const value of values) if (Number.isInteger(value) && value > 0) return value
  return undefined
}

function label(...values) {
  for (const value of values) if (typeof value === 'string' && value.trim()) return value.trim()
  return undefined
}

/** 从 OpenAI 风格（data 数组）或 models 映射的列表中取出模型，保留服务端给出的名称和容量。 */
export function readModelListing(body) {
  const data = body?.data
  let entries
  if (Array.isArray(data)) entries = data.map(raw => ({ raw }))
  else if (body?.models && typeof body.models === 'object' && !Array.isArray(body.models)) entries = Object.entries(body.models).map(([key, raw]) => ({ key, raw }))
  else if (Array.isArray(body?.models)) entries = body.models.map(raw => ({ raw }))
  else throw new Error('服务返回的模型列表格式无法识别，请手动填写模型')
  const seen = new Set()
  const models = []
  for (const { key, raw } of entries) {
    const entry = raw !== null && typeof raw === 'object' ? raw : {}
    const id = label(key, entry.id, typeof raw === 'string' ? raw : undefined)
    if (!id || seen.has(id)) continue
    seen.add(id)
    const contextWindow = capacity(entry.contextWindow, entry.context_window, entry.context_length, entry.max_input_tokens)
    const maxTokens = capacity(entry.maxOutputTokens, entry.max_output_tokens, entry.maxTokens, entry.max_tokens)
    models.push({ id, name: label(entry.name, entry.display_name, entry.displayName) || id, ...(contextWindow ? { contextWindow } : {}), ...(maxTokens ? { maxTokens } : {}) })
  }
  return models
}

/** 依次尝试 {地址}/models 和 {地址}/v1/models；地址末尾已有 /v1 时不重复追加。 */
export function modelListingUrls(baseURL) {
  const base = String(baseURL || '').trim().replace(/\/+$/u, '')
  const urls = [base + '/models']
  if (!/\/v\d+$/u.test(base)) urls.push(base + '/v1/models')
  return urls
}

async function readBounded(response) {
  const text = await response.text()
  if (text.length > MAX_BYTES) throw new Error('模型列表过大，请手动填写模型')
  return text
}

export async function discoverDeepSeekModels(request, { resolveApiKey, fetchImpl = fetch } = {}) {
  const baseURL = String(request.baseURL || '').trim() || DEFAULT_BASE_URL
  let url
  try { url = new URL(baseURL) } catch { throw new Error('API 地址不是有效网址') }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('API 地址必须以 http:// 或 https:// 开头')
  const apiKey = (request.apiKey || await resolveApiKey?.() || '').trim()
  const headers = { accept: 'application/json', ...(apiKey ? { authorization: 'Bearer ' + apiKey } : {}) }
  let failure = '服务没有返回模型列表，请手动填写模型'
  for (const target of modelListingUrls(baseURL)) {
    let response
    try {
      response = await fetchImpl(target, { method: 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch {
      throw new Error('连接失败，请检查 API 地址和网络')
    }
    if ([401, 403].includes(response.status)) throw new Error('服务拒绝了请求（HTTP ' + response.status + '），请检查 API 密钥')
    if (response.status === 404) { failure = '服务没有提供模型列表（HTTP 404），请手动填写模型'; continue }
    if (!response.ok) throw new Error('获取模型列表失败（HTTP ' + response.status + '）')
    let body
    try { body = JSON.parse(await readBounded(response)) } catch (error) {
      if (error.message.includes('过大')) throw error
      throw new Error('服务没有返回有效的模型列表，请手动填写模型')
    }
    return readModelListing(body)
  }
  throw new Error(failure)
}

export function registerDeepSeekModelDiscovery(ctx) {
  const llm = ctx.get('llm')
  if (typeof llm?.registerModelDiscovery !== 'function') return
  ctx.effect(() => llm.registerModelDiscovery(SETTINGS_NS, request => discoverDeepSeekModels(request, {
    resolveApiKey: async () => (await ctx.get('credentials')?.resolve(DEFAULT_KEY_REF))?.value,
  })), 'dsh-tavern: deepseek model discovery')
}
