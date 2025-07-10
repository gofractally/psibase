import { identicon } from "@dicebear/collection";
import { createAvatar } from "@dicebear/core";

export const createIdenticon = (seed: string): string =>
    createAvatar(identicon, {
        seed,
        size: 40,
        backgroundColor: ["black"],
        scale: 110,
    }).toDataUri();

export const generateAvatar = (chainId: string, account: string) =>
    createIdenticon(chainId + account);
