import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

import { Settings, LogOut, Sun, Moon, UserPlus, LogIn } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useTheme } from "./theme-provider";
import { useLogout } from "@/hooks/useLogout";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useCreateConnectionToken } from "@/hooks/useCreateConnectionToken";

export const SettingsDropdown = () => {
  const { setTheme } = useTheme();

  const { mutate: logout } = useLogout();
  const { data: currentUser } = useCurrentUser();
  const { mutateAsync: login } = useCreateConnectionToken();

  const isLoggedIn = !!currentUser;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost">
            <Settings className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56">
          <DropdownMenuLabel>Settings</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <UserPlus className="mr-2 h-4 w-4" />
                <span>Theme</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
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
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />

          {isLoggedIn ? (
            <DropdownMenuItem
              onClick={() => {
                logout();
              }}
            >
              <LogOut className="mr-2 h-4 w-4" />
              <span>Log out</span>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onClick={() => {
                login();
              }}
            >
              <LogIn className="mr-2 h-4 w-4" />
              <span>Log in</span>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
};
