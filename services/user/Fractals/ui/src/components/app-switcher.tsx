import { queryClient } from "@/queryClient";
import { ChevronsUpDown, Plus, X } from "lucide-react";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

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

import { useChainId } from "@/hooks/use-chain-id";
import {
    Fractal,
    useFractal,
} from "@/hooks/useFractal";
import { useCurrentFractal } from "@/hooks/useCurrentFractal";
import { useTrackedFractals } from "@/hooks/useTrackedFractals";
import { createIdenticon } from "@/lib/createIdenticon";

import { CreateFractalModal } from "./create-fractal-modal";
import { Button } from "./ui/button";
import QueryKey from "@/lib/queryKeys";

export function AppSwitcher() {
    const { isMobile } = useSidebar();
    const location = useLocation();

    const navigate = useNavigate();
    const selectedFractalAccount = location.pathname.split("/")[2];

    const { fractals, removeFractal } = useTrackedFractals();

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
                                    src={
                         
                                        createIdenticon(
                                            chainId + selectedFractalAccount,
                                        )
                                    }
                                />
                            </div>
                            <div className="grid flex-1 text-left text-sm leading-tight">
                                <span className="truncate font-semibold">
                                    {fractal
                                        ? fractal.name
                                        : selectedFractalAccount}
                                </span>
                                {fractal && (
                                    <span className="truncate text-xs">
                                        {selectedFractalAccount}
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
                            Fractals
                        </DropdownMenuLabel>
                        {fractals.map((fractal) => {
                            const metadata = Fractal.safeParse(
                                queryClient.getQueryData(
                                    QueryKey.fractal(fractal.account),
                                ),
                            );
                            const displayName =
                                metadata.success &&
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
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        className="size-4 p-3 hover:bg-destructive/10"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            const nextFractal = fractals.find(
                                                (f) =>
                                                    f.account !==
                                                    fractal.account,
                                            );
                                            navigate(
                                                nextFractal
                                                    ? `/fractal/${nextFractal.account}`
                                                    : "/",
                                            );
                                            removeFractal(fractal.account);
                                        }}
                                    >
                                        <X className="size-3" />
                                    </Button>
                                </DropdownMenuItem>
                            );
                        })}
                        <DropdownMenuSeparator />
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
                                Add or create fractal
                            </div>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </SidebarMenuItem>
        </SidebarMenu>
    );
}
