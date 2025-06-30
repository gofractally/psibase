import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuTrigger,
} from "@shared/shadcn/ui/dropdown-menu";
import { Moon, Sun, Power, RotateCcw } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@shared/shadcn/ui/button";
import { Cog } from "lucide-react";
import { Link } from "react-router-dom";
import { chain } from "@/lib/chainEndpoints";

export const MenuContent = ({ condense = false }: { condense?: boolean }) => {
    const { setTheme } = useTheme();
    return (
        <>
            {condense && (
                <Button asChild variant="outline">
                    <Link to="/Configuration">
                        <Cog size={20} />
                    </Link>
                </Button>
            )}
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
                        <DropdownMenuItem onClick={() => void chain.restart()}>
                            <RotateCcw className="mr-2 h-4 w-4" />
                            <span>Restart</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => void chain.shutdown()}>
                            <Power className="mr-2 h-4 w-4" />
                            <span>Shutdown</span>
                        </DropdownMenuItem>
                    </DropdownMenuSub>
                </DropdownMenuContent>
            </DropdownMenu>
        </>
    );
};
