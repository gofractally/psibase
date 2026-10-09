export const CLIENT_KEY_TO_BASE64 = {
    alphabet: "base64url",
    omitPadding: true,
} as const satisfies Uint8ArrayToBase64Options;

export const CLIENT_KEY_FROM_BASE64 = {
    alphabet: "base64url",
} as const satisfies Uint8ArrayFromBase64Options;
