"use client";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Moon, Sun, Power, RotateCcw } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { Button } from "./ui/button";
import { postJson } from "@psibase/common-lib";

export const MenuContent = () => {
    const { setTheme } = useTheme();
    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="outline">
                        <Moon className="h-4 w-4" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56">
                    <DropdownMenuItem onClick={() => setTheme("light")}>
                        <Sun className="mr-2 h-4 w-4" />
                        <span>Light</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setTheme("dark")}>
                        <Moon className="mr-2 h-4 w-4" />
                        <span>Dark</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setTheme("system")}>
                        <Sun className="mr-2 h-4 w-4" />
                        <span>System</span>
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="outline">
                        <Power className="h-4 w-4" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56">
                    <DropdownMenuSub>
                        <DropdownMenuItem
                            onClick={() =>
                                postJson("/native/admin/shutdown", {
                                    restart: true,
                                })
                            }
                        >
                            <RotateCcw className="mr-2 h-4 w-4" />
                            <span>Restart</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onClick={() =>
                                postJson("/native/admin/shutdown", {})
                            }
                        >
                            <Power className="mr-2 h-4 w-4" />
                            <span>Shutdown</span>
                        </DropdownMenuItem>
                    </DropdownMenuSub>
                </DropdownMenuContent>
            </DropdownMenu>
        </>
    );
};
