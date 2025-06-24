import { useParams } from "react-router-dom";

import { Account, zAccount } from "@/lib/zod/Account";

export const useCurrentFractal = (): Account | undefined => {
    const { fractalName } = useParams();
    const parsed = zAccount.safeParse(fractalName);
    return parsed.success ? parsed.data : undefined;
};
