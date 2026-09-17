/**
 * 字数统计：中文按字符计、英文按单词计、字符数为去空白后的总长。
 * 不解析 Markdown 结构（代码块内文字照常计入）——状态条追求的是
 * 确定性强、零歧义，而非出版级排版字数。
 */

export interface WordCount {
  /** 中文 + 英文单词的混合「字数」（状态条主显示值） */
  total: number;
  /** 中文字符数 */
  chinese: number;
  /** 英文/数字单词数 */
  words: number;
  /** 去空白后的总字符数 */
  chars: number;
}

export function countWords(markdown: string): WordCount {
  const chinese = (markdown.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) ?? []).length;
  const words = (markdown.match(/[A-Za-z0-9][A-Za-z0-9'’_-]*/g) ?? []).length;
  const chars = markdown.replace(/\s/g, "").length;
  return { total: chinese + words, chinese, words, chars };
}
