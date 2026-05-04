// 流式聊天的错误类型 + 友好文案翻译。
//
// 为什么需要专门的 StreamError：
//   普通 Error 只有 message——但 401（Key 错）和 429（限流）需要给用户**不同**的引导：
//     401 → "去设置改 Key"
//     429 → "等会儿再试 / 检查额度"
//   把 code 带在 error 上，hook 层就能基于 code 做分支决策。
//
// 为什么 explainError 单独抽出来：
//   "把错误翻成给人看的文案"是纯函数，不依赖 React/store，易测；
//   而且未来 toast / 红条 / 错误弹窗复用同一份翻译逻辑——一处改全场生效。

export class StreamError extends Error {
  // OpenAI SDK 的 error.code（'invalid_api_key' / 'rate_limit_exceeded' …）
  // 或 HTTP status（'401' / '429' / '500'）的字符串形式。
  // 同时支持两种来源——前端按字符串包含 / 等值匹配判断即可。
  code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.name = "StreamError"
    this.code = code
  }
}

// 给用户看的友好文案。
//   title  ── toast 主文案，一句话告诉"出了什么"
//   hint   ── 可选副标题，告诉"该怎么办"。比如让用户去检查 API Key
export interface ExplainedError {
  title: string
  hint?: string
}

// 翻译函数。覆盖：
//   - StreamError（带 code）：根据 code / message 关键词分支
//   - TypeError（fetch 失败）：网络错
//   - 普通 Error：直接用 message
//   - unknown：兜底
export function explainError(err: unknown): ExplainedError {
  if (err instanceof StreamError) {
    const { code, message } = err

    // 401 / Key 相关：常见且需要明确指引。
    // 同时认 code === '401' 和 message 里含 'api key' 等关键词——
    // 不同 provider 报错文案不同，多一道"包含"判断不亏。
    if (code === "401" || /invalid[_ ]api[_ ]key|incorrect api key|unauthor/i.test(message)) {
      return {
        title: "API Key 无效",
        hint: "请打开「设置」检查 Key 是否正确，或确认账号是否已开通模型访问权限。",
      }
    }

    // 403：权限相关。OpenAI 较少回 403，但 DeepSeek / Moonshot / Anthropic 兼容端
    // 在"模型未开通 / 账号未实名 / 来源 IP 受限"等场景会回 403。
    if (code === "403" || /forbidden|permission[_ ]denied|not[_ ]allowed/i.test(message)) {
      return {
        title: "无访问权限",
        hint: "账号可能未开通该模型，或来源 IP / 实名认证受限。",
      }
    }

    // 429：限流 or 余额耗尽。OpenAI 用 'rate_limit_exceeded' / 'insufficient_quota' 区分。
    if (code === "429" || /rate[_ ]limit/i.test(message)) {
      return {
        title: "请求过于频繁",
        hint: "稍等一会儿再试。",
      }
    }
    // 余额/额度耗尽——OpenAI 用 insufficient_quota / billing；DeepSeek 用 insufficient balance。
    // 早查更精确，因为这类错误的 status 可能是 402 / 429 / 403 各家不一。
    if (/insufficient[_ ]?(quota|balance)|exceeded.*quota|billing|payment[_ ]required/i.test(message)) {
      return {
        title: "额度或余额已用完",
        hint: "请检查账户余额、配额或订阅状态。",
      }
    }

    // 400：请求体不合法。常见于 model 名拼错、参数超出范围。
    if (code === "400" || /model.*not[_ ]found|invalid.*model/i.test(message)) {
      return {
        title: "模型或参数不正确",
        hint: "确认 Model 名拼写，或换一个该 provider 支持的模型。",
      }
    }

    // 5xx：上游服务问题。和我们无关，让用户重试即可。
    if (code && /^5\d{2}$/.test(code)) {
      return {
        title: "上游服务异常",
        hint: "AI 服务商暂时不可用，过会儿重试。",
      }
    }

    // 兜底：用 SDK 给的原文 + 提示重试。
    return {
      title: "请求失败",
      hint: message,
    }
  }

  // fetch 在网络断开 / DNS 失败 / CORS 拒绝时抛 TypeError。
  // 这层错误不会带 status——区别于 SDK 的"上游说错"，是"根本没连上"。
  if (err instanceof TypeError) {
    return {
      title: "网络连接失败",
      hint: "检查网络后重试。",
    }
  }

  // AbortError 不应进这里（hook 层已经按 controller.signal.aborted 单独处理）。
  // 但万一漏过来，给个礼貌的兜底。
  if (err instanceof DOMException && err.name === "AbortError") {
    return { title: "请求已取消" }
  }

  if (err instanceof Error) {
    return { title: err.message || "未知错误" }
  }

  return { title: "未知错误" }
}
