import { Cog, Moon, Power, RotateCcw, Sun } from "lucide-react";
import { Link } from "react-router-dom";

import { chain } from "@/lib/chain-endpoints";

import { useTheme } from "@shared/components/theme-provider";
import { Button } from "@shared/shadcn/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@shared/shadcn/ui/dropdown-menu";

export const MenuContent = ({ condense = false }: { condense?: boolean }) => {
    const { setTheme } = useTheme();
    return (
        <>
            {condense && (
                <Button asChild variant="outline" size="icon">
                    <Link to="/Configuration">
                        <Cog />
                        <span className="sr-only">Configuration</span>
                    </Link>
                </Button>
            )}
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon">
                        <Power />
                        <span className="sr-only">Power</span>
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56" align="end">
                    <DropdownMenuItem onClick={() => void chain.restart()}>
                        <RotateCcw />
                        Restart
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => void chain.shutdown()}>
                        <Power />
                        Shutdown
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" className="relative">
                        <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                        <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                        <span className="sr-only">Toggle theme</span>
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56" align="end">
                    <DropdownMenuItem onClick={() => setTheme("light")}>
                        <Sun />
                        Light
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setTheme("dark")}>
                        <Moon />
                        Dark
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setTheme("system")}>
                        <Sun />
                        System
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </>
    );
};
