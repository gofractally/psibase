const ALPHABET = "abcdefghijkmnopqrstuvwxyz23456789";

export const ROOM_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,31}$/;

export const createRoomId = (): string => {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join(
        "",
    );
};

export const normalizeRoomId = (raw: string): string | null => {
    const id = raw
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return ROOM_ID_PATTERN.test(id) ? id : null;
};
