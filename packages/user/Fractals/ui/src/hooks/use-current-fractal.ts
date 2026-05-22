import { useParams } from "react-router-dom";

import { type Account, zAccount } from "@shared/lib/schemas/account";

export const useCurrentFractal = (): Account | undefined => {
    const { fractalName } = useParams();
    const parsed = zAccount.safeParse(fractalName);
    return parsed.success ? parsed.data : undefined;
};
