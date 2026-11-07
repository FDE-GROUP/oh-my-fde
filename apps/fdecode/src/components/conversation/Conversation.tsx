import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
	type CiStatus,
	cloneSession,
	createSession,
	expandProjectFiles,
	fetchCiStatus,
	fetchIssueLink,
	forkSession,
	openEventStream,
	resumeSession,
	searchProjectFiles,
	sendCommand,
} from "../../lib/api.ts";
import { type ConversationMessage, conversationReducer, initialConversationState } from "../../lib/conversation.ts";
import type { ImageAttachment } from "../../lib/images.ts";
import { pushNotification } from "../../lib/notifications.ts";
import type { Health } from "../../server/health.ts";
import type { RpcSessionStats } from "../../server/runtime.ts";
import { type CommandSummary, Composer, type QueueMode } from "./Composer.tsx";
import { ConversationPlaceholder } from "./ConversationPlaceholder.tsx";
import { type GovernanceEvent, governanceEventFromRecord } from "./GovernancePanel.tsx";
import {
	type MechanismEvent,
	mechanismEventFromRecord,
	mechanismEventsFromEntries,
} from "./MechanismTimelinePanel.tsx";
import { MessageList } from "./MessageList.tsx";
import { type ModelSummary, SessionBar } from "./SessionBar.tsx";

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export interface ConversationProps {
	health: Health;
	sessionId?: string;
	onSessionCreated: (id: string) => void;
	onSessionSwitch: (id: string) => void;
	readOnly?: boolean;
}

export function Conversation({
	health,
	sessionId,
	onSessionCreated,
	onSessionSwitch,
	readOnly = false,
}: ConversationProps) {
	const [conversation, dispatch] = useReducer(conversationReducer, initialConversationState);
	const [activeId, setActiveId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const [models, setModels] = useState<ModelSummary[]>([]);
	const [model, setModel] = useState<ModelSummary | null>(null);
	const [stats, setStats] = useState<RpcSessionStats | null>(null);
	const [notices, setNotices] = useState<Array<{ id: number; message: string; type: string }>>([]);
	const [crashed, setCrashed] = useState(false);
	const [connectionNonce, setConnectionNonce] = useState(0);
	const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
	const [commands, setCommands] = useState<CommandSummary[]>([]);
	const [forkMessages, setForkMessages] = useState<Array<{ entryId: string; text: string }>>([]);
	const [initialDraft, setInitialDraft] = useState("");
	const [issue, setIssue] = useState<{ number: number; title: string; url: string; repoId: string } | null>(null);
	const [ci, setCi] = useState<CiStatus | null>(null);
	const [timeline, setTimeline] = useState<MechanismEvent[]>([]);
	const [governance, setGovernance] = useState<GovernanceEvent[]>([]);
	const noticeId = useRef(0);
	const activeIdRef = useRef<string | null>(null);

	useEffect(() => {
		if (notices.length === 0) return;
		const timer = setTimeout(() => setNotices((current) => current.slice(1)), 5000);
		return () => clearTimeout(timer);
	}, [notices]);

	useEffect(() => {
		activeIdRef.current = activeId;
	}, [activeId]);

	useEffect(() => {
		if (!sessionId) {
			setActiveId(null);
			dispatch({ type: "reset" });
			return;
		}
		let cancelled = false;
		setError(null);
		dispatch({ type: "reset" });
		setAttachments([]);
		setCommands([]);
		setForkMessages([]);
		setTimeline([]);
		setGovernance([]);
		resumeSession(sessionId)
			.then((created) => {
				if (!cancelled) setActiveId(created.id);
			})
			.catch((caught) => {
				if (!cancelled) setError(errorText(caught));
			});
		return () => {
			cancelled = true;
		};
	}, [sessionId]);

	useEffect(() => {
		if (!activeId) return;
		let cancelled = false;
		sendCommand(activeId, { type: "get_available_models" })
			.then((response) => {
				if (cancelled) return;
				const list = (response as { models: ModelSummary[] }).models ?? [];
				setModels(
					list.map((item) => ({
						provider: item.provider,
						id: item.id,
						name: item.name,
					})),
				);
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [activeId]);

	useEffect(() => {
		if (!activeId) return;
		setInitialDraft(window.sessionStorage.getItem(`fdecode-draft:${activeId}`) ?? "");
		window.sessionStorage.removeItem(`fdecode-draft:${activeId}`);
	}, [activeId]);

	// 回填机制时间线的历史压缩；与切换会话后已收到的实时事件合并。
	useEffect(() => {
		if (!activeId) return;
		let cancelled = false;
		sendCommand(activeId, { type: "get_entries" })
			.then((response) => {
				if (cancelled) return;
				const entries = (response as { entries?: Array<Record<string, unknown>> }).entries ?? [];
				setTimeline((current) => [
					...mechanismEventsFromEntries(entries),
					...current.filter((event) => event.source === "live"),
				]);
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [activeId]);

	useEffect(() => {
		if (!activeId) {
			setIssue(null);
			setCi(null);
			return;
		}
		let cancelled = false;
		let timer: NodeJS.Timeout | undefined;
		fetchIssueLink(activeId)
			.then((link) => {
				if (cancelled) return;
				setIssue(link);
				if (!link) {
					setCi(null);
					return;
				}
				const load = () => {
					fetchCiStatus(link.repoId)
						.then((status) => {
							if (!cancelled) setCi(status);
						})
						.catch(() => undefined);
				};
				load();
				timer = setInterval(load, 60_000);
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
			if (timer) clearInterval(timer);
		};
	}, [activeId]);

	useEffect(() => {
		if (!activeId) return;
		let cancelled = false;
		sendCommand(activeId, { type: "get_commands" })
			.then((response) => {
				if (cancelled) return;
				const list = (response as { commands: CommandSummary[] }).commands ?? [];
				setCommands(list);
			})
			.catch(() => undefined);
		sendCommand(activeId, { type: "get_fork_messages" })
			.then((response) => {
				if (cancelled) return;
				const list = (response as { messages: Array<{ entryId: string; text: string }> }).messages ?? [];
				setForkMessages(list);
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [activeId]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: connectionNonce 用于崩溃后强制重建事件流。
	useEffect(() => {
		if (!activeId) return;
		return openEventStream(activeId, {
			onSnapshot: (snapshot) => {
				setError(null);
				setCrashed(false);
				setStats(snapshot.stats);
				setModel(
					snapshot.state.model
						? {
								provider: snapshot.state.model.provider,
								id: snapshot.state.model.id,
								name: snapshot.state.model.name,
								input: snapshot.state.model.input,
							}
						: null,
				);
				dispatch({
					type: "snapshot",
					messages: snapshot.messages as ConversationMessage[],
					isStreaming: snapshot.state.isStreaming,
					streaming: snapshot.streaming,
				});
			},
			onEvent: (event) => {
				if (event.kind === "record") {
					dispatch({ type: "event", event: event.record });
					const mechanism = mechanismEventFromRecord(event.record as Record<string, unknown>);
					if (mechanism) {
						setTimeline((current) => [...current.slice(-499), mechanism]);
					}
					const governanceEvent = governanceEventFromRecord(event.record as Record<string, unknown>);
					if (governanceEvent) {
						setGovernance((current) => [...current.slice(-499), governanceEvent]);
					}
					if (
						event.record.type === "extension_ui_request" &&
						event.record.method === "notify" &&
						typeof event.record.message === "string"
					) {
						const type = typeof event.record.notifyType === "string" ? event.record.notifyType : "info";
						setNotices((current) => [
							...current.slice(-3),
							{ id: ++noticeId.current, message: String(event.record.message), type },
						]);
					}
					if (event.record.type === "agent_settled") {
						const aborted = event.record.aborted === true;
						pushNotification(
							aborted ? "任务已中止" : "任务完成",
							issue ? `Issue #${issue.number}：${issue.title}` : `会话 ${activeId.slice(0, 8)}`,
						);
						sendCommand(activeId, { type: "get_session_stats" })
							.then((response) => setStats(response as RpcSessionStats))
							.catch(() => undefined);
						sendCommand(activeId, { type: "get_fork_messages" })
							.then((response) => {
								const list =
									(response as { messages: Array<{ entryId: string; text: string }> }).messages ?? [];
								setForkMessages(list);
							})
							.catch(() => undefined);
					}
				}
				if (event.kind === "status" && event.status === "exited") {
					setCrashed(true);
					setError(event.error ? `Pi 已退出：${event.error}` : "Pi 已退出");
				}
				if (event.kind === "exit") {
					setCrashed(true);
					setError(event.error ? `Pi 已退出：${event.error}` : "Pi 已退出");
					pushNotification("会话异常", event.error ?? activeId.slice(0, 8));
				}
			},
			onConnectionError: () => setError("事件流连接中断，正在重试…"),
			onFatal: () => {
				setCrashed(true);
				setError("会话运行时已回收或不可用，请重新启动");
			},
			onGap: () => setConnectionNonce((current) => current + 1),
		});
	}, [activeId, connectionNonce]);

	const ensureSession = useCallback(async (): Promise<string> => {
		if (activeIdRef.current) return activeIdRef.current;
		setCreating(true);
		try {
			const created = await createSession();
			activeIdRef.current = created.id;
			setActiveId(created.id);
			onSessionCreated(created.id);
			return created.id;
		} finally {
			setCreating(false);
		}
	}, [onSessionCreated]);

	const send = useCallback(
		async (text: string, mode: QueueMode, images: ImageAttachment[]): Promise<boolean> => {
			setError(null);
			try {
				const id = await ensureSession();
				const payload = images.map((image) => ({
					type: "image" as const,
					mimeType: image.mimeType,
					data: image.data,
				}));
				if (conversation.status === "streaming") {
					await sendCommand(
						id,
						mode === "followUp"
							? { type: "follow_up", message: text, images: payload }
							: { type: "steer", message: text, images: payload },
					);
				} else {
					await sendCommand(id, { type: "prompt", message: text, images: payload });
				}
				return true;
			} catch (caught) {
				setError(errorText(caught));
				return false;
			}
		},
		[conversation.status, ensureSession],
	);
	const abort = useCallback(async () => {
		const id = activeIdRef.current;
		if (!id) return;
		try {
			await sendCommand(id, { type: "abort" });
		} catch (caught) {
			setError(errorText(caught));
		}
	}, []);

	const restart = useCallback(async () => {
		const id = activeIdRef.current;
		if (!id) return;
		setError(null);
		try {
			await resumeSession(id);
			setCrashed(false);
			setConnectionNonce((current) => current + 1);
		} catch (caught) {
			setCrashed(true);
			setError(errorText(caught));
		}
	}, []);

	const selectModel = useCallback(async (provider: string, id: string) => {
		const session = activeIdRef.current;
		if (!session) return;
		try {
			const selected = (await sendCommand(session, { type: "set_model", provider, modelId: id })) as {
				provider: string;
				id: string;
				name: string;
				input: string[];
			};
			setModel({
				provider: selected.provider,
				id: selected.id,
				name: selected.name,
				input: selected.input,
			});
		} catch (caught) {
			setError(errorText(caught));
		}
	}, []);

	const handleFork = useCallback(
		async (entryId: string) => {
			const id = activeIdRef.current;
			if (!id) return;
			setError(null);
			try {
				const created = await forkSession(id, entryId);
				onSessionSwitch(created.id);
			} catch (caught) {
				setError(errorText(caught));
			}
		},
		[onSessionSwitch],
	);

	const handleClone = useCallback(async () => {
		const id = activeIdRef.current;
		if (!id) return;
		setError(null);
		try {
			const created = await cloneSession(id);
			onSessionSwitch(created.id);
		} catch (caught) {
			setError(errorText(caught));
		}
	}, [onSessionSwitch]);

	const addNotes = useCallback((notes: string[]) => {
		if (notes.length === 0) return;
		setNotices((current) => [
			...current.slice(-3),
			...notes.map((note) => ({ id: ++noticeId.current, message: note, type: "warning" })),
		]);
	}, []);

	const streaming = conversation.status === "streaming";
	const empty = conversation.messages.length === 0 && !streaming;

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{issue && (
				<div className="border-b border-hairline border-dsw-border-l1 bg-dsw-bg-layer-1 px-4 py-1.5 text-xs">
					<a href={issue.url} target="_blank" rel="noreferrer" className="text-dsw-link">
						Issue #{issue.number}：{issue.title}
					</a>
				</div>
			)}

			{error && (
				<div className="flex items-center gap-3 border-b border-hairline border-dsw-border-l1 bg-dsw-bg-layer-1 px-4 py-2 text-xs text-dsw-state-error">
					<span className="min-w-0 flex-1">{error}</span>
					{crashed && (
						<button
							type="button"
							className="shrink-0 rounded-dsw-xs border border-dsw-border-l2 px-2 py-0.5 text-dsw-label-primary"
							onClick={() => void restart()}
						>
							重新启动
						</button>
					)}
				</div>
			)}

			{empty ? (
				<div className="flex min-h-0 flex-1 overflow-auto">
					<ConversationPlaceholder health={health} />
				</div>
			) : (
				// key 绑定 activeId：切换会话时重挂载 MessageList，重置“吸附底部”的跟随状态。
				<MessageList
					key={activeId ?? "conversation"}
					messages={conversation.messages}
					streaming={conversation.streaming}
					tools={conversation.tools}
					forkMessages={readOnly ? [] : forkMessages}
					onFork={readOnly ? undefined : (entryId) => void handleFork(entryId)}
				/>
			)}

			{readOnly ? (
				<div className="border-t border-hairline border-dsw-border-l1 px-4 py-2 text-center text-[11px] text-dsw-label-tertiary">
					管理员只读视图，不能发送或修改会话
				</div>
			) : (
				<>
					<Composer
						disabled={creating}
						streaming={streaming}
						queued={conversation.queue.steering.length + conversation.queue.followUp.length}
						supportsImages={model?.input?.includes("image") ?? false}
						commands={commands}
						initialDraft={initialDraft}
						attachments={attachments}
						onAttachmentsChange={setAttachments}
						onSearchFiles={(query) => (activeId ? searchProjectFiles(activeId, query) : Promise.resolve([]))}
						onExpandFiles={(paths) =>
							activeId
								? expandProjectFiles(activeId, paths)
								: Promise.resolve({ text: "", images: [], notes: ["先发送一条消息创建会话，再引用文件"] })
						}
						onNotes={addNotes}
						onSend={send}
						onAbort={abort}
					/>
					<SessionBar
						models={models}
						model={model}
						stats={stats}
						onSelectModel={selectModel}
						onClone={() => void handleClone()}
						canClone={conversation.messages.length > 0}
						sessionId={activeId ?? undefined}
						ci={ci}
						canWrite
						timeline={timeline}
						governance={governance}
					/>
				</>
			)}

			{notices.length > 0 && (
				<div className="pointer-events-none fixed right-4 top-14 z-50 flex w-80 flex-col gap-2">
					{notices.map((notice) => (
						<div
							key={notice.id}
							className={
								notice.type === "error"
									? "rounded-dsw-card border border-dsw-state-error bg-dsw-bg-base px-3 py-2 text-xs text-dsw-state-error shadow-dsw-panel"
									: notice.type === "warning"
										? "rounded-dsw-card border border-dsw-state-warn bg-dsw-bg-base px-3 py-2 text-xs text-dsw-state-warn shadow-dsw-panel"
										: "rounded-dsw-card border border-dsw-border-l1 bg-dsw-bg-base px-3 py-2 text-xs text-dsw-label-secondary shadow-dsw-panel"
							}
						>
							{notice.message}
						</div>
					))}
				</div>
			)}
		</div>
	);
}
