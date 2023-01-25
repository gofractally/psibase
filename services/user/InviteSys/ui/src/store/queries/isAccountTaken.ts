const wait = (ms: number = 500) =>
    new Promise((resolve) => setTimeout(resolve, ms));

export const isAccountAvailable = async (
    accountName: string
): Promise<boolean> => {
    await wait(1000);
    return Math.random() < 0.5;
};
