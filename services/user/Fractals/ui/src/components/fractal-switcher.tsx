import { queryClient } from "@/queryClient";
import { ChevronsUpDown, Plus, Search } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    useSidebar,
} from "@/components/ui/sidebar";

import { useFractal } from "@/hooks/fractals/useFractal";
import { useFractalMemberships } from "@/hooks/fractals/useFractalMemberships";
import { useChainId } from "@/hooks/use-chain-id";
import { useCurrentFractal } from "@/hooks/useCurrentFractal";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { createIdenticon } from "@/lib/createIdenticon";
import { zFractal } from "@/lib/graphql/fractals/getFractal";
import QueryKey from "@/lib/queryKeys";

import { CreateFractalModal } from "./create-fractal-modal";

export function AppSwitcher() {
    const { isMobile } = useSidebar();

    const navigate = useNavigate();

    const { data: currentUser } = useCurrentUser();
    const { data: fractals } = useFractalMemberships(currentUser);

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
                            <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-background text-sidebar-primary-foreground">
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
                        <DropdownMenuLabel className="text-xs text-muted-foreground">
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
                            <DropdownMenuLabel className="text-xs text-muted-foreground">
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
                            <div className="flex size-6 items-center justify-center rounded-md border bg-background">
                                <Plus className="size-4" />
                            </div>
                            <div className="font-medium text-muted-foreground">
                                Create fractal
                            </div>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </SidebarMenuItem>
        </SidebarMenu>
    );
}
