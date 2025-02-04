import { createAvatar } from "@dicebear/core";
import { identicon } from "@dicebear/collection";

export const createIdenticon = (seed: string): string => {
  const avatar = createAvatar(identicon, {
    seed,
    size: 40,
    backgroundColor: ["black"],
    scale: 110,
  });
  return avatar.toDataUri();
};
