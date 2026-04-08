export const calculateIndex = (
    packagesLength: number,
    currentTx: number,
    totalTransactions: number,
) => {
    const percentProgressed = currentTx / totalTransactions;
    return Math.floor(percentProgressed * (packagesLength - 1));
};
