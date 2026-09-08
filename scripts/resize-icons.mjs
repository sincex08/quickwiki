/**
 * 从 apps/web/public/icon-1024.png 生成 PWA 所需的各尺寸图标。
 * 用法：pnpm icons
 */
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const publicDir = join(root, "..", "apps", "web", "public");
const source = join(publicDir, "icon-1024.png");

const targets = [
  { size: 512, file: "icon-512.png" },
  { size: 192, file: "icon-192.png" },
];

for (const { size, file } of targets) {
  await sharp(source)
    .resize(size, size, { fit: "cover" })
    .png()
    .toFile(join(publicDir, file));
  console.log(`generated ${file} (${size}x${size})`);
}
