import { useLocalStorage } from "usehooks-ts";
import { z } from "zod";

import { zAccount } from "@shared/lib/schemas/account";

const randomText = () => Math.random().toString(36).substring(2, 15);

export const useCacheBust = () => {
    const [bustedData, setBustedData] = useLocalStorage<{
        bustedUser: string;
        bustData: string;
    }>("cache-bust", { bustedUser: "", bustData: randomText() });

    return {
        bustedUser: bustedData.bustedUser,
        bustData: bustedData.bustData,
        setBustedUser: (user: z.infer<typeof zAccount>) =>
            setBustedData({ bustedUser: user, bustData: randomText() }),
    };
};
