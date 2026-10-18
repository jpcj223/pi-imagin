export interface SimpleCodeToken { kind: "plain" | "comment" | "string" | "keyword" | "number"; text: string }
const keywords = new Set("import export from default const let var function return class extends new if else for while do switch case break continue try catch finally throw async await public private protected static void int boolean string interface type def self None True False true false null undefined package using namespace include template setup style div span script end select where as into create table insert update delete values return yield fn func struct enum impl use pub mut match pass with in not and or this super".split(" "));
/** 保守的通用着色，不尝试语义诊断；不确定的标记保持原文。扫描有长度上限。 */
export function simpleCodeTokens(text: string, enabled = true): SimpleCodeToken[] {
  if (!enabled || text.length > 100_000 || text.split("\n", 2002).length > 2000) return [{ kind: "plain", text }];
  const result: SimpleCodeToken[] = [];
  const pattern = /(\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\r\n]*|<!--[^]*?(?:-->|$)|(?:^|\n)[ \t]*#[^\r\n]*|"(?:\\[^]|[^"\\])*"|'(?:\\[^]|[^'\\])*'|`(?:\\[^]|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_]\w*\b)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index! > last) result.push({ kind: "plain", text: text.slice(last, match.index) });
    const value = match[0], trimmed = value.trimStart();
    const kind = trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("<!--") || trimmed.startsWith("#") ? "comment"
      : /^["'`]/.test(value) ? "string" : /^\d/.test(value) ? "number" : keywords.has(value) ? "keyword" : "plain";
    result.push({ kind, text: value }); last = match.index! + value.length;
  }
  if (last < text.length) result.push({ kind: "plain", text: text.slice(last) });
  return result;
}
