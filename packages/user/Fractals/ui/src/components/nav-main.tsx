import { Plus, Search } from "lucide-react";
import { useMemo } from "react";
import { NavLink, useLocation } from "react-router-dom";

import { useFractals } from "@/hooks/fractals/use-fractals";
import { useMemberships } from "@/hooks/fractals/use-memberships";
import { useCurrentFractal } from "@/hooks/use-current-fractal";

import { FractalGuildIdenticon } from "@shared/domains/fractal/components/fractal-guild-header-identifier";
import { useChainId } from "@shared/hooks/use-chain-id";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { createIdenticon } from "@shared/lib/create-identicon";
import {
    SidebarGroup,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuAction,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@shared/shadcn/ui/sidebar";

export function NavMain({
    onOpenCreateFractal,
}: {
    onOpenCreateFractal: () => void;
}) {
    const location = useLocation();
    const currentFractal = useCurrentFractal();
    const { data: currentUser } = useCurrentUser();
    const { data: memberships } = useMemberships(currentUser);
    const { data: allFractals } = useFractals();
    const { data: chainId } = useChainId();

    const fractals = useMemo(
        () => memberships?.map((m) => m.fractalDetails) ?? [],
        [memberships],
    );

    const fractalNameByAccount = useMemo(() => {
        if (!allFractals) return new Map<string, string>();
        return new Map(allFractals.map((f) => [f.account, f.name]));
    }, [allFractals]);

    const memberAccounts = useMemo(
        () => new Set(fractals.map((f) => f.account)),
        [fractals],
    );

    const isBrowsePath =
        location.pathname === "/browse" || location.pathname === "/browse/";

    const browseIsActive =
        isBrowsePath ||
        (currentFractal !== undefined && !memberAccounts.has(currentFractal));

    return (
        <>
            <SidebarGroup>
                <SidebarGroupLabel>All Fractals</SidebarGroupLabel>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton
                            asChild
                            isActive={browseIsActive}
                            tooltip="Browse"
                        >
                            <NavLink to="/browse" end>
                                <Search />
                                <span>Browse</span>
                            </NavLink>
                        </SidebarMenuButton>
                        <SidebarMenuAction
                            type="button"
                            title="Create a fractal"
                            onClick={() => {
                                onOpenCreateFractal();
                            }}
                        >
                            <Plus />
                            <span className="sr-only">Create a fractal</span>
                        </SidebarMenuAction>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarGroup>

            {fractals.length > 0 ? (
                <SidebarGroup>
                    <SidebarGroupLabel>My Fractals</SidebarGroupLabel>
                    <SidebarMenu>
                        {fractals.map((fractal) => {
                            const displayName = fractalNameByAccount.get(
                                fractal.account,
                            );

                            const src = chainId
                                ? createIdenticon(chainId + fractal.account)
                                : undefined;
                            const primaryLabel = displayName ?? fractal.account;
                            const hasSecondaryAccount =
                                displayName != null &&
                                displayName !== fractal.account;
                            const tooltipLabel = hasSecondaryAccount
                                ? `${primaryLabel} — ${fractal.account}`
                                : primaryLabel;
                            const fractalIsActive =
                                currentFractal === fractal.account;

                            return (
                                <SidebarMenuItem key={fractal.account}>
                                    <SidebarMenuButton
                                        asChild
                                        isActive={fractalIsActive}
                                        tooltip={tooltipLabel}
                                        className="h-auto min-h-8 py-1.5"
                                    >
                                        <NavLink
                                            to={`/fractal/${fractal.account}`}
                                            end
                                        >
                                            {src ? (
                                                <FractalGuildIdenticon
                                                    account={fractal.account}
                                                    name={primaryLabel}
                                                    size="sm"
                                                />
                                            ) : (
                                                <span className="size-4 shrink-0 self-center" />
                                            )}
                                            <span className="grid min-w-0 flex-1 text-left leading-tight">
                                                <span className="truncate">
                                                    {primaryLabel}
                                                </span>
                                                {hasSecondaryAccount ? (
                                                    <span className="text-muted-foreground truncate text-xs">
                                                        {fractal.account}
                                                    </span>
                                                ) : null}
                                            </span>
                                        </NavLink>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                            );
                        })}
                    </SidebarMenu>
                </SidebarGroup>
            ) : null}
        </>
    );
}
