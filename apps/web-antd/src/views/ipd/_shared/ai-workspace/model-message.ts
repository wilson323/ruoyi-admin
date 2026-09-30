const THINK_OPEN = '<think>';
const THINK_CLOSE = '</think>';

/**
 * 把模型返回的全部思考段拆出来。
 *
 * 一次运行里模型会先写一段思考、调用工具、再写一段思考。只剥第一段时，
 * 后面的 `<think>` 会整段掉进回答，把对话气泡撑到数千像素。
 * 未闭合的最后一段留在思考区并保持展开，不把它当成正式回答。
 */
export function modelMessageParts(content: string): {
  answer: string;
  reasoning: string;
  reasoningOpen: boolean;
} {
  const reasoning: string[] = [];
  const answer: string[] = [];
  let cursor = 0;
  let reasoningOpen = false;

  while (cursor < content.length) {
    const start = content.indexOf(THINK_OPEN, cursor);
    if (start < 0) {
      answer.push(content.slice(cursor));
      break;
    }
    answer.push(content.slice(cursor, start));
    const reasoningStart = start + THINK_OPEN.length;
    const end = content.indexOf(THINK_CLOSE, reasoningStart);
    if (end < 0) {
      reasoning.push(content.slice(reasoningStart));
      reasoningOpen = true;
      break;
    }
    reasoning.push(content.slice(reasoningStart, end));
    cursor = end + THINK_CLOSE.length;
  }

  return {
    answer: answer.join('').trim(),
    reasoning: reasoning.map((part) => part.trim()).filter(Boolean).join('\n\n'),
    reasoningOpen,
  };
}
