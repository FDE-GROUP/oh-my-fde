// biome-ignore-all lint/suspicious/noArrayIndexKey: Pi 消息与内容块没有稳定 id，只能按位置渲染。
import { useEffect, useRef, useState } from "react";
import type { ConversationMessage, StreamingMessage, ToolExecution } from "../../lib/conversation.ts";
import { IconButton } from "../primitives/IconButton.tsx";
import { ArrowDownIcon } from "../primitives/icons.tsx";
import { ToolCard } from "../tools/ToolCard.tsx";
import { Markdown } from "./Markdown.tsx";

function ThinkingBlock({ thinking }: { thinking: string }) {
	if (thinking.length === 0) return null;
	return (
		<details className="group rounded-dsw-sm border border-hairline border-dsw-border-l1 bg-dsw-bg-layer-1">
			<summary className="cursor-pointer select-none px-3 py-2 text-xs text-dsw-label-secondary">思考</summary>
			<pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words px-3 pb-3 font-mono text-xs leading-5 text-dsw-label-secondary">
				{thinking}
			</pre>
		</details>
	);
}

interface ToolResultView {
	text: string;
	isError: boolean;
	durationMs?: number;
}

type RenderableMessage = Extract<ConversationMessage, { role: "user" | "assistant" }>;

function textFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((block) => {
			if (!block || typeof block !== "object") return "";
			const candidate = block as { type?: string; text?: string };
			if (candidate.type === "text" && typeof candidate.text === "string") return candidate.text;
			if (candidate.type === "image") return "[图片]";
			return "";
		})
		.filter(Boolean)
		.join("\n");
}

function collectToolResults(messages: ConversationMessage[]): Map<string, ToolResultView> {
	const results = new Map<string, ToolResultView>();
	for (const message of messages) {
		if (message.role !== "toolResult") continue;
		results.set(message.toolCallId, {
			text: textFromContent(message.content),
			isError: message.isError,
			durationMs: message.durationMs,
		});
	}
	return results;
}

function MessageContent({
	message,
	tools,
	results,
}: {
	message: RenderableMessage;
	tools: Record<string, ToolExecution>;
	results: Map<string, ToolResultView>;
}) {
	if (typeof message.content === "string") {
		return <Markdown text={message.content} />;
	}
	return (
		<div className="flex flex-col gap-2">
			{message.content.map((block, index) => {
				if (block.type === "text") return <Markdown key={index} text={block.text} />;
				if (block.type === "thinking") return <ThinkingBlock key={index} thinking={block.thinking} />;
				if (block.type === "toolCall") {
					const execution = tools[block.id];
					const result = results.get(block.id);
					return (
						<ToolCard
							key={block.id}
							callId={block.id}
							name={block.name}
							args={block.arguments}
							execution={execution}
							result={result}
						/>
					);
				}
				if (block.type === "image") {
					return (
						<span key={index} className="text-xs text-dsw-label-tertiary">
							[图片]
						</span>
					);
				}
				return null;
			})}
		</div>
	);
}

function RoleLabel({ author }: { author: string }) {
	const label = author === "assistant" ? "Pi" : author === "user" ? "你" : author;
	return <span className="text-[11px] font-medium tracking-wide text-dsw-label-tertiary">{label}</span>;
}

function MessageRow({
	message,
	tools,
	results,
	renderedCallIds,
	forkEntryId,
	onFork,
}: {
	message: ConversationMessage;
	tools: Record<string, ToolExecution>;
	results: Map<string, ToolResultView>;
	renderedCallIds: Set<string>;
	forkEntryId?: string;
	onFork?: (entryId: string) => void;
}) {
	if (message.role !== "user" && message.role !== "assistant" && message.role !== "toolResult") return null;

	if (message.role === "toolResult") {
		if (renderedCallIds.has(message.toolCallId)) return null;
		return (
			<details className="rounded-dsw-sm border border-hairline border-dsw-border-l1 bg-dsw-bg-layer-1">
				<summary className="cursor-pointer select-none px-3 py-2 text-xs text-dsw-label-secondary">
					工具结果 · <span className="font-mono">{message.toolName}</span>
				</summary>
				<pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words px-3 pb-3 font-mono text-xs leading-5 text-dsw-label-secondary">
					{textFromContent(message.content)}
				</pre>
			</details>
		);
	}

	return (
		<article className="group relative flex flex-col gap-2">
			{message.role === "user" && forkEntryId && onFork && (
				<button
					type="button"
					onClick={() => onFork(forkEntryId)}
					className="absolute right-2 top-2 rounded-dsw-xs border border-dsw-border-l1 bg-dsw-bg-base px-1.5 py-0.5 text-[10px] text-dsw-label-secondary opacity-0 shadow-dsw-soft group-hover:opacity-100"
				>
					从这里分叉
				</button>
			)}
			<RoleLabel author={message.role} />
			<div
				className={
					message.role === "user"
						? "rounded-dsw-card border border-hairline border-dsw-border-l1 bg-dsw-bg-layer-1 px-4 py-3"
						: "px-1"
				}
			>
				<MessageContent message={message} tools={tools} results={results} />
			</div>
		</article>
	);
}

function StreamingRow({ streaming }: { streaming: StreamingMessage }) {
	const empty = streaming.text.length === 0 && streaming.thinking.length === 0;
	return (
		<article className="flex flex-col gap-2">
			<RoleLabel author="assistant" />
			<div className="flex flex-col gap-2 px-1">
				<ThinkingBlock thinking={streaming.thinking} />
				{streaming.text.length > 0 && <Markdown text={streaming.text} />}
				{empty && <p className="motion-safe:animate-pulse text-sm text-dsw-label-tertiary">正在思考…</p>}
			</div>
		</article>
	);
}

// 用户正在会话容器内拖选文本时暂停吸附，避免流式增量把选中内容滚走（复制/阅读体验）。
function hasActiveSelection(container: HTMLElement): boolean {
	const selection = window.getSelection();
	if (!selection || selection.isCollapsed) return false;
	return container.contains(selection.anchorNode);
}

export interface MessageListProps {
	messages: ConversationMessage[];
	streaming: StreamingMessage | null;
	tools: Record<string, ToolExecution>;
	forkMessages?: Array<{ entryId: string; text: string }>;
	onFork?: (entryId: string) => void;
}

export function MessageList({ messages, streaming, tools, forkMessages = [], onFork }: MessageListProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);
	// 吸附底部：内容增长即钉到底部，仅用户主动上滚超阈值才解除。用 ref 供 ResizeObserver 回调同步读取。
	const stickToBottom = useRef(true);
	const lastScrollTop = useRef(0);
	const [atBottom, setAtBottom] = useState(true);
	const results = collectToolResults(messages);
	const forkIds: Array<string | undefined> = [];
	let userIndex = 0;
	for (const message of messages) {
		forkIds.push(message.role === "user" ? forkMessages[userIndex++]?.entryId : undefined);
	}
	const renderedCallIds = new Set<string>();
	for (const message of messages) {
		if (message.role !== "assistant" || typeof message.content === "string") continue;
		for (const block of message.content) {
			if (block.type === "toolCall") renderedCallIds.add(block.id);
		}
	}

	// 流式增量、新消息与 Markdown 内异步高度变化都会改变内容尺寸；吸附时同步钉到底部，确保新输出可见。
	useEffect(() => {
		const container = containerRef.current;
		const content = contentRef.current;
		if (!container || !content) return;
		const observer = new ResizeObserver(() => {
			if (stickToBottom.current && !hasActiveSelection(container)) container.scrollTop = container.scrollHeight;
		});
		observer.observe(content);
		return () => observer.disconnect();
	}, []);

	function onScroll() {
		const container = containerRef.current;
		if (!container) return;
		const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
		// 仅用户主动上滚（scrollTop 变小）才可能解除吸附；内容增长撑大 distance 不算，避免流式中误判停滚。
		const scrolledUp = container.scrollTop < lastScrollTop.current - 1;
		lastScrollTop.current = container.scrollTop;
		if (scrolledUp && distance >= 96) {
			stickToBottom.current = false;
			setAtBottom(false);
		} else if (distance < 96) {
			stickToBottom.current = true;
			setAtBottom(true);
		}
	}

	return (
		<div className="relative min-h-0 flex-1">
			<div ref={containerRef} onScroll={onScroll} className="h-full overflow-y-auto px-4 py-6">
				<div ref={contentRef} className="mx-auto flex w-full max-w-3xl flex-col gap-6">
					{messages.map((message, index) => (
						<MessageRow
							key={index}
							message={message}
							tools={tools}
							results={results}
							renderedCallIds={renderedCallIds}
							forkEntryId={forkIds[index]}
							onFork={onFork}
						/>
					))}
					{streaming && <StreamingRow streaming={streaming} />}
				</div>
			</div>

			{!atBottom && (
				<IconButton
					label="回到底部"
					className="absolute bottom-4 left-1/2 -translate-x-1/2 border border-hairline border-dsw-border-l1 bg-dsw-bg-base shadow-dsw-panel"
					onClick={() => {
						const container = containerRef.current;
						if (!container) return;
						stickToBottom.current = true;
						container.scrollTop = container.scrollHeight;
						lastScrollTop.current = container.scrollTop;
						setAtBottom(true);
					}}
				>
					<ArrowDownIcon />
				</IconButton>
			)}
		</div>
	);
}
