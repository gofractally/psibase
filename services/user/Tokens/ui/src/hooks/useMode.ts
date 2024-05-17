import { useState } from "react";

export enum Mode {
  Transfer = "transfer",
  Burn = "burn",
  Mint = "mint",
}

export const useMode = () => {
  const [mode, setMode] = useState<Mode>(Mode.Transfer);

  const isBurning = mode == Mode.Burn;
  const isMinting = mode == Mode.Mint;
  const isTransfer = mode == Mode.Transfer;

  return {
    isBurning,
    isMinting,
    isTransfer,
    mode,
    setMode,
  };
};
