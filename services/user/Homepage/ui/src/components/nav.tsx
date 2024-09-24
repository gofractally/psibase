import { Settings } from "lucide-react";

import { Button } from "@shadcn/button";
import { Sheet, SheetTrigger } from "@shadcn/sheet";

import { HoverBorderGradient } from "@/components/ui/hover-border-gradient";

import { ModeToggle } from "./mode-toggle";
import { SettingsSheet } from "./settings-sheet";

function HoverBorderGradientDemo() {
    return (
        <div className="flex justify-center text-center">
            <HoverBorderGradient
                as="div"
                containerClassName="rounded-full"
                className="flex items-center space-x-2 bg-white text-black dark:bg-black dark:text-white"
            >
                <span>psibase</span>
            </HoverBorderGradient>
        </div>
    );
}

export const Nav = () => {
    return (
        <div className="mt-4 flex w-full justify-between px-4 xl:px-0">
            <div>
                <HoverBorderGradientDemo />
            </div>
            <div className="space-x-1.5">
                <ModeToggle />
                <Sheet>
                    <SheetTrigger asChild>
                        <Button variant="outline" size="icon">
                            <Settings className="h-4 w-4" />
                        </Button>
                    </SheetTrigger>
                    <SettingsSheet />
                </Sheet>
            </div>
        </div>
    );
};
