// Shiki singleton 高亮器：模块级 lazy 单例 + 一次性预加载常用语言/主题，
// 避免 codeToHtml 每次按需加载 wasm/grammar。
// dual-theme 输出：HTML 内嵌两套颜色变量，CSS 切主题不需重新高亮。

import {
  createHighlighter,
  type BundledLanguage,
  type BundledTheme,
  type Highlighter,
} from "shiki"

// 没列在这里的语言走 plaintext fallback，不报错。
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

const THEMES = {
  light: "github-light",
  dark: "github-dark",
} as const satisfies Record<string, BundledTheme>

// 含常见别名（ts/js/sh/yml…），用于查询是否已加载。
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

export async function highlightCode(
  code: string,
  lang: string | undefined,
): Promise<string> {
  const highlighter = await getHighlighter()
  return highlighter.codeToHtml(code, {
    // 不在白名单的走 plaintext，避免抛 "lang not loaded"。
    lang: isSupportedLang(lang) ? lang!.toLowerCase() : "plaintext",
    themes: THEMES,
    // dual theme 必须给一个默认色——其他主题靠 CSS 变量切。
    defaultColor: "light",
  })
}
