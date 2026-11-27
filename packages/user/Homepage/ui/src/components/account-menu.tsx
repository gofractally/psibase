import {
    BookUser,
    LifeBuoy,
    Sparkles,
    Store,
    UserPlus,
    Zap,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { useAccountMarketplaceVisibility } from "@/apps/accounts-marketplace/hooks/use-account-marketplace-visibility";
import { ACCOUNT_MARKETPLACE_PATH } from "@/apps/accounts-marketplace/route";
import { useIsRecoveryPartner } from "@/apps/recovery/hooks";
import { RECOVERY_PATH } from "@/apps/recovery/route";
import { GenerateInviteDialogContent } from "@/apps/contacts/components/generate-invite-dialog";

import { useAccountSheet } from "@/hooks/use-account-sheet";
import { useGenerateInvite } from "@/hooks/use-generate-invite";
import { useSystemTokenBalance } from "@/hooks/use-system-token-balance";

import { AccountMenu as SharedAccountMenu } from "@shared/components/account-menu";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { useSystemTokenPolicy } from "@shared/hooks/use-system-token-policy";
import { Dialog } from "@shared/shadcn/ui/dialog";
import {
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuSeparator,
} from "@shared/shadcn/ui/dropdown-menu";

/**
 * The standard account menu at the right of the top bar, with the home
 * app's own items added to it.
 */
export const AccountMenu = () => {
    const { data: user } = useCurrentUser();
    const generateInvite = useGenerateInvite();
    const [showInvite, setShowInvite] = useState(false);
    const { open: openAccount } = useAccountSheet();

    return (
        <>
            <Dialog open={showInvite} onOpenChange={setShowInvite}>
                <GenerateInviteDialogContent generateInvite={generateInvite} />
            </Dialog>
            <SharedAccountMenu onProfile={() => openAccount("profile")}>
                {user && (
                    <AccountItems
                        onInvite={() => {
                            generateInvite.mutate();
                            setShowInvite(true);
                        }}
                    />
                )}
            </SharedAccountMenu>
        </>
    );
};

/** What the home app adds to the standard account menu. */
const AccountItems = ({ onInvite }: { onInvite: () => void }) => {
    const { data: user } = useCurrentUser();
    const { open: openAccount } = useAccountSheet();
    const marketplace = useAccountMarketplaceVisibility();
    const isRecoveryPartner = useIsRecoveryPartner();
    const {
        restrictsSelfService,
        isLoading: isNetworkLoading,
        billingEnabled,
        isTransferable,
    } = useSystemTokenPolicy();
    const { hasBalance, isLoading: isBalanceLoading } = useSystemTokenBalance();
    const balanceGatesInvites =
        !!user && billingEnabled && isTransferable === true;
    const showCreateInvite =
        !isNetworkLoading &&
        !(balanceGatesInvites && isBalanceLoading) &&
        !restrictsSelfService;
    const inviteNeedsBalance = balanceGatesInvites && !hasBalance;

    return (
        <>
            <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => openAccount("credits")}>
                    <Zap />
                    Usage credits
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => openAccount("preferences")}>
                    <Sparkles />
                    Preferences
                </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
                <DropdownMenuItem asChild>
                    <Link to="/contacts">
                        <BookUser />
                        Contacts
                    </Link>
                </DropdownMenuItem>
                {marketplace.visible && (
                    <DropdownMenuItem asChild>
                        <Link to={`/${ACCOUNT_MARKETPLACE_PATH}`}>
                            <Store />
                            Account Marketplace
                        </Link>
                    </DropdownMenuItem>
                )}
                {isRecoveryPartner && (
                    <DropdownMenuItem asChild>
                        <Link to={`/${RECOVERY_PATH}`}>
                            <LifeBuoy />
                            Recovery
                        </Link>
                    </DropdownMenuItem>
                )}
                {showCreateInvite && (
                    <>
                        <DropdownMenuItem
                            disabled={inviteNeedsBalance}
                            onClick={onInvite}
                        >
                            <UserPlus />
                            Invite a friend
                        </DropdownMenuItem>
                        {inviteNeedsBalance && (
                            <p className="text-destructive px-2 pb-1 text-xs">
                                You need a system token balance to create an
                                invite.
                            </p>
                        )}
                    </>
                )}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
        </>
    );
};
