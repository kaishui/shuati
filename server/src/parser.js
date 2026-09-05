/**
 * 试题纯文本格式的正则解析器。
 *
 * 文本由 doc/试题.docx 经 textutil 转换得到，每道题的格式为：
 *
 *   第1题 题干(P:0)
 *
 *   A、选项一
 *   B、选项二
 *   ...
 *   标准答案： C 您的答案：
 *
 * 其中 `_TagUpStart_..._TagUpEnd_` 是原文上标（如 10⁹）的标记，需还原。
 */

/** 常见上标字符映射，覆盖试题中出现的全部标记内容。 */
const SUPERSCRIPTS = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '+': '⁺',
  '-': '⁻',
  'n': 'ⁿ',
  'b': 'ᵇ',
};

const TAG_RE = /_TagUpStart_([^_]*?)_TagUpEnd_/g;
const RESIDUAL_TAG_RE = /_Tag(?:Up|Sub)(?:Start|End)_/g;

const NUMBER_RE = /^第(\d+)题/;
const STEM_RE = /^第\d+题\s*(.*?)\(P:\d+\)/;
const ANSWER_RE = /标准答案：\s*([A-E])/;
const OPTION_RE = /^([A-E])、(.+)$/;

/**
 * 将上标标记内容转换为 Unicode 上标，未知字符用 ^ 前缀兜底。
 * @param {string} content 标记内容，如 '9'、'3+'。
 * @return {string} 上标文本。
 */
function toSuperscript(content) {
  let out = '';
  for (const ch of content) {
    out += SUPERSCRIPTS[ch] ?? '^' + ch;
  }
  return out;
}

/**
 * 清理单段文本：还原上标、去掉残留标记、压缩空白。
 * @param {string} text 原始文本。
 * @return {string} 清理后的文本。
 */
export function cleanText(text) {
  return text
      .replace(TAG_RE, (match, content) => toSuperscript(content.trim()))
      .replace(RESIDUAL_TAG_RE, '')
      .replace(/\xa0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
}

/**
 * 解析单个题目块。
 * @param {string} block 以「第N题」开头、含「标准答案」的文本块。
 * @return {?Object} 题目对象；格式不符时返回 null。
 */
function parseBlock(block) {
  const numberMatch = NUMBER_RE.exec(block);
  const answerMatch = ANSWER_RE.exec(block);
  if (!numberMatch || !answerMatch) return null;

  const firstLine = block.split('\n')[0];
  const stemMatch = STEM_RE.exec(firstLine);
  if (!stemMatch) return null;

  const body = block.slice(0, block.indexOf('标准答案'));
  const options = [];
  for (const line of body.split('\n')) {
    const match = OPTION_RE.exec(line.trim());
    if (!match) continue;
    options.push({key: match[1], text: cleanText(match[2])});
  }
  if (options.length < 2) return null;

  return {
    sourceNo: Number(numberMatch[1]),
    stem: cleanText(stemMatch[1]),
    options,
    answer: answerMatch[1],
  };
}

/**
 * 解析整份试题文本。
 * @param {string} text 试题纯文本。
 * @return {Array<Object>} 题目对象数组。
 */
export function parseQuestions(text) {
  const blocks = text.split(/(?=第\d+题)/).slice(1);
  const questions = [];
  for (const block of blocks) {
    const question = parseBlock(block);
    if (question) questions.push(question);
  }
  return questions;
}
