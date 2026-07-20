import wait from "waait";

export const recursiveFetch = async <T>(
    prom: () => Promise<T | false>,
    attempt = 1,
    msDelay = 500,
    maxAttempts = 5,
): Promise<T> => {
    if (attempt >= maxAttempts) {
        throw new Error(
            `Failed to succeed within attempt range of ${maxAttempts}`,
        );
    } else {
        const res = await prom();
        if (res === false) {
            await wait(msDelay * attempt);
            return recursiveFetch(prom, attempt + 1, msDelay, maxAttempts);
        } else {
            return res;
        }
    }
};
