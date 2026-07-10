// Serialize async work so only one job runs at a time (async mutex).
// Next job always waits for the previous to finish, whether it succeeded or threw.
let queue: Promise<void> = Promise.resolve();

export function serialize<T>(fn: () => Promise<T>): Promise<T> {
    const previous = queue;

    let release!: () => void;
    queue = new Promise<void>((resolve) => {
        release = resolve;
    });

    return (async () => {
        await previous;
        try {
            return await fn();
        } finally {
            release();
        }
    })();
}
