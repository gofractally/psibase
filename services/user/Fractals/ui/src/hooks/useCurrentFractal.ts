import { useLocation } from "react-router-dom";
import { z } from "zod";

import { Account } from "@/lib/zodTypes";

export const useCurrentFractal = (): z.infer<typeof Account> | undefined => {
    const location = useLocation();
    const parsed = Account.safeParse(location.pathname.split("/")[2]);
    return parsed.success ? parsed.data : undefined;
};
