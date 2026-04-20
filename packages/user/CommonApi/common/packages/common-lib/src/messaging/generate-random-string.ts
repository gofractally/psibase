export const generateRandomString = (): string => {
    const chars = "0123456789abcdef";
    let randomString = "";

    for (let i = 0; i < 32; i++) {
        const randomIndex = Math.floor(Math.random() * chars.length);
        randomString += chars[randomIndex];
    }

    return randomString;
};
