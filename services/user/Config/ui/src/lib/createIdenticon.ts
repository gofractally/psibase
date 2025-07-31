import { identicon } from "@dicebear/collection";
import { createAvatar } from "@dicebear/core";
import { z } from "zod";

import { zAccount } from "./zod/Account";

export const createIdenticon = (seed: string): string =>
    createAvatar(identicon, {
        seed,
        size: 40,
        backgroundColor: ["black"],
        scale: 110,
    }).toDataUri();

export const generateAvatar = (
    chainId: string,
    account: z.infer<typeof zAccount>,
) => createIdenticon(chainId + account);
