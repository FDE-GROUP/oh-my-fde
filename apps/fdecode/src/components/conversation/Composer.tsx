import { useEffect, useRef, useState } from "react";
import type { FileCandidate } from "../../lib/api.ts";
import { type ImageAttachment, prepareImage, releaseImage } from "../../lib/images.ts";
import { formatQuote } from "../../lib/quote.ts";
import { IconButton } from "../primitives/IconButton.tsx";
import { ImageIcon, SendIcon, StopIcon } from "../primitives/icons.tsx";

export type QueueMode = "steer" | "followUp";

export interface CommandSummary {
	name: string;
	description?: string;
	source: "extension" | "prompt" | "skill";
}

export interface ComposerProps {
	disabled: boolean;
	streaming: boolean;
	queued: number;
	supportsImages: boolean;
	commands: CommandSummary[];
	initialDraft?: string;
	quote?: { text: string } | null;
	attachments: ImageAttachment[];
	onAttachmentsChange: (next: ImageAttachment[]) => void;
	onSearchFiles: (query: string) => Promise<FileCandidate[]>;
	onExpandFiles: (paths: string[]) => Promise<{
		text: string;
		images: Array<{ type: "image"; mimeType: string; data: string }>;
		notes: string[];
	}>;
	onNotes: (notes: string[]) => void;
	onSend: (text: string, mode: QueueMode, attachments: ImageAttachment[]) => Promise<boolean>;
	onAbort: () => void;
}

interface SuggestionItem {
	key: string;
	label: string;
	hint?: string;
}

interface Suggestion {
	kind: "file" | "command";
	start: number;
	query: string;
	items: SuggestionItem[];
	index: number;
}

function detectSuggestion(
	value: string,
	caret: number,
): { kind: "file" | "command"; start: number; query: string } | null {
	const before = value.slice(0, caret);
	const file = before.match(/(?:^|\s)@([^\s@]*)$/);
	if (file) {
		const query = file[1] ?? "";
		return { kind: "file", start: caret - query.length - 1, query };
	}
	const command = before.match(/^\/([^\s]*)$/);
	if (command) return { kind: "command", start: 0, query: command[1] ?? "" };
	return null;
}

export function Composer({
	disabled,
	streaming,
	queued,
	supportsImages,
	commands,
	initialDraft,
	quote,
	attachments,
	onAttachmentsChange,
	onSearchFiles,
	onExpandFiles,
	onNotes,
	onSend,
	onAbort,
}: ComposerProps) {
	const [value, setValue] = useState("");
	const [mode, setMode] = useState<QueueMode>("steer");
	const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
	const [sending, setSending] = useState(false);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const pendingCaretEnd = useRef(false);

	useEffect(() => {
		if (!initialDraft) return;
		setValue((current) => (current.length === 0 ? initialDraft : current));
	}, [initialDraft]);

	// 引用选中内容：quote 每次为新对象即触发，把格式化后的引用块追加到当前输入并聚焦。
	useEffect(() => {
		if (!quote) return;
		const block = formatQuote(quote.text);
		if (block.length === 0) return;
		setValue((current) => {
			const base = current.trimEnd();
			return base.length === 0 ? `${block}\n\n` : `${base}\n\n${block}\n\n`;
		});
		pendingCaretEnd.current = true;
		textareaRef.current?.focus();
	}, [quote]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: 输入变化后需要重新计算 textarea 高度。
	useEffect(() => {
		const textarea = textareaRef.current;
		if (!textarea) return;
		textarea.style.height = "auto";
		textarea.style.height = `${Math.min(textarea.scrollHeight, 192)}px`;
		// 引用插入后把光标移到末尾；等 DOM value 提交后再定位，避免与用户输入抢光标。
		if (pendingCaretEnd.current) {
			pendingCaretEnd.current = false;
			textarea.selectionStart = textarea.value.length;
			textarea.selectionEnd = textarea.value.length;
		}
	}, [value]);

	useEffect(() => {
		if (suggestion?.kind !== "file") return;
		const query = suggestion.query;
		let cancelled = false;
		const timer = setTimeout(() => {
			onSearchFiles(query)
				.then((files) => {
					if (cancelled) return;
					setSuggestion((current) =>
						current && current.kind === "file" && current.query === query
							? { ...current, items: files.map((file) => ({ key: file.path, label: file.path })) }
							: current,
					);
				})
				.catch(() => undefined);
		}, 150);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [suggestion?.kind, suggestion?.query, onSearchFiles]);

	function updateSuggestion(nextValue: string, caret: number) {
		const detected = detectSuggestion(nextValue, caret);
		if (!detected) {
			setSuggestion(null);
			return;
		}
		const items =
			detected.kind === "command"
				? commands
						.filter((command) => command.name.toLowerCase().includes(detected.query.toLowerCase()))
						.slice(0, 20)
						.map((command) => ({
							key: command.name,
							label: `/${command.name}`,
							hint: command.description ?? command.source,
						}))
				: [];
		setSuggestion({ ...detected, items, index: 0 });
	}

	async function selectSuggestion(item: SuggestionItem) {
		const current = suggestion;
		if (!current) return;
		const caret = current.start + current.query.length + 1;

		if (current.kind === "command") {
			const replaced = `${value.slice(0, current.start)}/${item.key} ${value.slice(caret)}`;
			setValue(replaced);
			setSuggestion(null);
			textareaRef.current?.focus();
			return;
		}

		setSuggestion(null);
		try {
			const expanded = await onExpandFiles([item.key]);
			setValue(`${value.slice(0, current.start)}${expanded.text}${value.slice(caret)}`);
			if (expanded.notes.length > 0) onNotes(expanded.notes);
			if (expanded.images.length > 0) {
				const added: ImageAttachment[] = expanded.images.map((image, index) => ({
					id: `file-${Date.now()}-${index}`,
					mimeType: image.mimeType,
					data: image.data,
					preview: `data:${image.mimeType};base64,${image.data}`,
					name: item.key,
				}));
				onAttachmentsChange([...attachments, ...added]);
			}
			textareaRef.current?.focus();
		} catch (error) {
			onNotes([error instanceof Error ? error.message : String(error)]);
		}
	}

	async function addFiles(files: File[]) {
		const images = files.filter((file) => file.type.startsWith("image/"));
		if (images.length === 0) return;
		if (!supportsImages) {
			onNotes(["当前模型不支持图片输入"]);
			return;
		}
		const added: ImageAttachment[] = [];
		const notes: string[] = [];
		for (const file of images) {
			try {
				added.push(await prepareImage(file, file.name || "粘贴的图片"));
			} catch (error) {
				notes.push(`${file.name || "图片"}：${error instanceof Error ? error.message : String(error)}`);
			}
		}
		if (added.length > 0) onAttachmentsChange([...attachments, ...added]);
		if (notes.length > 0) onNotes(notes);
	}

	function removeAttachment(id: string) {
		const removed = attachments.find((item) => item.id === id);
		if (removed) releaseImage(removed);
		onAttachmentsChange(attachments.filter((item) => item.id !== id));
	}

	async function submit() {
		const text = value.trim();
		if (sending || disabled) return;
		if (text.length === 0 && attachments.length === 0) return;
		setSending(true);
		try {
			const ok = await onSend(text, mode, attachments);
			if (ok) {
				setValue("");
				for (const attachment of attachments) releaseImage(attachment);
				onAttachmentsChange([]);
			}
		} finally {
			setSending(false);
		}
	}

	return (
		<div className="border-t border-hairline border-dsw-border-l1 px-4 py-3">
			<div className="relative mx-auto flex w-full max-w-3xl flex-col gap-1">
				{suggestion && suggestion.items.length > 0 && (
					<div
						data-testid="composer-suggestions"
						className="absolute bottom-full left-0 z-20 mb-1 max-h-64 w-full overflow-y-auto rounded-dsw-card border border-hairline border-dsw-border-l1 bg-dsw-bg-base py-1 shadow-dsw-panel"
					>
						{suggestion.items.map((item, index) => (
							<button
								key={item.key}
								type="button"
								onMouseDown={(event) => {
									event.preventDefault();
									void selectSuggestion(item);
								}}
								className={
									index === suggestion.index
										? "flex w-full flex-col gap-0.5 bg-dsw-bg-layer-2 px-3 py-1.5 text-left"
										: "flex w-full flex-col gap-0.5 px-3 py-1.5 text-left hover:bg-dsw-bg-layer-2"
								}
							>
								<span className="truncate font-mono text-xs text-dsw-label-primary">{item.label}</span>
								{item.hint && <span className="truncate text-[11px] text-dsw-label-tertiary">{item.hint}</span>}
							</button>
						))}
					</div>
				)}

				{attachments.length > 0 && (
					<div className="flex flex-wrap gap-2">
						{attachments.map((attachment) => (
							<div key={attachment.id} className="group relative">
								<img
									src={attachment.preview}
									alt={attachment.name}
									className="size-14 rounded-dsw-sm border border-hairline border-dsw-border-l1 object-cover"
								/>
								<button
									type="button"
									aria-label={`移除 ${attachment.name}`}
									onClick={() => removeAttachment(attachment.id)}
									className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-dsw-label-primary text-[10px] text-dsw-label-inverted"
								>
									×
								</button>
							</div>
						))}
					</div>
				)}

				{/* biome-ignore lint/a11y/noStaticElementInteractions: 拖放区域由内部 textarea 提供键盘入口。 */}
				<div
					className="flex items-end gap-1 rounded-dsw-card border border-hairline border-dsw-border-l1 bg-dsw-bg-layer-1 p-2 focus-within:border-dsw-border-l3"
					onDragOver={(event) => event.preventDefault()}
					onDrop={(event) => {
						event.preventDefault();
						void addFiles(Array.from(event.dataTransfer.files));
					}}
				>
					<input
						ref={fileInputRef}
						type="file"
						accept="image/*"
						multiple
						className="hidden"
						onChange={(event) => {
							void addFiles(Array.from(event.target.files ?? []));
							event.target.value = "";
						}}
					/>
					<IconButton
						label={supportsImages ? "添加图片" : "当前模型不支持图片"}
						disabled={!supportsImages}
						onClick={() => fileInputRef.current?.click()}
					>
						<ImageIcon />
					</IconButton>

					<textarea
						ref={textareaRef}
						rows={1}
						value={value}
						disabled={disabled}
						placeholder={streaming ? "运行中，可继续输入以排队" : "输入任务，@ 引用文件，/ 执行命令"}
						onChange={(event) => {
							const next = event.target.value;
							setValue(next);
							updateSuggestion(next, event.target.selectionStart ?? next.length);
						}}
						onPaste={(event) => {
							const files = Array.from(event.clipboardData.files);
							if (files.some((file) => file.type.startsWith("image/"))) {
								event.preventDefault();
								void addFiles(files);
							}
						}}
						onKeyDown={(event) => {
							if (suggestion && suggestion.items.length > 0) {
								if (event.key === "ArrowDown") {
									event.preventDefault();
									setSuggestion({
										...suggestion,
										index: (suggestion.index + 1) % suggestion.items.length,
									});
									return;
								}
								if (event.key === "ArrowUp") {
									event.preventDefault();
									setSuggestion({
										...suggestion,
										index: (suggestion.index - 1 + suggestion.items.length) % suggestion.items.length,
									});
									return;
								}
								if (event.key === "Enter" || event.key === "Tab") {
									event.preventDefault();
									void selectSuggestion(suggestion.items[suggestion.index]);
									return;
								}
								if (event.key === "Escape") {
									event.preventDefault();
									setSuggestion(null);
									return;
								}
							}
							if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
							event.preventDefault();
							void submit();
						}}
						className="max-h-48 min-h-8 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm leading-6 text-dsw-label-primary outline-none placeholder:text-dsw-label-tertiary disabled:opacity-60"
					/>

					{streaming ? (
						<IconButton label="停止" onClick={onAbort}>
							<StopIcon />
						</IconButton>
					) : (
						<IconButton
							label="发送"
							disabled={disabled || sending || (value.trim().length === 0 && attachments.length === 0)}
							onClick={() => void submit()}
						>
							<SendIcon />
						</IconButton>
					)}
				</div>

				<div className="flex items-center gap-2 px-1 text-[11px] text-dsw-label-tertiary">
					<span>Enter 发送 · Shift+Enter 换行</span>
					{queued > 0 && <span>· 队列 {queued}</span>}
					{streaming && (
						<div className="ml-auto flex rounded-dsw-xs bg-dsw-bg-layer-2 p-0.5">
							{(["steer", "followUp"] as const).map((item) => (
								<button
									key={item}
									type="button"
									aria-pressed={mode === item}
									onClick={() => setMode(item)}
									className={
										mode === item
											? "rounded-dsw-xs bg-dsw-bg-layer-1 px-1.5 py-0.5 text-dsw-label-primary"
											: "rounded-dsw-xs px-1.5 py-0.5"
									}
								>
									{item === "steer" ? "插话" : "追加"}
								</button>
							))}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
