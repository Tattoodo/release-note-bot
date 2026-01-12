/**
 * A queue that ensures only one operation runs at a time for a given key,
 * with at most one pending operation. Subsequent operations are skipped.
 */
export class SinglePendingPromiseQueue {
	private active = new Map<string, Promise<unknown>>();
	private next = new Map<string, () => Promise<unknown>>();

	async add<T>(key: string, task: () => Promise<T>): Promise<T | void> {
		if (this.active.has(key)) {
			if (this.next.has(key)) {
				console.log(`[SinglePendingPromiseQueue] Skipping task for ${key} because one is already waiting.`);
				return Promise.resolve();
			}

			console.log(`[SinglePendingPromiseQueue] Queuing task for ${key}.`);
			return new Promise<T>((resolve, reject) => {
				this.next.set(key, async () => {
					try {
						const result = await task();
						resolve(result);
						return result;
					} catch (error) {
						reject(error);
						throw error;
					}
				});
			});
		}

		return this.run(key, task);
	}

	private async run<T>(key: string, task: () => Promise<T>): Promise<T> {
		const promise = task();
		this.active.set(key, promise);

		try {
			const result = await promise;
			return result;
		} finally {
			this.active.delete(key);
			this.processNext(key);
		}
	}

	private processNext(key: string) {
		const nextTask = this.next.get(key);
		if (nextTask) {
			this.next.delete(key);
			this.run(key, nextTask);
		}
	}
}

export const prQueue = new SinglePendingPromiseQueue();
