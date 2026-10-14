import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import sharp from "sharp";

// 仅导出尺寸和留边，不改变已选定 Logo 的轮廓与配色。
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = process.argv[2]
  ? resolve(process.argv[2])
  : join(root, "design/pi-imagin-logo-ocean-blue-v9.png");
const icons = join(root, "public/icons");
const original = await readFile(source);
const { data, info } = await sharp(original).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
let left = info.width;
let top = info.height;
let right = -1;
let bottom = -1;

// 忽略近乎透明的边缘像素，仅用可见图形确定原画布的留白范围。
for (let y = 0; y < info.height; y++) {
  for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * info.channels + 3] <= 128) continue;
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
}
if (right < left || bottom < top) throw new Error("Logo 原图没有可见图形");

const cropped = await sharp(original)
  .extract({ left, top, width: right - left + 1, height: bottom - top + 1 })
  .png()
  .toBuffer();
const transparent = { r: 0, g: 0, b: 0, alpha: 0 };

async function png(size, padding, opaque = false) {
  let image = sharp(cropped)
    .resize(size - padding * 2, size - padding * 2, { fit: "contain", background: transparent })
    .extend({ top: padding, bottom: padding, left: padding, right: padding, background: transparent });
  // Apple 安装图标使用实色底，页面中的 Logo 保持透明，适配明暗主题。
  if (opaque) image = sharp(await image.png().toBuffer()).flatten({ background: "#f4f7fa" });
  return image.png().toBuffer();
}

await mkdir(icons, { recursive: true });
for (const [name, size, padding, opaque] of [
  ["logo-ocean.png", 256, 8, false],
  ["icon-ocean-192.png", 192, 16, false],
  ["icon-ocean-512.png", 512, 42, false],
  ["apple-touch-ocean.png", 180, 16, true],
  ["favicon-ocean-32.png", 32, 2, false],
]) {
  await writeFile(join(icons, name), await png(size, padding, opaque));
}

// ICO 内嵌多个 PNG 尺寸，兼容浏览器及 Windows 的标签页图标。
const frames = await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(size, 1) })));
const header = Buffer.alloc(6 + frames.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(frames.length, 4);
let offset = header.length;
for (const [index, frame] of frames.entries()) {
  const entry = 6 + index * 16;
  header[entry] = frame.size;
  header[entry + 1] = frame.size;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(frame.data.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += frame.data.length;
}
await writeFile(join(root, "app/favicon.ico"), Buffer.concat([header, ...frames.map((frame) => frame.data)]));
console.log("已导出页面 Logo、PWA 图标、Apple 图标与多尺寸 favicon");
