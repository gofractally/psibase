import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { Avatar } from "@shared/components/avatar";
import { useContacts } from "@shared/hooks/use-contacts";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { useHasProfilesReadPermission } from "@shared/hooks/use-has-profiles-read-permission";
import { useProfile } from "@shared/hooks/use-profile";
import { cn } from "@shared/lib/utils";

/**
 * Resolves the local nickname (if any) for an account without triggering a
 * permission prompt: contacts are only read once we know we're allowed to.
 */
export const useNickname = (account: string | null | undefined) => {
    const { data: currentUser } = useCurrentUser();
    const { data: hasPermission } = useHasProfilesReadPermission({
        enabled: !!currentUser,
    });
    const { data: contacts } = useContacts(currentUser, {
        enabled: !!hasPermission,
    });
    if (!account) return undefined;
    return contacts?.find((c) => c.account === account)?.nickname;
};

/** Best human name for an account: local nickname, then public display name. */
export const useDisplayName = (account: string | null | undefined) => {
    const nickname = useNickname(account);
    const { data: profile } = useProfile(account);
    return nickname || profile?.profile?.displayName?.trim() || undefined;
};

export const CopyIcon = ({
    value,
    className,
}: {
    value: string;
    className?: string;
}) => {
    const [copied, setCopied] = useState(false);
    return (
        <button
            type="button"
            aria-label="Copy"
            className={cn(
                "text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center rounded p-0.5 transition-colors",
                className,
            )}
            onClick={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                try {
                    await navigator.clipboard.writeText(value);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1200);
                } catch {
                    /* ignore */
                }
            }}
        >
            {copied ? (
                <Check className="size-3.5 text-emerald-500" />
            ) : (
                <Copy className="size-3.5" />
            )}
        </button>
    );
};

interface AccountCellProps {
    account: string;
    /** Override the resolved nickname (e.g. when the caller already has it). */
    nickname?: string | null;
    /** Show the account's avatar. */
    avatar?: boolean;
    /** Show a copy-to-clipboard affordance next to the name. */
    copy?: boolean;
    className?: string;
}

/**
 * Compact identity chip used in tables and lists: a small avatar, the local
 * nickname when known and the account name in mono.
 */
export const AccountCell = ({
    account,
    nickname: nicknameProp,
    avatar = true,
    copy = false,
    className,
}: AccountCellProps) => {
    const resolved = useNickname(nicknameProp === undefined ? account : null);
    const nickname = nicknameProp ?? resolved;

    if (!account) {
        return (
            <span
                className={cn(
                    "text-muted-foreground text-xs italic",
                    className,
                )}
            >
                —
            </span>
        );
    }

    return (
        <span
            className={cn("inline-flex min-w-0 items-center gap-2", className)}
        >
            {avatar && (
                <Avatar
                    account={account}
                    className="size-5 shrink-0 border-0 shadow-none"
                    alt=""
                />
            )}
            <span className="flex min-w-0 items-baseline gap-1.5 leading-tight">
                {nickname && (
                    <span className="truncate text-[13px] font-medium">
                        {nickname}
                    </span>
                )}
                <span
                    className={cn(
                        "truncate font-mono text-[13px]",
                        nickname && "text-muted-foreground text-xs",
                    )}
                >
                    {account}
                </span>
            </span>
            {copy && <CopyIcon value={account} />}
        </span>
    );
};
