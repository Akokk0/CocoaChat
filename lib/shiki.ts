// Shiki singleton 高亮器。
//
// 为什么不直接用 `codeToHtml(code, ...)` 这个最简的 API：
//   它每次调用都会按需加载语言/主题文件——一段对话里有几十个代码块就要
//   解几十次 wasm/grammar，体积膨胀且首屏慢。
//
// 策略：模块级 lazy 单例 + 一次性预加载常用语言/主题。
//   - 第一次访问时启动 createHighlighter，返回 Promise
//   - 后续所有 CodeBlock 拿到同一个 highlighter
//   - 没列在 LANGS 里的语言走 fallback "plaintext"，不报错
//
// 输出走 Shiki 的 dual-theme：传 `themes: { light, dark }`，HTML 内嵌两套
// 颜色变量，CSS 端用 `.dark .shiki { color: var(--shiki-dark) }` 切换——
// 无需 React 在主题变化时重新高亮。

import {
  createHighlighter,
  type BundledLanguage,
  type BundledTheme,
  type Highlighter,
} from "shiki"

// 预加载的语言。挑对话里最常见的；没列的会被当 plaintext，不报错。
const LANGS = [
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "python",
  "json",
  "bash",
  "shell",
  "markdown",
  "css",
  "html",
  "yaml",
  "sql",
  "go",
  "rust",
  "java",
  "c",
  "cpp",
  "diff",
] as const satisfies readonly BundledLanguage[]

// 主题：github 系列对中文/emoji 友好，跟项目的白粉/黑粉主题色不打架。
const THEMES = {
  light: "github-light",
  dark: "github-dark",
} as const satisfies Record<string, BundledTheme>

// 已加载语言查询。把常见别名（ts/js/sh/yml…）也算进去。
const LANG_SET: Set<string> = new Set<string>([
  ...LANGS,
  "ts",
  "js",
  "py",
  "sh",
  "shellscript",
  "md",
  "yml",
])

function isSupportedLang(lang: string | undefined): boolean {
  return Boolean(lang) && LANG_SET.has(lang!.toLowerCase())
}

// 单例 promise——第一次访问时 lazy 启动 highlighter，后续 caller 都共享同一个。
let highlighterPromise: Promise<Highlighter> | null = null

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: Object.values(THEMES),
      langs: LANGS as unknown as BundledLanguage[],
    })
  }
  return highlighterPromise
}

// 异步高亮一段代码，返回 dual-theme HTML（同时带 light/dark 颜色变量）。
// 调用方用 useEffect + setState 接结果；resolve 之前显示纯文本 fallback。
export async function highlightCode(
  code: string,
  lang: string | undefined,
): Promise<string> {
  const highlighter = await getHighlighter()
  return highlighter.codeToHtml(code, {
    // 不在白名单的语言走 plaintext——避免 codeToHtml 抛 "lang not loaded"。
    lang: isSupportedLang(lang) ? lang!.toLowerCase() : "plaintext",
    themes: THEMES,
    // dual theme 必须给一个默认色——其他主题靠 CSS 变量切。
    defaultColor: "light",
  })
}
