import { Link } from "@tanstack/react-router";
import { clsx } from "clsx";
import { useEffect, useState } from "react";
import type { WorkspaceInfo } from "../../lib/api.ts";
import type { SessionSummary } from "../../server/sessions.ts";
import { Button } from "../primitives/Button.tsx";
import { IconButton } from "../primitives/IconButton.tsx";
import { PencilIcon, PlusIcon } from "../primitives/icons.tsx";
import { ThemeControl } from "./ThemeControl.tsx";

export interface SidebarProps {
	collapsed: boolean;
	drawer?: boolean;
	loading?: boolean;
	sessions: Array<SessionSummary & { owner?: string }>;
	activeId?: string;
	onNew: () => void;
	onRename: (id: string, name: string) => Promise<void>;
	runtimeStatus?: Record<string, { busy: boolean }>;
	workspaces: WorkspaceInfo[];
	workspaceId: string;
	onWorkspaceChange: (id: string) => void;
	user: { id: string; name: string; role: "admin" | "member" } | null;
	onLogout: () => void;
	isAdmin: boolean;
	adminView: boolean;
	onAdminViewChange: (value: boolean) => void;
	onShowAudit: () => void;
	hasGithubRepos?: boolean;
	onOpenIssues?: () => void;
	onShowRetention?: () => void;
	onClose?: () => void;
}

function sessionTitle(session: SessionSummary): string {
	if (session.name) return session.name;
	const first = session.firstMessage.trim().replace(/\s+/g, " ");
	if (first.length > 0) return first.length > 48 ? `${first.slice(0, 48)}…` : first;
	return session.id.slice(0, 8);
}

function formatTime(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "";
	return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function SessionItem({
	session,
	active,
	busy,
	onRename,
}: {
	session: SessionSummary & { owner?: string };
	active: boolean;
	busy: boolean;
	onRename: (id: string, name: string) => Promise<void>;
}) {
	const [renaming, setRenaming] = useState(false);
	const [value, setValue] = useState(session.name ?? "");

	useEffect(() => setValue(session.name ?? ""), [session.name]);

	async function commit() {
		const name = value.trim();
		setRenaming(false);
		if (name.length === 0 || name === (session.name ?? "")) return;
		await onRename(session.id, name);
	}

	if (renaming) {
		return (
			<form
				className="px-2 py-1"
				onSubmit={(event) => {
					event.preventDefault();
					void commit();
				}}
			>
				<input
					// biome-ignore lint/a11y/noAutofocus: 重命名输入是用户显式触发的临时状态。
					autoFocus
					value={value}
					onChange={(event) => setValue(event.target.value)}
					onBlur={() => void commit()}
					onKeyDown={(event) => {
						if (event.key === "Escape") setRenaming(false);
					}}
					className="h-8 w-full rounded-dsw-sm border border-hairline border-dsw-border-l3 bg-dsw-bg-layer-1 px-2 text-xs text-dsw-label-primary outline-none"
				/>
			</form>
		);
	}

	return (
		<div className="group relative">
			<Link
				to="/session/$sessionId"
				params={{ sessionId: session.id }}
				className={clsx(
					"flex flex-col gap-1 rounded-dsw-sm px-2 py-2 pr-8 no-underline",
					active ? "bg-dsw-bg-layer-2 text-dsw-label-primary" : "text-dsw-label-secondary hover:bg-dsw-bg-layer-2",
				)}
			>
				<span className="flex items-center gap-1.5">
					<span
						className={
							busy
								? "size-1.5 shrink-0 motion-safe:animate-pulse rounded-full bg-dsw-state-business"
								: "size-1.5 shrink-0 rounded-full bg-dsw-border-l3"
						}
					/>
					<span className="truncate text-xs leading-5">{sessionTitle(session)}</span>
					{session.parentSessionPath && (
						<span className="shrink-0 rounded-dsw-xs bg-dsw-bg-layer-2 px-1 text-[9px] text-dsw-label-tertiary">
							分叉
						</span>
					)}
				</span>
				<span className="truncate pl-3 font-mono text-[10px] text-dsw-label-tertiary">
					{session.owner ? `${session.owner} · ` : ""}
					{session.workspaceName} · {formatTime(session.modified)} · {session.messageCount} 条
				</span>
			</Link>
			<IconButton
				label="重命名会话"
				className="absolute right-1 top-1.5 size-6 opacity-0 group-hover:opacity-100"
				onClick={() => setRenaming(true)}
			>
				<PencilIcon width={12} height={12} />
			</IconButton>
		</div>
	);
}

export function Sidebar({
	collapsed,
	drawer = false,
	loading = false,
	sessions,
	activeId,
	onNew,
	onRename,
	runtimeStatus = {},
	workspaces,
	workspaceId,
	onWorkspaceChange,
	user,
	onLogout,
	isAdmin,
	adminView,
	onAdminViewChange,
	onShowAudit,
	hasGithubRepos = false,
	onOpenIssues,
	onShowRetention,
	onClose,
}: SidebarProps) {
	return (
		<aside
			className={clsx(
				"flex shrink-0 flex-col border-r border-hairline border-dsw-border-l1 bg-dsw-bg-layer-1",
				drawer ? "w-[280px] bg-dsw-bg-base" : collapsed ? "w-14" : "w-[280px]",
			)}
			aria-label="侧栏"
		>
			<div className={clsx("flex h-12 shrink-0 items-center gap-2 px-3", collapsed && "justify-center px-0")}>
				<span className="flex size-7 shrink-0 items-center justify-center rounded-dsw-sm bg-dsw-label-primary text-sm font-semibold text-dsw-label-inverted">
					π
				</span>
				{!collapsed && (
					<>
						<span className="truncate text-sm font-medium">FDE Code</span>
						<span className="ml-auto rounded-dsw-xs bg-dsw-bg-layer-2 px-1.5 py-0.5 text-[10px] text-dsw-label-tertiary">
							M1
						</span>
					</>
				)}
			</div>

			{!collapsed && workspaces.length > 0 && (
				<div className="px-2 pb-2">
					<label className="mb-1 block px-1 text-[11px] text-dsw-label-tertiary" htmlFor="workspace-select">
						工作区
					</label>
					<select
						id="workspace-select"
						value={workspaceId}
						onChange={(event) => onWorkspaceChange(event.target.value)}
						className="h-8 w-full rounded-dsw-sm border border-hairline border-dsw-border-l1 bg-dsw-bg-layer-1 px-2 text-xs text-dsw-label-primary outline-none"
					>
						{workspaces.map((workspace) => (
							<option key={workspace.id} value={workspace.id}>
								{workspace.name}
							</option>
						))}
					</select>
				</div>
			)}

			{!collapsed && hasGithubRepos && onOpenIssues && (
				<div className="px-2 pb-2">
					<Button variant="ghost" className="w-full justify-start" onClick={onOpenIssues}>
						GitHub Issues
					</Button>
				</div>
			)}

			<div className={clsx("px-2", collapsed && "flex justify-center px-0")}>
				{collapsed ? (
					<IconButton label="新建会话" onClick={onNew}>
						<PlusIcon />
					</IconButton>
				) : (
					<Button variant="secondary" className="w-full justify-start" onClick={onNew}>
						<PlusIcon />
						新建会话
					</Button>
				)}
			</div>

			{!collapsed && (
				<div className="mt-4 flex min-h-0 flex-1 flex-col gap-1 px-2">
					<span className="px-1 text-xs text-dsw-label-tertiary">会话</span>
					<div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pb-2">
						{sessions.length === 0 ? (
							<div className="rounded-dsw-md border border-hairline border-dsw-border-l1 bg-dsw-bg-layer-2 px-3 py-6 text-center text-xs leading-5 text-dsw-label-secondary">
								{loading ? "正在加载会话…" : "还没有会话"}
							</div>
						) : (
							sessions.map((session) => (
								<SessionItem
									key={session.id}
									session={session}
									active={session.id === activeId}
									busy={runtimeStatus[session.id]?.busy ?? false}
									onRename={onRename}
								/>
							))
						)}
					</div>
				</div>
			)}

			{!collapsed && isAdmin && (
				<div className="flex flex-col gap-1 border-t border-hairline border-dsw-border-l1 p-2">
					<label className="flex items-center gap-2 px-1 text-[11px] text-dsw-label-secondary">
						<input
							type="checkbox"
							checked={adminView}
							onChange={(event) => onAdminViewChange(event.target.checked)}
						/>
						全部会话
					</label>
					<button
						type="button"
						onClick={onShowAudit}
						className="rounded-dsw-xs px-1 py-0.5 text-left text-[11px] text-dsw-label-tertiary hover:text-dsw-label-primary"
					>
						审计记录
					</button>
					{onShowRetention && (
						<button
							type="button"
							onClick={onShowRetention}
							className="rounded-dsw-xs px-1 py-0.5 text-left text-[11px] text-dsw-label-tertiary hover:text-dsw-label-primary"
						>
							保留清理
						</button>
					)}
				</div>
			)}

			<div
				className={clsx(
					"mt-auto flex flex-col gap-3 border-t border-hairline border-dsw-border-l1 p-3",
					collapsed && "items-center px-0",
				)}
			>
				<ThemeControl collapsed={collapsed} />
				{!collapsed && user && user.id !== "local" && (
					<div className="flex items-center gap-2 text-[11px] text-dsw-label-tertiary">
						<span className="truncate">{user.name}</span>
						<button
							type="button"
							onClick={onLogout}
							className="ml-auto rounded-dsw-xs px-1.5 py-0.5 hover:text-dsw-label-primary"
						>
							退出
						</button>
					</div>
				)}
				{!collapsed && drawer && (
					<Button variant="ghost" className="w-full justify-start" onClick={onClose}>
						关闭侧栏
					</Button>
				)}
			</div>
		</aside>
	);
}
