import { useLocation } from "react-router-dom";
import { z } from "zod";

import { zAccount } from "@shared/lib/schemas/account";

export const useCurrentApp = (): z.infer<typeof zAccount> | undefined => {
    const location = useLocation();
    const parsed = zAccount.safeParse(location.pathname.split("/")[2]);
    return parsed.success ? parsed.data : undefined;
};
