import { zAccount } from "@shared/lib/schemas/account";

const ALPHABET = "abcdefghijkmnopqrstuvwxyz23456789";

export const ROOM_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,31}$/;

export const createRoomId = (): string => {
    for (;;) {
        const bytes = crypto.getRandomValues(new Uint8Array(8));
        const id = Array.from(
            bytes,
            (byte) => ALPHABET[byte % ALPHABET.length],
        ).join("");
        if (zAccount.safeParse(id).success) {
            return id;
        }
    }
};

export const normalizeRoomId = (raw: string): string | null => {
    const id = raw
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return ROOM_ID_PATTERN.test(id) ? id : null;
};
