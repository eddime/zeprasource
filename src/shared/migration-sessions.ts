import { isLocalBackupDestEmail } from "./migration-job";
import type { MigrationProgress, MigrationRecord, MigrationStatus } from "./types";

export type SessionCardStatus = "running" | "paused" | "failed" | "completed" | "cancelled";

export interface SessionCardModel {
	id: string;
	sourceEmail: string;
	destEmail: string;
	status: SessionCardStatus;
	percent?: number;
	meta?: string;
}

const ACTIVE_STATUSES: MigrationStatus[] = ["running", "paused", "failed"];

/** Messages that are done transferring (moved or gave up on this run). */
export function messagesAccountedFor(progress: MigrationProgress | undefined): number {
	if (!progress) return 0;
	return progress.messagesCompleted + (progress.messagesFailed ?? 0);
}

export function migrationPercent(progress: MigrationProgress | undefined): number {
	if (!progress) return 0;
	if (progress.messagesTotal > 0) {
		const accounted = messagesAccountedFor(progress);
		const total = progress.messagesTotal;
		if (accounted >= total) return 100;
		return Math.min(100, Math.round((accounted / total) * 100));
	}
	if (progress.foldersTotal > 0) {
		return Math.min(
			100,
			Math.round((progress.foldersCompleted / progress.foldersTotal) * 100),
		);
	}
	return 0;
}

export function formatSessionMeta(record: MigrationRecord): string {
	if (record.messagesCompleted > 0) {
		const n = record.messagesCompleted;
		if (n >= 1000) return `${(n / 1000).toFixed(1)}k msgs`;
		return `${n} msgs`;
	}
	if (record.completedAt) {
		const d = new Date(record.completedAt);
		return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
	}
	return "";
}

export function recordToProgress(record: MigrationRecord): MigrationProgress {
	return {
		migrationId: record.id,
		status: record.status,
		foldersTotal: record.foldersTotal,
		foldersCompleted: record.foldersCompleted,
		messagesTotal: record.messagesTotal,
		messagesCompleted: record.messagesCompleted,
		messagesFailed: record.messagesFailed,
		bytesTransferred: record.bytesTransferred,
		error: record.error,
		updatedAt: record.completedAt ?? record.createdAt,
	};
}

export function toSessionCard(
	record: MigrationRecord,
	progress?: MigrationProgress | null,
): SessionCardModel {
	const status = record.status as SessionCardStatus;
	const isActive = ACTIVE_STATUSES.includes(record.status);
	const destEmail =
		record.jobType === "backup" || isLocalBackupDestEmail(record.destEmail)
			? "Mac backup"
			: record.destEmail;

	return {
		id: record.id,
		sourceEmail: record.sourceEmail,
		destEmail,
		status,
		percent: isActive ? migrationPercent(progress ?? undefined) : undefined,
		meta: isActive ? undefined : formatSessionMeta(record),
	};
}

export function splitSessionLists(
	history: MigrationRecord[],
	progressById: ReadonlyMap<string, MigrationProgress>,
): { active: SessionCardModel[]; past: SessionCardModel[] } {
	const active: SessionCardModel[] = [];
	const past: SessionCardModel[] = [];

	for (const record of history) {
		if (!record.sourceEmail?.trim() || !record.destEmail?.trim()) continue;

		const card = toSessionCard(record, progressById.get(record.id) ?? null);
		if (ACTIVE_STATUSES.includes(record.status)) {
			active.push(card);
		} else if (record.status === "completed" || record.status === "cancelled") {
			past.push(card);
		}
	}

	return { active, past };
}
