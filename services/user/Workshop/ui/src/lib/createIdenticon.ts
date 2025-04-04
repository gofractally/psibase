import { createAvatar } from "@dicebear/core";
import { identicon } from "@dicebear/collection";
import { Account } from "./zodTypes";
import { z } from "zod";

export const createIdenticon = (seed: string): string =>
  createAvatar(identicon, {
    seed,
    size: 40,
    backgroundColor: ["black"],
    scale: 110,
  }).toDataUri();

export const generateAvatar = (
  chainId: string,
  account: z.infer<typeof Account>
) => createIdenticon(chainId + account);
