/** Bounded queue: FETCH producers enqueue batches while APPEND worker drains. */
export class TransferBatchQueue<T> {
	private readonly maxDepth: number;
	private items: T[] = [];
	private closed = false;
	private waiters: Array<(value: T | null) => void> = [];

	constructor(maxDepth: number) {
		this.maxDepth = Math.max(1, maxDepth);
	}

	get depth(): number {
		return this.items.length;
	}

	private wakeNext(): void {
		if (this.waiters.length === 0 || this.items.length === 0) return;
		const waiter = this.waiters.shift()!;
		const item = this.items.shift()!;
		waiter(item);
	}

	async push(item: T): Promise<void> {
		if (this.closed) {
			throw new Error("Transfer queue is closed");
		}
		while (this.items.length >= this.maxDepth && !this.closed) {
			await new Promise<void>((resolve) => {
				const check = () => {
					if (this.items.length < this.maxDepth || this.closed) {
						resolve();
						return;
					}
					setTimeout(check, 25);
				};
				check();
			});
		}
		if (this.closed) {
			throw new Error("Transfer queue is closed");
		}
		this.items.push(item);
		this.wakeNext();
	}

	async take(): Promise<T | null> {
		if (this.items.length > 0) {
			return this.items.shift()!;
		}
		if (this.closed) return null;
		return new Promise<T | null>((resolve) => {
			this.waiters.push(resolve);
		});
	}

	close(): void {
		this.closed = true;
		while (this.waiters.length > 0) {
			const waiter = this.waiters.shift()!;
			waiter(null);
		}
	}
}

export async function mapWithConcurrency<T>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<void>,
	shouldAbort?: () => boolean,
): Promise<void> {
	if (items.length === 0) return;
	const concurrency = Math.max(1, Math.min(limit, items.length));
	const executing = new Set<Promise<void>>();

	for (const item of items) {
		if (shouldAbort?.()) break;
		const task = fn(item).finally(() => executing.delete(task));
		executing.add(task);
		if (executing.size >= concurrency) {
			await Promise.race(executing);
		}
	}
	await Promise.all(executing);
}
