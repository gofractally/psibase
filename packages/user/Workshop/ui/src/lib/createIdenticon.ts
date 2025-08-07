import { identicon } from "@dicebear/collection";
import { createAvatar } from "@dicebear/core";
import { z } from "zod";

import { Account } from "./zodTypes";

export const createIdenticon = (seed: string): string =>
    createAvatar(identicon, {
        seed,
        size: 40,
        backgroundColor: ["black"],
        scale: 110,
    }).toDataUri();

export const generateAvatar = (
    chainId: string,
    account: z.infer<typeof Account>,
) => createIdenticon(chainId + account);
