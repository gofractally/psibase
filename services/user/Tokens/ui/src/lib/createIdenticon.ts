import { createAvatar } from "@dicebear/core";
import { identicon } from "@dicebear/collection";

export const createIdenticon = (seed: string): string => {
  const avatar = createAvatar(identicon, {
    seed,
    size: 40,
    backgroundColor: ["27272a"],
    scale: 110,
  });
  return avatar.toDataUri();
};
