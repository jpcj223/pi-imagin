export interface NoticeTextPart {
  kind: "text" | "art";
  text: string;
}

// Block elements (█ ▀ ▄ ▌ ░ …): what terminal QR codes and bars are drawn with.
const BLOCK_ELEMENT_RE = /[▀-▟]/;

/**
 * Splits an extension notice into prose and the runs of lines drawn with block
 * characters, such as a `qrcode-terminal` QR code sent through `ctx.ui.notify()`
 * (#755). Those only line up on a terminal grid: every space kept, one monospace
 * font for spaces and blocks alike, no gap between rows. The toast's prose styling
 * collapses runs of spaces and spaces its lines apart. Joining the parts' text
 * gives back the message; the line breaks around a run stay in the prose.
 */
export function splitNoticeText(message: string): NoticeTextPart[] {
  const parts: NoticeTextPart[] = [];
  const push = (kind: NoticeTextPart["kind"], text: string) => {
    if (!text) return;
    const last = parts[parts.length - 1];
    if (last?.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };

  let previousIsArt = false;
  message.split("\n").forEach((line, index) => {
    const isArt = BLOCK_ELEMENT_RE.test(line);
    if (index > 0) push(isArt && previousIsArt ? "art" : "text", "\n");
    push(isArt ? "art" : "text", line);
    previousIsArt = isArt;
  });
  return parts;
}

/** 仅转换已识别的模型故障；其他工具或扩展提示保持原样，技术细节按需展开。 */
export function modelNotice(message: string, locale: string): { message: string; action: string; detailsLabel: string; details: string } | null {
  const zh = locale.startsWith("zh");
  let text: string;
  if (/no api key found|missing (?:api key|credentials)|api key (?:is )?(?:missing|not configured)/i.test(message)) {
    text = zh ? "当前模型缺少认证配置，请在模型设置中添加 API Key 或登录。" : "Authentication is missing for this model. Add an API key or sign in in model settings.";
  } else if (/no (?:available )?models(?: available| found)?\b|no model selected|model .*not found/i.test(message)) {
    text = zh ? "没有可用的模型，请在模型设置中添加或启用模型。" : "No model is available. Add or enable a model in settings.";
  } else if (/invalid api key|incorrect api key|authentication (?:failed|error)|invalid authentication/i.test(message)) {
    text = zh ? "模型认证失败，请检查 API Key 或重新登录。" : "Model authentication failed. Check the API key or sign in again.";
  } else if (/fetch failed|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(message)) {
    text = zh ? "连接失败，请检查服务地址和网络后重试。" : "Connection failed. Check the service URL and network, then retry.";
  } else return null;
  const details = message.replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [已隐藏]")
    .replace(/\bsk-[a-z0-9_-]+/gi, "[已隐藏]")
    .replace(/((?:api[_ -]?key|token|authorization)\s*[:=]\s*)[^\s,;]+/gi, "$1[已隐藏]");
  return { message: text, action: zh ? "前往模型设置" : "Open model settings", detailsLabel: zh ? "技术信息" : "Technical details", details };
}
