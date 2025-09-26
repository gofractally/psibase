import { identicon } from "@dicebear/collection";
import { createAvatar } from "@dicebear/core";
import { z } from "zod";

import { zAccount } from "./schemas/account";

export const createIdenticon = (seed: string): string =>
    createAvatar(identicon, {
        seed,
        size: 40,
        backgroundColor: ["27272a"],
        scale: 110,
    }).toDataUri();

export const generateAvatar = (
    chainId: string,
    account: z.infer<typeof zAccount>,
) => createIdenticon(chainId + account);
