import { useState } from "react";

export enum Mode {
  Transfer = "transfer",
  Burn = "burn",
  Mint = "mint",
}

interface Return {
  isBurning: boolean;
  isMinting: boolean;
  isTransfer: boolean;
}

export const m = (mode: Mode): Return => {
  const isBurning = mode === Mode.Burn;
  const isMinting = mode === Mode.Mint;
  const isTransfer = mode === Mode.Transfer;

  return { isBurning, isMinting, isTransfer };
};

export const useMode = () => {
  const [mode, setMode] = useState<Mode>(Mode.Transfer);

  return {
    mode,
    setMode,
  };
};
