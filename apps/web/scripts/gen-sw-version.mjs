/**
 * 构建前生成 SW 版本文件（public/sw-version.js，gitignore）。
 *
 * 内容为构建时间戳：每次构建字节必然不同，浏览器据此判定 Service Worker
 * 有更新（importScripts 的子脚本参与字节比对），activate 后按版本名清理
 * 全部旧缓存——修复「SW 永不更新 + 旧 chunk 泄漏膨胀」。
 * 缺失该文件时（dev 直跑）sw.js 回退为 "dev" 版本名，行为不变。
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14); // yyyymmddhhmmss
writeFileSync(
  join(here, "..", "public", "sw-version.js"),
  `self.__BUILD_ID__ = "b${stamp}";\n`,
  "utf8"
);
console.log(`sw-version.js generated: b${stamp}`);
