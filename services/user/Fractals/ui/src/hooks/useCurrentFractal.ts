import { useLocation } from "react-router-dom";
import { Account, zAccount } from "@/lib/zodTypes";

export const useCurrentFractal = (): Account | undefined => {
    const location = useLocation();
    const parsed = zAccount.safeParse(location.pathname.split("/")[2]);
    return parsed.success ? parsed.data : undefined;
};
