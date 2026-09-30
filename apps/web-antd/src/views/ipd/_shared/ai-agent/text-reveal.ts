/**
 * 把已经收到的模型正文按短步长揭示。
 *
 * 只切已有字符串的前缀，不补字、不重打模型。思考先于回答展开，避免标签一半掉进正文。
 */

/** 每一拍最多揭示的字符数。 */
export const TEXT_REVEAL_STEP = 6;

/** 揭示间隔（毫秒）。取消或卸掉组件时必须清掉对应定时器。 */
export const TEXT_REVEAL_INTERVAL_MS = 16;

/** 已经拆开的思考与回答。 */
export interface RevealedMessage {
  answer: string;
  reasoning: string;
}

/**
 * 下一次可见前缀。
 *
 * 已显示的内容必须是全文前缀；否则从空前缀重来，避免把两段不同的输出接在一起。
 *
 * @param shown 当前已经揭示的文字
 * @param full 已经收到的全文
 * @param step 本拍字符数，默认 {@link TEXT_REVEAL_STEP}
 * @returns 不超过 full 的前缀
 */
export function nextRevealedText(shown: string, full: string, step = TEXT_REVEAL_STEP): string {
  if (full === '') return '';
  const base = full.startsWith(shown) ? shown : '';
  if (base.length >= full.length) return full;
  const size = step > 0 ? step : 1;
  return full.slice(0, Math.min(full.length, base.length + size));
}

/**
 * 先揭示思考，再揭示回答。
 *
 * 两侧都必须保持为已收文本的前缀。回答已经出现时，后补的思考只追加，不把回答抹掉。
 *
 * @param shown 当前可见的思考与回答
 * @param full 已经拆好的全文
 * @param step 本拍字符数
 */
export function nextRevealedMessage(
  shown: RevealedMessage,
  full: RevealedMessage,
  step = TEXT_REVEAL_STEP,
): RevealedMessage {
  const reasoning = nextRevealedText(shown.reasoning, full.reasoning, step);
  if (reasoning.length < full.reasoning.length) {
    return { reasoning, answer: full.answer.startsWith(shown.answer) ? shown.answer : '' };
  }
  return { reasoning: full.reasoning, answer: nextRevealedText(shown.answer, full.answer, step) };
}
