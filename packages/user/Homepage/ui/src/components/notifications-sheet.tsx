import type { Conversation } from "@/apps/chainmail/hooks/use-conversations";
import type { PendingBalance } from "@/apps/tokens/hooks/tokens-plugin/use-pending-balances";

import { ArrowDownLeft, Bell, CheckCheck } from "lucide-react";
import { Link } from "react-router-dom";

import { firstLine, formatChatTime } from "@/apps/chainmail/utils";

import { useDisplayName } from "@/components/account-cell";
import { SectionLabel } from "@/components/page-header";

import { useNotifications } from "@/hooks/use-notifications";

import { Avatar } from "@shared/components/avatar";
import { useBranding } from "@shared/hooks/use-branding";
import { Button } from "@shared/shadcn/ui/button";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "@shared/shadcn/ui/sheet";

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export const NotificationsSheet = ({ open, onOpenChange }: Props) => {
    const { data: networkName } = useBranding();
    const { unreadChats, incomingTransfers, count, markChatsRead } =
        useNotifications();
    const close = () => onOpenChange(false);

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent
                side="right"
                className="w-full gap-0 p-0 sm:max-w-sm"
                onOpenAutoFocus={(e) => e.preventDefault()}
            >
                <SheetHeader className="gap-0.5 border-b px-4 py-3 pr-12">
                    <SheetTitle className="flex items-center gap-2 text-sm">
                        Notifications
                        {count > 0 && (
                            <span className="rounded-full bg-[var(--brand)] px-1.5 text-[10px] font-semibold tabular-nums leading-4 text-[var(--brand-foreground)]">
                                {count}
                            </span>
                        )}
                    </SheetTitle>
                    <SheetDescription className="text-xs">
                        What&apos;s waiting for you across{" "}
                        {networkName || "the network"}
                    </SheetDescription>
                </SheetHeader>

                <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
                    {count === 0 ? (
                        <div className="flex h-full flex-col items-center justify-center gap-3 px-8 py-16 text-center">
                            <span className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-full">
                                <Bell className="size-5" />
                            </span>
                            <div>
                                <div className="text-sm font-medium">
                                    You&apos;re all caught up
                                </div>
                                <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                                    New chats, incoming tokens and updates from
                                    the apps you use will show up here.
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col pb-3">
                            {incomingTransfers.length > 0 && (
                                <section>
                                    <SectionLabel className="pt-3">
                                        Wallet
                                    </SectionLabel>
                                    <ul className="px-2">
                                        {incomingTransfers.map((t, i) => (
                                            <TransferItem
                                                key={`${t.creditor}-${t.id}-${i}`}
                                                transfer={t}
                                                onNavigate={close}
                                            />
                                        ))}
                                    </ul>
                                </section>
                            )}
                            {unreadChats.length > 0 && (
                                <section>
                                    <div className="flex items-center justify-between pr-2">
                                        <SectionLabel className="pt-3">
                                            Chats
                                        </SectionLabel>
                                        <Button
                                            variant="ghost"
                                            size="xs"
                                            className="text-muted-foreground mt-2"
                                            onClick={markChatsRead}
                                        >
                                            <CheckCheck className="size-3" />
                                            Mark all read
                                        </Button>
                                    </div>
                                    <ul className="px-2">
                                        {unreadChats.map((c) => (
                                            <ChatItem
                                                key={c.peer}
                                                conversation={c}
                                                onNavigate={close}
                                            />
                                        ))}
                                    </ul>
                                </section>
                            )}
                        </div>
                    )}
                </div>
            </SheetContent>
        </Sheet>
    );
};

const itemClass =
    "hover:bg-accent/50 flex items-start gap-3 rounded-lg px-2 py-2.5 transition-colors";

const TransferItem = ({
    transfer,
    onNavigate,
}: {
    transfer: PendingBalance;
    onNavigate: () => void;
}) => {
    const name = useDisplayName(transfer.creditor);
    return (
        <li>
            <Link
                to="/tokens/Pending"
                onClick={onNavigate}
                className={itemClass}
            >
                <span className="relative shrink-0">
                    <Avatar
                        account={transfer.creditor}
                        className="size-9 border-0 shadow-none"
                        alt=""
                    />
                    <span className="ring-background absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-emerald-500 text-white ring-2">
                        <ArrowDownLeft className="size-2.5" />
                    </span>
                </span>
                <span className="min-w-0 flex-1 text-sm leading-snug">
                    <span className="font-medium">
                        {name ?? transfer.creditor}
                    </span>{" "}
                    wants to send you{" "}
                    <span className="font-mono font-medium tabular-nums">
                        {transfer.balance.format({ includeLabel: false })}{" "}
                        {transfer.label}
                    </span>
                    <span className="text-muted-foreground mt-0.5 block text-xs">
                        Review and accept in your wallet
                    </span>
                </span>
            </Link>
        </li>
    );
};

const ChatItem = ({
    conversation: { peer, last, unread },
    onNavigate,
}: {
    conversation: Conversation;
    onNavigate: () => void;
}) => {
    const name = useDisplayName(peer);
    return (
        <li>
            <Link
                to={`/chainmail?with=${encodeURIComponent(peer)}`}
                onClick={onNavigate}
                className={itemClass}
            >
                <span className="relative shrink-0">
                    <Avatar
                        account={peer}
                        className="size-9 border-0 shadow-none"
                        alt=""
                    />
                    <span className="ring-background absolute -right-0.5 -top-0.5 size-3 rounded-full bg-[var(--brand)] ring-2" />
                </span>
                <span className="min-w-0 flex-1 leading-snug">
                    <span className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="truncate">
                            <span className="font-medium">{name ?? peer}</span>{" "}
                            <span className="text-muted-foreground">
                                sent{" "}
                                {unread === 1
                                    ? "a message"
                                    : `${unread} messages`}
                            </span>
                        </span>
                        <span className="text-muted-foreground shrink-0 text-[11px] tabular-nums">
                            {formatChatTime(last.datetime)}
                        </span>
                    </span>
                    <span className="text-muted-foreground mt-0.5 block truncate text-xs">
                        {firstLine(last.body)}
                    </span>
                </span>
            </Link>
        </li>
    );
};
