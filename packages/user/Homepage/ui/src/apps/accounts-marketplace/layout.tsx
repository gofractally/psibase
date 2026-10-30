import { NavLink, Outlet } from "react-router-dom";

import { PageHeader } from "@/components/page-header";

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
