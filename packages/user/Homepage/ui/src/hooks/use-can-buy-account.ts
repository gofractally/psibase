import { useCanBuyAccount as useCanBuyAccountShared } from "@shared/hooks/use-can-buy-account";
import { homepage } from "@shared/lib/plugins";

export const useCanBuyAccount = (options?: { enabled?: boolean }) =>
    useCanBuyAccountShared(
        homepage.accountsMarketplace.canCreateAccount,
        options,
    );
