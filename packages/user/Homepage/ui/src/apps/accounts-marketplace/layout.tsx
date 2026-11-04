import { Ban } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";

import { EmptyState } from "@/components/empty-state";
import { PageHeader, Panel } from "@/components/page-header";

import { useSystemToken } from "@shared/hooks/use-system-token";
import { cn } from "@shared/lib/utils";

import { ACCOUNT_MARKETPLACE_PATH } from "./route";

const tabs = [
    { to: `/${ACCOUNT_MARKETPLACE_PATH}`, label: "Buy", end: true },
    { to: `/${ACCOUNT_MARKETPLACE_PATH}/claim`, label: "Claim", end: false },
    {
        to: `/${ACCOUNT_MARKETPLACE_PATH}/history`,
        label: "History",
        end: false,
    },
];

export function AccountMarketplaceLayout() {
    const { data: systemToken, isPending: isPendingToken } = useSystemToken();

    if (!isPendingToken && systemToken?.untransferable) {
        return (
            <div className="flex flex-col gap-4">
                <PageHeader title="Account Marketplace" />
                <Panel title="Not available">
                    <EmptyState icon={Ban} className="min-h-40">
                        Premium account names are not available by self-service.
                    </EmptyState>
                </Panel>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4">
            <PageHeader
                title="Account Marketplace"
                description="Buy short account names at the live market price, then claim them to activate on this network."
                actions={
                    <div className="flex items-center gap-1">
                        {tabs.map((tab) => (
                            <NavLink
                                key={tab.to}
                                to={tab.to}
                                end={tab.end}
                                className={({ isActive }) =>
                                    cn(
                                        "text-muted-foreground hover:bg-accent/60 hover:text-foreground inline-flex h-7 items-center rounded-md px-2.5 text-xs font-medium transition-colors",
                                        isActive &&
                                            "bg-accent text-foreground shadow-sm",
                                    )
                                }
                            >
                                {tab.label}
                            </NavLink>
                        ))}
                    </div>
                }
            />
            <Outlet />
        </div>
    );
}
