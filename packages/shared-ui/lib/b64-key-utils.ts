export const b64ToPem = (b64: string) => {
    const header = "-----BEGIN PRIVATE KEY-----";
    const footer = "-----END PRIVATE KEY-----";
    const lines = b64.match(/.{1,64}/g) || [];
    return [header, ...lines, footer].join("\n");
};

export const pemToB64 = (pem: string) => {
    const b64 = pem
        .replace(/-----BEGIN PRIVATE KEY-----/g, "")
        .replace(/-----END PRIVATE KEY-----/g, "")
        .replace(/\n/g, "");
    return b64;
};

export const validateB64 = (b64: string) => {
    if (!/^[A-Za-z0-9+/]*=*$/.test(b64)) return false;
    try {
        atob(b64);
        return true;
    } catch {
        return false;
    }
};
