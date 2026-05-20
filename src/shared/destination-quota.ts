import { formatBytes } from "./pricing";

/** Headroom for metadata, append overhead, and size estimate drift. */
const BUFFER_RATIO = 0.05;
const MIN_BUFFER_BYTES = 50 * 1024 * 1024;

export type DestinationQuotaStatus =
	| "ok"
	| "insufficient_storage"
	| "insufficient_messages"
	| "unsupported";

export interface QuotaUsage {
	used: number;
	limit: number;
}

export interface DestinationQuotaCheck {
	status: DestinationQuotaStatus;
	requiredBytes: number;
	requiredMessages: number;
	requiredBytesWithBuffer: number;
	availableBytes?: number;
	usedBytes?: number;
	limitBytes?: number;
	availableMessages?: number;
	usedMessages?: number;
	messageLimit?: number;
	summary: string;
}

export function requiredBytesWithBuffer(bytes: number): number {
	if (bytes <= 0) return MIN_BUFFER_BYTES;
	return bytes + Math.max(MIN_BUFFER_BYTES, Math.ceil(bytes * BUFFER_RATIO));
}

export function evaluateDestinationQuota(
	quota: { storage?: QuotaUsage; messages?: QuotaUsage },
	required: { bytes: number; messages: number },
): DestinationQuotaCheck {
	const bytesNeeded = requiredBytesWithBuffer(required.bytes);
	const base: DestinationQuotaCheck = {
		status: "ok",
		requiredBytes: required.bytes,
		requiredMessages: required.messages,
		requiredBytesWithBuffer: bytesNeeded,
		summary: "Destination mailbox has enough space.",
	};

	const hasStorage = quota.storage && quota.storage.limit > 0;
	const hasMessages = quota.messages && quota.messages.limit > 0;

	if (!hasStorage && !hasMessages) {
		return {
			...base,
			status: "unsupported",
			summary:
				"Your destination server does not report mailbox quota via IMAP. Confirm free space in the destination account before migrating.",
		};
	}

	if (hasStorage && quota.storage) {
		const { used, limit } = quota.storage;
		const available = Math.max(0, limit - used);
		base.usedBytes = used;
		base.limitBytes = limit;
		base.availableBytes = available;

		if (available < bytesNeeded) {
			return {
				...base,
				status: "insufficient_storage",
				summary: `Not enough space on the destination mailbox: about ${formatBytes(bytesNeeded)} needed (including buffer), but only ${formatBytes(available)} free (${formatBytes(used)} of ${formatBytes(limit)} used).`,
			};
		}
	}

	if (hasMessages && quota.messages) {
		const { used, limit } = quota.messages;
		const available = Math.max(0, limit - used);
		base.usedMessages = used;
		base.messageLimit = limit;
		base.availableMessages = available;

		if (required.messages > 0 && available < required.messages) {
			return {
				...base,
				status: "insufficient_messages",
				summary: `Destination message limit exceeded: ${required.messages.toLocaleString()} messages to migrate, but only ${available.toLocaleString()} slots free (${used.toLocaleString()} of ${limit.toLocaleString()} used).`,
			};
		}
	}

	if (hasStorage && quota.storage) {
		const available = Math.max(0, quota.storage.limit - quota.storage.used);
		base.summary = `Destination has ${formatBytes(available)} free (${formatBytes(quota.storage.used)} of ${formatBytes(quota.storage.limit)} used). Migration needs about ${formatBytes(bytesNeeded)}.`;
	}

	return base;
}

export function isDestinationQuotaBlocked(status: DestinationQuotaStatus): boolean {
	return status === "insufficient_storage" || status === "insufficient_messages";
}
