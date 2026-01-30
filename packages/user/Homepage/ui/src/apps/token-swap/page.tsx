import { Settings } from "lucide-react";
import { useState } from "react";
import { useBoolean } from "usehooks-ts";
import z from "zod";


import { Button } from "@shared/shadcn/ui/button";
import {
    CardDescription,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";

import { Tabs, TabsList, TabsTrigger } from "@shared/shadcn/ui/tabs";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@shared/shadcn/ui/tooltip";

import { DevModal } from "./components/dev-modal";
import { TradeSettingsModal } from "./components/trade-settings-modal";

import { Liquidity } from "./liquidity";
import { Swap } from "./swap";
import { GlowingCard } from "@shared/components/glowing-card";




const zCurrentTab = z.enum(["Swap", "Liquidity"]);


type Tab = z.infer<typeof zCurrentTab>;



export const SwapPage = () => {



    const [currentTab, setCurrentTab] = useState<Tab>(zCurrentTab.Values.Swap);

    const { value: showDevModal, setValue: setShowDevModal } = useBoolean();
    const { value: showSettingsModal, setValue: setShowSettingsModal } =
        useBoolean();


    const description = currentTab == zCurrentTab.Values.Swap
        ? "Trade tokens with best prices"
        : "Add liquidity to or from pools";


    return (
        <div className="container mx-auto max-w-lg px-4 py-12 ">

            <DevModal
                openChange={(e) => {
                    setShowDevModal(e);
                }}
                show={showDevModal}
            />
            <TradeSettingsModal
                openChange={(e) => {
                    setShowSettingsModal(e);
                }}
                show={showSettingsModal}
            />

            <GlowingCard className="relative isolate">
                <CardHeader className="pb-4">
                    <Tabs
                        defaultValue="swap"
                        value={currentTab}
                        onValueChange={(tab) => setCurrentTab(tab as Tab)}
                        className="w-[400px]"
                    >
                        <TabsList>
                            <TabsTrigger value={zCurrentTab.Values.Swap}>
                                Swap
                            </TabsTrigger>
                            <TabsTrigger value={zCurrentTab.Values.Liquidity}>
                                Liquidity
                            </TabsTrigger>
                        </TabsList>
                    </Tabs>

                    <div className="flex items-center justify-between">
                        <CardTitle className="text-2xl font-bold">
                            {currentTab}
                        </CardTitle>
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        onClick={() => {
                                            setShowSettingsModal(true);
                                        }}
                                        variant="ghost"
                                        size="icon"
                                    >
                                        <Settings className="h-5 w-5" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p>Transaction settings</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>
                    <CardDescription>{description}</CardDescription>
                </CardHeader>

                {currentTab == zCurrentTab.Values.Swap && <Swap onSwitch={() => { setCurrentTab(zCurrentTab.Values.Liquidity) }} />}
                {currentTab == zCurrentTab.Values.Liquidity && <Liquidity />}






            </GlowingCard>

            <div className="flex w-full justify-center">
                <Button
                    variant={"link"}
                    onClick={() => {
                        setShowDevModal(true);
                    }}
                    className="text-muted-foreground mt-6 text-xs"
                >
                    Dev tools
                </Button>
            </div>
        </div>
    );
};
