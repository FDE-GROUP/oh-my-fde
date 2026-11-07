import { clsx } from "clsx";
import { useState } from "react";
import type { ToolExecution } from "../../lib/conversation.ts";

export interface ToolCardProps {
	callId: string;
	name: string;
	args: unknown;
	execution?: ToolExecution;
	result?: { text: string; isError: boolean; durationMs?: number };
}

function looksLikeDiff(text: string): boolean {
	return text.startsWith("diff --git") || /^@@ .* @@/m.test(text) || /^--- .+\n\+\+\+ /m.test(text);
}

function DiffView({ text }: { text: string }) {
	return (
		<pre className="overflow-x-auto p-3 font-mono text-xs leading-5">
			{text.split("\n").map((line, index) => (
				<div
					// biome-ignore lint/suspicious/noArrayIndexKey: diff 行没有稳定标识。
					key={index}
					className={clsx(
						"whitespace-pre",
						line.startsWith("+") && !line.startsWith("+++") && "bg-dsw-bg-layer-2 text-dsw-state-success",
						line.startsWith("-") && !line.startsWith("---") && "bg-dsw-bg-layer-2 text-dsw-state-error",
						line.startsWith("@@") && "text-dsw-state-business",
					)}
				>
					{line.length > 0 ? line : " "}
				</div>
			))}
		</pre>
	);
}

function OutputView({ text }: { text: string }) {
	const [expanded, setExpanded] = useState(false);
	const lines = text.split("\n");
	const long = lines.length > 14;
	const shown = long && !expanded ? lines.slice(0, 14).join("\n") : text;

	if (looksLikeDiff(text)) return <DiffView text={text} />;

	return (
		<div className="flex flex-col">
			<pre
				className={clsx(
					"overflow-x-auto whitespace-pre-wrap break-words p-3 font-mono text-xs leading-5 text-dsw-label-secondary",
					long && !expanded && "max-h-64 overflow-y-hidden",
				)}
			>
				{shown}
			</pre>
			{long && (
				<button
					type="button"
					className=" w-fit border-t border-hairline border-dsw-border-l1 px-3 py-1.5 text-left text-[11px] text-dsw-label-tertiary hover:text-dsw-label-primary"
					onClick={() => setExpanded((current) => !current)}
				>
					{expanded ? "收起" : `展开全部（${lines.length} 行）`}
				</button>
			)}
		</div>
	);
}

function statusLabel(status: ToolExecution["status"]): string {
	if (status === "running") return "运行中";
	if (status === "error") return "失败";
	return "完成";
}

export function ToolCard({ callId, name, args, execution, result }: ToolCardProps) {
	const status = execution?.status ?? (result?.isError ? "error" : "done");
	const output = execution?.output || execution?.partialOutput || result?.text || "";
	const durationMs = execution?.durationMs ?? result?.durationMs;
	const shownArgs = execution?.args ?? args;

	return (
		<div
			className={clsx(
				"overflow-hidden rounded-dsw-card border bg-dsw-bg-layer-1",
				status === "error" ? "border-dsw-state-error" : "border-dsw-border-l1",
			)}
		>
			<div className="flex items-center gap-2 border-b border-hairline border-dsw-border-l1 px-3 py-2">
				<span
					className={clsx(
						"size-1.5 rounded-full",
						status === "running" && "motion-safe:animate-pulse bg-dsw-state-business",
						status === "error" && "bg-dsw-state-error",
						status === "done" && "bg-dsw-state-success",
					)}
				/>
				<span className="font-mono text-xs text-dsw-label-primary">{name}</span>
				<span className="text-[11px] text-dsw-label-tertiary">{statusLabel(status)}</span>
				{typeof durationMs === "number" && (
					<span className="ml-auto font-mono text-[11px] text-dsw-label-tertiary">{durationMs}ms</span>
				)}
				<span className="font-mono text-[10px] text-dsw-label-tertiary">{callId.slice(-6)}</span>
			</div>

			{shownArgs !== undefined && shownArgs !== null && (
				<details className="border-b border-hairline border-dsw-border-l1">
					<summary className="cursor-pointer select-none px-3 py-1.5 text-[11px] text-dsw-label-tertiary">
						参数
					</summary>
					<pre className="max-h-48 overflow-auto px-3 pb-3 font-mono text-[11px] leading-5 text-dsw-label-secondary">
						{JSON.stringify(shownArgs, null, 2)}
					</pre>
				</details>
			)}

			{output.length > 0 ? (
				<OutputView text={output} />
			) : (
				status === "running" && <p className="px-3 py-2 text-[11px] text-dsw-label-tertiary">等待输出…</p>
			)}
		</div>
	);
}
