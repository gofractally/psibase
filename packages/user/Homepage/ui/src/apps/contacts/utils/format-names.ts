export const formatNames = (
    nickname: string | undefined,
    displayName: string | undefined,
    account: string,
): [primaryName: string, secondaryName: string | undefined] => {
    const accountAt = "@" + account;
    if (!nickname && !displayName) {
        return [accountAt, undefined];
    }

    const firstPart = nickname || displayName || accountAt;

    return [firstPart, firstPart ? accountAt : undefined];
};
