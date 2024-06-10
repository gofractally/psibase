"use client";

import { Cloud, Github, LifeBuoy, LogOut, Plus, UserPlus } from "lucide-react";

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuPortal,
    DropdownMenuSeparator,
    DropdownMenuShortcut,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { Moon, Sun, Power, RotateCcw } from "lucide-react";

import { useTheme } from "@/components/theme-provider";
import { Button } from "./ui/button";

import { Cog } from "lucide-react";
import { postJson } from "@psibase/common-lib";

export const MenuContent = () => {
    const { setTheme } = useTheme();
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline">
                    <Cog className="h-4 w-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56">
                <DropdownMenuGroup>
                    <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                            <UserPlus className="mr-2 h-4 w-4" />
                            <span>Theme</span>
                        </DropdownMenuSubTrigger>
                        <DropdownMenuPortal>
                            <DropdownMenuSubContent>
                                <DropdownMenuItem
                                    onClick={() => setTheme("light")}
                                >
                                    <Sun className="mr-2 h-4 w-4" />
                                    <span>Light</span>
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    onClick={() => setTheme("dark")}
                                >
                                    <Moon className="mr-2 h-4 w-4" />
                                    <span>Dark</span>
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                    onClick={() => setTheme("system")}
                                >
                                    <Sun className="mr-2 h-4 w-4" />
                                    <span>System</span>
                                </DropdownMenuItem>
                            </DropdownMenuSubContent>
                        </DropdownMenuPortal>
                    </DropdownMenuSub>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                    <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                            <Power className="mr-2 h-4 w-4" />
                            <span>System</span>
                        </DropdownMenuSubTrigger>
                        <DropdownMenuPortal>
                            <DropdownMenuSubContent>
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
                                <DropdownMenuSeparator />
                            </DropdownMenuSubContent>
                        </DropdownMenuPortal>
                    </DropdownMenuSub>
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
};
