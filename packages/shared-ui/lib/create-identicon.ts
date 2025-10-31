import { glass, identicon } from "@dicebear/collection";
import { createAvatar } from "@dicebear/core";
import { z } from "zod";

import { zAccount } from "./schemas/account";

export type AvatarType = "identicon" | "glass";

export const createIdenticon = (
    seed: string,
    type: AvatarType = "identicon",
): string =>
    createAvatar(type === "identicon" ? identicon : glass, {
        seed,
        size: 40,
        backgroundColor: ["27272a"],
        scale: 110,
    }).toDataUri();

export const generateAvatar = (
    chainId: string,
    account: z.infer<typeof zAccount>,
    type: AvatarType = "identicon",
) => createIdenticon(chainId + account, type);
