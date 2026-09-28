import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { ArrowRightLeft, Send, Server } from "lucide-react";

import { useConversations } from "@/apps/chainmail/hooks/use-conversations";
import { usePools } from "@/apps/token-swap/hooks/use-pools";

import { Panel } from "@/components/page-header";

import { useProducers } from "@/hooks/use-producers";

import { useBranding } from "@shared/hooks/use-branding";
import { useIsPackageInstalled } from "@shared/hooks/use-is-package-installed";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

const Stat = ({
    icon: Icon,
    label,
    value,
    loading,
}: {
    icon: LucideIcon;
    label: ReactNode;
    value: ReactNode;
    loading?: boolean;
}) => (
    <li className="flex items-center gap-3 px-4 py-2.5">
        <Icon className="text-muted-foreground size-4 shrink-0" />
        <span className="text-muted-foreground min-w-0 flex-1 truncate text-sm">
            {label}
        </span>
        <span className="font-mono text-sm font-medium tabular-nums">
            {loading ? <Skeleton className="h-4 w-8" /> : value}
        </span>
    </li>
);

/** A few light numbers about the network and the user's place in it. */
export const AtAGlance = ({ user }: { user: string | null | undefined }) => {
    const { data: networkName } = useBranding();
    const producers = useProducers();
    const { data: swapInstalled } = useIsPackageInstalled("TokenSwap");
    const pools = usePools(60_000, swapInstalled === true);
    const chats = useConversations();

    return (
        <Panel
            title={`Around ${networkName || "the network"}`}
            description="A few numbers, at a glance"
        >
            <ul className="divide-y">
                <Stat
                    icon={Server}
                    label="Operators keeping it running"
                    value={producers.data?.length ?? "—"}
                    loading={producers.isPending}
                />
                {swapInstalled === true && (
                    <Stat
                        icon={ArrowRightLeft}
                        label="Trading pools"
                        value={pools.data?.length ?? "—"}
                        loading={pools.isPending && !pools.isError}
                    />
                )}
                {user && (
                    <Stat
                        icon={Send}
                        label="Messages you've sent · received"
                        value={`${chats.sentCount} · ${chats.receivedCount}`}
                        loading={chats.isLoading}
                    />
                )}
            </ul>
        </Panel>
    );
};
