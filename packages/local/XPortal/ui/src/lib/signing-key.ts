export interface SigningKey {
    publicKeyPem: string;
    privateKeyPem: string;
}

const toPem = (label: "PUBLIC KEY" | "PRIVATE KEY", der: ArrayBuffer) => {
    const base64 = btoa(String.fromCharCode(...new Uint8Array(der)));
    const lines = base64.match(/.{1,64}/g)!.join("\n");
    return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----\n`;
};

/** A new ECDSA P-256 key: SPKI public and PKCS#8 private, both PEM. */
export const generateSigningKey = async (): Promise<SigningKey> => {
    const pair = await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["sign", "verify"],
    );
    const [spki, pkcs8] = await Promise.all([
        crypto.subtle.exportKey("spki", pair.publicKey),
        crypto.subtle.exportKey("pkcs8", pair.privateKey),
    ]);
    return {
        publicKeyPem: toPem("PUBLIC KEY", spki),
        privateKeyPem: toPem("PRIVATE KEY", pkcs8),
    };
};
