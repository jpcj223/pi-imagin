/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const ROOT_FILES = new Set(["package.json", "postcss.config.mjs", "tailwind.config.ts", "instrumentation.ts", "instrumentation-node.ts", "proxy.ts", "next.config.ts", "tsconfig.json"]);

// Watchpack 不遍历链接形式的 app 目录；只镜像页面目录，其余源码保持链接。
function synchronizeApplication(source, target) {
  if (!fs.existsSync(source)) {
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true });
    return;
  }
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) throw new Error(`页面源码不支持符号链接：${source}`);
  if (stat.isDirectory()) {
    if (fs.existsSync(target) && !fs.statSync(target).isDirectory()) fs.unlinkSync(target);
    fs.mkdirSync(target, { recursive: true });
    const names = new Set(fs.readdirSync(source));
    for (const name of names) synchronizeApplication(path.join(source, name), path.join(target, name));
    for (const name of fs.readdirSync(target)) if (!names.has(name)) fs.rmSync(path.join(target, name), { recursive: true });
  } else {
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) fs.rmSync(target, { recursive: true });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!fs.existsSync(target) || !fs.readFileSync(source).equals(fs.readFileSync(target))) fs.copyFileSync(source, target);
  }
}

function watchApplication(root, directory, onError) {
  const pending = new Map();
  const source = path.join(root, "app"), target = path.join(directory, "app");
  const watcher = fs.watch(source, { recursive: true }, (_event, filename) => {
    const relative = String(filename || "");
    // 文件系统通知也先验证边界；只更新本启动器生成的页面镜像。
    if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes("..")) return;
    clearTimeout(pending.get(relative));
    pending.set(relative, setTimeout(() => {
      pending.delete(relative);
      try { synchronizeApplication(path.join(source, relative), path.join(target, relative)); }
      catch (error) { onError(error); }
    }, 25));
  });
  return () => { watcher.close(); for (const timer of pending.values()) clearTimeout(timer); pending.clear(); };
}

/** 生成独立开发入口，页面镜像自动同步；框架配置、类型文件和缓存保留在派生目录。 */
function prepareDevelopmentWorkspace(root) {
  const directory = path.join(root, ".desktop-dev");
  const marker = path.join(directory, ".pi-imagin-workspace.json");
  if (fs.existsSync(directory) && fs.readdirSync(directory).length && !fs.existsSync(marker)) throw new Error(".desktop-dev 已有非启动器生成的内容，请保留后移走再启动。");
  if (fs.existsSync(marker) && JSON.parse(fs.readFileSync(marker, "utf8")).root !== root) throw new Error("桌面开发目录属于其他仓库，请先核对。");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(marker, JSON.stringify({ root }));
  const application = path.join(directory, "app");
  if (fs.existsSync(application) && fs.lstatSync(application).isSymbolicLink()) {
    // 迁移旧的派生目录链接，只移除链接本身，不递归处理真实源码。
    if (process.platform === "win32") fs.rmdirSync(application); else fs.unlinkSync(application);
  }
  synchronizeApplication(path.join(root, "app"), application);
  for (const name of ["components", "hooks", "lib", "public", "node_modules"]) {
    const source = path.join(root, name), target = path.join(directory, name);
    if (!fs.existsSync(source)) continue;
    if (fs.existsSync(target)) {
      if (fs.realpathSync(target) !== fs.realpathSync(source)) throw new Error(`桌面开发目录中的 ${name} 不是预期的源码链接。`);
    } else fs.symlinkSync(source, target, process.platform === "win32" ? "junction" : "dir");
  }
  synchronizeDevelopmentFiles(root, directory);
  return directory;
}

function synchronizeDevelopmentFiles(root, directory) {
  for (const name of ROOT_FILES) {
    if (["next.config.ts", "tsconfig.json"].includes(name)) continue;
    const source = path.join(root, name), target = path.join(directory, name);
    if (fs.existsSync(source)) {
      if (!fs.existsSync(target) || !fs.readFileSync(source).equals(fs.readFileSync(target))) fs.copyFileSync(source, target);
    }
    else if (fs.existsSync(target)) fs.unlinkSync(target);
  }
  const tsconfig = { extends: "../tsconfig.json", compilerOptions: { paths: { "@/*": ["./*"] }, tsBuildInfoFile: ".next/cache/typescript.tsbuildinfo" }, include: ["next-env.d.ts", ".next/types/**/*.ts", ".next/dev/types/**/*.ts", "../app/**/*.ts", "../app/**/*.tsx", "../components/**/*.ts", "../components/**/*.tsx", "../hooks/**/*.ts", "../hooks/**/*.tsx", "../lib/**/*.ts", "instrumentation*.ts", "proxy.ts"], exclude: ["node_modules"] };
  const configText = JSON.stringify(tsconfig, null, 2) + "\n";
  // 已有 Next 补充项保留；只在根配置变化时重建派生配置，避免无关编辑触发服务重启。
  const signature = createHash("sha256").update(fs.readFileSync(path.join(root, "tsconfig.json"))).digest("hex");
  const statePath = path.join(directory, ".typescript-source");
  if (!fs.existsSync(statePath) || fs.readFileSync(statePath, "utf8") !== signature) {
    fs.writeFileSync(path.join(directory, "tsconfig.json"), configText);
    fs.writeFileSync(statePath, signature);
  }
  const sourceConfig = path.join(root, "next.config.ts");
  const configSignature = createHash("sha256").update(fs.readFileSync(sourceConfig)).digest("hex");
  const wrapper = `// 原配置指纹：${configSignature}\nimport { createRequire } from 'node:module';\nconst require=createRequire(${JSON.stringify(path.join(root, "package.json"))});\nconst {createJiti}=require('jiti');\nconst source=await createJiti(${JSON.stringify(path.join(root, "package.json"))}).import(${JSON.stringify(sourceConfig)},{default:true});\nexport default {...source,distDir:'.next',output:undefined,outputFileTracingRoot:${JSON.stringify(root)},turbopack:{...source.turbopack,root:${JSON.stringify(root)}},typescript:{...source.typescript,tsconfigPath:'tsconfig.json'}};\n`;
  const targetConfig = path.join(directory, "next.config.mjs");
  if (!fs.existsSync(targetConfig) || fs.readFileSync(targetConfig, "utf8") !== wrapper) fs.writeFileSync(targetConfig, wrapper);
}

module.exports = { prepareDevelopmentWorkspace, synchronizeDevelopmentFiles, watchApplication, ROOT_FILES };
