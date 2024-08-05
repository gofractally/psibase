import wait from "waait";

export const recursiveFetch = async <T>(
    prom: () => Promise<T | false>,
    attempt = 1,
    msDelay = 800,
    maxAttempts = 5
): Promise<T> => {
    if (attempt >= 5) {
        throw new Error(`Failed to success within attempt range`);
    } else {
        const res = await prom();
        if (res === false) {
            await wait(800);
            return recursiveFetch(prom, attempt + 1, msDelay, maxAttempts);
        } else {
            return res;
        }
    }
};
