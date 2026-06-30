// Async serializer pattern:
// https://advancedweb.hu/how-to-serialize-calls-to-an-async-function/
let queue: Promise<unknown> = Promise.resolve();

export function serialize<T>(fn: () => Promise<T>): Promise<T> {
    const res = queue.then(() => fn());
    queue = res.catch(() => {});
    return res;
}
