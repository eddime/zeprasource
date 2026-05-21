export type UidFetchMeta = {
	uid: number;
	sizeBytes?: number;
};

/** Group UIDs so each batch stays under a byte budget (and optional count cap). */
export function buildUidBatchesByByteBudget(
	items: UidFetchMeta[],
	maxBytes: number,
	maxCount: number,
): number[][] {
	if (items.length === 0) return [];
	const unknownSizeBytes = 256 * 1024;
	const batches: number[][] = [];
	let current: number[] = [];
	let currentBytes = 0;

	const flush = () => {
		if (current.length === 0) return;
		batches.push(current);
		current = [];
		currentBytes = 0;
	};

	for (const item of items) {
		const size = item.sizeBytes && item.sizeBytes > 0 ? item.sizeBytes : unknownSizeBytes;
		if (
			current.length > 0 &&
			(current.length >= maxCount || currentBytes + size > maxBytes)
		) {
			flush();
		}
		current.push(item.uid);
		currentBytes += size;
	}
	flush();
	return batches;
}

export function buildUidBatchesByCount(uids: number[], maxCount: number): number[][] {
	if (uids.length === 0) return [];
	const batches: number[][] = [];
	for (let i = 0; i < uids.length; i += maxCount) {
		batches.push(uids.slice(i, i + maxCount));
	}
	return batches;
}
