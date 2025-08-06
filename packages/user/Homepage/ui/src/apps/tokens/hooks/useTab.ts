import { useState } from "react";
import { z } from "zod";

export const Tab = z.enum(["Transfer", "Burn", "Mint"]);

export type TabType = z.infer<typeof Tab>;

export const useTab = () => {
    const [tab, setTab] = useState<TabType>(Tab.Enum.Transfer);

    const isBurning = tab === Tab.Enum.Burn;
    const isMinting = tab === Tab.Enum.Mint;
    const isTransfer = tab === Tab.Enum.Transfer;

    return {
        tab,
        setTab,
        isBurning,
        isMinting,
        isTransfer,
    };
};
