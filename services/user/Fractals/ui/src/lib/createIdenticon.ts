import { identicon } from "@dicebear/collection";
import { createAvatar } from "@dicebear/core";

import { Account } from "./zod/Account";

export const createIdenticon = (seed: string): string =>
    createAvatar(identicon, {
        seed,
        size: 40,
        backgroundColor: ["black"],
        scale: 110,
    }).toDataUri();

export const generateAvatar = (chainId: string, account: Account) =>
    createIdenticon(chainId + account);
