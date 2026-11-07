/**
 * 把用户在会话中选中的文本格式化为 Markdown 引用块。
 *
 * @remarks
 * 先去除首尾空白，再按行拆分逐行加 `> ` 前缀；空行只写 `>`，避免行尾多余空格。
 * 不在末尾补空行——插入位置与引用后留白由 Composer 决定，便于本函数保持纯文本变换、可单测。
 *
 * @param text - 用户在会话中选中的原始文本。
 * @returns 以 `> ` 前缀的 Markdown 引用块；`text` 去空白后为空时返回空串。
 * @internal
 */
export function formatQuote(text: string): string {
	const trimmed = text.trim();
	if (trimmed.length === 0) return "";
	return trimmed
		.split("\n")
		.map((line) => (line.length > 0 ? `> ${line}` : ">"))
		.join("\n");
}
