import { Account, zAccount } from "@/lib/zod/Account";
import { useLocation } from "react-router-dom";

export const useCurrentFractal = (): Account | undefined => {
    const location = useLocation();
    const parsed = zAccount.safeParse(location.pathname.split("/")[2]);
    return parsed.success ? parsed.data : undefined;
};
