import { queryClient } from "@/queryClient";
import { ChevronsUpDown, Plus, Search } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useFractal } from "@/hooks/fractals/use-fractal";
import { useMemberships } from "@/hooks/fractals/use-memberships";
import { useChainId } from "@/hooks/use-chain-id";
import { useCurrentFractal } from "@/hooks/use-current-fractal";
import { useCurrentUser } from "@/hooks/use-current-user";
import { createIdenticon } from "@/lib/createIdenticon";
import { zFractal } from "@/lib/graphql/fractals/getFractal";
import QueryKey from "@/lib/queryKeys";

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@shared/shadcn/ui/dropdown-menu";
import {
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    useSidebar,
} from "@shared/shadcn/ui/sidebar";

import { CreateFractalModal } from "./create-fractal-modal";

export function AppSwitcher() {
    const { isMobile } = useSidebar();

    const navigate = useNavigate();

    const { data: currentUser } = useCurrentUser();
    const { data: memberships, error } = useMemberships(currentUser);
    const fractals = memberships
        ? memberships.map((membership) => membership.fractalDetails)
        : [];

    console.log({ fractals, error });
    const { data: chainId } = useChainId();

    const [showCreateFractalModal, setShowCreateFractalModal] = useState(false);

    const currentFractal = useCurrentFractal();

    const { data: fractal } = useFractal(currentFractal);

    return (
        <SidebarMenu>
            <CreateFractalModal
                openChange={(e) => setShowCreateFractalModal(e)}
                show={showCreateFractalModal}
            />
            <SidebarGroupLabel>My fractals</SidebarGroupLabel>
            <SidebarMenuItem>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <SidebarMenuButton
                            size="lg"
                            className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                        >
                            <div className="bg-background text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                                <img
                                    className="size-4"
                                    src={createIdenticon(
                                        chainId + currentFractal,
                                    )}
                                />
                            </div>
                            <div className="grid flex-1 text-left text-sm leading-tight">
                                <span className="truncate font-semibold">
                                    {fractal
                                        ? fractal?.fractal?.name
                                        : currentFractal || "Explore"}
                                </span>
                                {fractal && (
                                    <span className="truncate text-xs">
                                        {currentFractal}
                                    </span>
                                )}
                            </div>
                            <ChevronsUpDown className="ml-auto" />
                        </SidebarMenuButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
                        align="start"
                        side={isMobile ? "bottom" : "right"}
                        sideOffset={4}
                    >
                        <DropdownMenuLabel className="text-muted-foreground text-xs">
                            Global
                        </DropdownMenuLabel>
                        <DropdownMenuItem className="flex items-center justify-between gap-2 p-2">
                            <div
                                className="flex flex-1 items-center gap-2"
                                onClick={() => navigate(`/browse`)}
                            >
                                <div className="flex size-6 items-center justify-center rounded-sm">
                                    <Search />
                                </div>
                                Explore
                            </div>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />

                        {fractals && fractals?.length > 0 && (
                            <DropdownMenuLabel className="text-muted-foreground text-xs">
                                Fractals
                            </DropdownMenuLabel>
                        )}
                        {fractals?.map((fractal) => {
                            const metadata = zFractal.safeParse(
                                queryClient.getQueryData(
                                    QueryKey.fractal(fractal.account),
                                ),
                            );
                            const displayName =
                                metadata.success &&
                                metadata.data &&
                                metadata.data.name;

                            const src = createIdenticon(
                                chainId + fractal.account,
                            );

                            return (
                                <DropdownMenuItem
                                    key={fractal.account}
                                    className="flex items-center justify-between gap-2 p-2"
                                >
                                    <div
                                        className="flex flex-1 items-center gap-2"
                                        onClick={() =>
                                            navigate(
                                                `/fractal/${fractal.account}`,
                                            )
                                        }
                                    >
                                        <div className="flex size-6 items-center justify-center rounded-sm border">
                                            <img src={src} />
                                        </div>
                                        {displayName || fractal.account}
                                    </div>
                                </DropdownMenuItem>
                            );
                        })}
                        {fractals && fractals.length > 0 && (
                            <DropdownMenuSeparator />
                        )}
                        <DropdownMenuItem
                            className="gap-2 p-2"
                            onClick={() => {
                                setShowCreateFractalModal(true);
                            }}
                        >
                            <div className="bg-background flex size-6 items-center justify-center rounded-md border">
                                <Plus className="size-4" />
                            </div>
                            <div className="text-muted-foreground font-medium">
                                Create fractal
                            </div>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </SidebarMenuItem>
        </SidebarMenu>
    );
}
