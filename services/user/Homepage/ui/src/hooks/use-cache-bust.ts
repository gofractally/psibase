import { useLocalStorage } from "usehooks-ts";
import { z } from "zod";

import { Account } from "@/lib/zod/Account";

const randomText = () => Math.random().toString(36).substring(2, 15);

export const useCacheBust = () => {
    const [bustedData, setBustedData] = useLocalStorage<{
        bustedUser: string;
        bustData: string;
    }>("cache-bust", { bustedUser: "", bustData: randomText() });

    return {
        bustedUser: bustedData.bustedUser,
        bustData: bustedData.bustData,
        setBustedUser: (user: z.infer<typeof Account>) =>
            setBustedData({ bustedUser: user, bustData: randomText() }),
    };
};
