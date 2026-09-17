import { createLowlight, common } from "lowlight";

/**
 * 代码块高亮的唯一 lowlight 实例与语言清单。
 * common 子集含 ~37 种常用语言，按需打包，不引入全量 highlight.js。
 */
export const lowlight = createLowlight(common);

export interface CodeLanguage {
  id: string;
  label: string;
}

/** 下拉清单：常用语言在前，其余按字母序（含 plaintext 兜底） */
export const CODE_LANGUAGES: CodeLanguage[] = [
  { id: "plaintext", label: "纯文本" },
  { id: "js", label: "JavaScript" },
  { id: "ts", label: "TypeScript" },
  { id: "jsx", label: "JSX" },
  { id: "tsx", label: "TSX" },
  { id: "json", label: "JSON" },
  { id: "bash", label: "Bash" },
  { id: "python", label: "Python" },
  { id: "java", label: "Java" },
  { id: "c", label: "C" },
  { id: "cpp", label: "C++" },
  { id: "csharp", label: "C#" },
  { id: "go", label: "Go" },
  { id: "rust", label: "Rust" },
  { id: "php", label: "PHP" },
  { id: "sql", label: "SQL" },
  { id: "yaml", label: "YAML" },
  { id: "html", label: "HTML" },
  { id: "css", label: "CSS" },
  { id: "xml", label: "XML" },
  { id: "markdown", label: "Markdown" },
  { id: "diff", label: "Diff" },
];

/** 语言下拉里没有的（如用户手写 ```ruby）：仍正常高亮/存储，下拉显示原始 id */
export function languageLabel(id: string): string {
  return CODE_LANGUAGES.find((l) => l.id === id)?.label ?? id;
}
