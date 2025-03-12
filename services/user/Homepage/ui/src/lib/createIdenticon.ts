import { createAvatar } from "@dicebear/core";
import { identicon } from "@dicebear/collection";
import { z } from "zod";
import { Account } from "./zod/Account";


export const createIdenticon = (seed: string): string => createAvatar(identicon, {
  seed,
  size: 40,
  backgroundColor: ["27272a"],
  scale: 110,
}).toDataUri();


export const generateAvatar = (
  chainId: string,
  account: z.infer<typeof Account>
) => createIdenticon(chainId + account);