const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));


export const mockDelay = <T>(toReturn: T, delayMs: number = 1000) => async (): Promise<T> => {
    await wait(delayMs);
    return toReturn
}