// Async serializer pattern:
// https://advancedweb.hu/how-to-serialize-calls-to-an-async-function/
let queue: Promise<void> = Promise.resolve();

export function serialize<T>(fn: () => Promise<T>): Promise<T> {
    const res = queue.catch(() => { }).then(() => fn());
    queue = res.then(
        () => { },
        () => { },
    );
    return res;
}
