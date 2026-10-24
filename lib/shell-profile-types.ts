/** 设置与手动终端共用的环境资料；可执行路径只由服务端解析。 */
export type ShellKind = "powershell" | "cmd" | "bash" | "zsh" | "sh" | "wsl";
export interface ShellProfile {
  id: string;
  label: string;
  path: string;
  kind: ShellKind;
  builtin: boolean;
  available: boolean;
  modelSupported: boolean;
}
export interface ShellProfileSettings {
  profiles: ShellProfile[];
  detected: ShellProfile[];
  selectedId?: string;
}
export type ShellProfileChange =
  | { action: "order"; order: string[] }
  | { action: "add"; id: string }
  | { action: "custom"; label: string; path: string; kind: ShellKind }
  | { action: "remove"; id: string }
  | { action: "reset" };
