// 流式聊天错误类型 + 友好文案翻译。

export class StreamError extends Error {
  // OpenAI SDK 的 error.code（'invalid_api_key' 等）或 HTTP status 字符串（'401' 等）。
  code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.name = "StreamError"
    this.code = code
  }
}

export interface ExplainedError {
  title: string
  hint?: string
}

export function explainError(err: unknown): ExplainedError {
  if (err instanceof StreamError) {
    const { code, message } = err

    // 401 / Key：兼认 status 与 message 关键词，不同 provider 文案不同。
    if (code === "401" || /invalid[_ ]api[_ ]key|incorrect api key|unauthor/i.test(message)) {
      return {
        title: "API Key 无效",
        hint: "请打开「设置」检查 Key 是否正确，或确认账号是否已开通模型访问权限。",
      }
    }

    // 403：模型未开通 / 实名 / IP 受限（DeepSeek、Moonshot 等常见）。
    if (code === "403" || /forbidden|permission[_ ]denied|not[_ ]allowed/i.test(message)) {
      return {
        title: "无访问权限",
        hint: "账号可能未开通该模型，或来源 IP / 实名认证受限。",
      }
    }

    // 429：限流。
    if (code === "429" || /rate[_ ]limit/i.test(message)) {
      return {
        title: "请求过于频繁",
        hint: "稍等一会儿再试。",
      }
    }
    // insufficient_quota / insufficient balance：各家 status 可能 402/429/403，按关键词判更准。
    if (/insufficient[_ ]?(quota|balance)|exceeded.*quota|billing|payment[_ ]required/i.test(message)) {
      return {
        title: "额度或余额已用完",
        hint: "请检查账户余额、配额或订阅状态。",
      }
    }

    // 400：请求体不合法，常见 model 拼错 / 参数越界。
    if (code === "400" || /model.*not[_ ]found|invalid.*model/i.test(message)) {
      return {
        title: "模型或参数不正确",
        hint: "确认 Model 名拼写，或换一个该 provider 支持的模型。",
      }
    }

    if (code && /^5\d{2}$/.test(code)) {
      return {
        title: "上游服务异常",
        hint: "AI 服务商暂时不可用，过会儿重试。",
      }
    }

    return {
      title: "请求失败",
      hint: message,
    }
  }

  // fetch 在网络断开 / DNS 失败 / CORS 拒绝时抛 TypeError，没有 status。
  if (err instanceof TypeError) {
    return {
      title: "网络连接失败",
      hint: "检查网络后重试。",
    }
  }

  // AbortError 正常路径已被 hook 单独处理，这里只是兜底。
  if (err instanceof DOMException && err.name === "AbortError") {
    return { title: "请求已取消" }
  }

  if (err instanceof Error) {
    return { title: err.message || "未知错误" }
  }

  return { title: "未知错误" }
}
