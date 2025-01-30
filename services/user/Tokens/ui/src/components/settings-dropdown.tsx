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
} from "@/components/ui/dropdown-menu";
import {
  LogOut,
  Sun,
  Moon,
  UserPlus,
  LogIn,
  PlusCircle,
  Settings,
  PawPrint,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

import { useTheme } from "./theme-provider";
import { useConnectedAccounts } from "@/hooks/network/useConnectedAccounts";
import { useLoggedInUser } from "@/hooks/network/useLoggedInUser";
import { useSelectAccount } from "@/hooks/network/useSelectAccount";
import { cn } from "@/lib/utils";

import { createAvatar } from "@dicebear/core";
import { thumbs, identicon } from "@dicebear/collection";
import { useChainId } from "@/hooks/network/useChainId";
import { useLogout } from "@/hooks/network/useLogout";
import { useCreateConnectionToken } from "@/hooks/network/useCreateConnectionToken";
import { Button } from "./ui/button";
import { z } from "zod";
import { useLocalStorage } from "usehooks-ts";

const now = new Date();
const randomSalt =
  `5b3fb229-d4ec-4fee-a36d-b949bc5e6fab5` +
  now.getMonth().toString() +
  now.getDate().toString();

console.log({ randomSalt });

const Style = z.enum(["thumbs", "identicon"]);

const createIdenticon = (
  seed: string,
  style: z.infer<typeof Style>
): string => {
  const avatar = createAvatar(style == Style.Enum.thumbs ? thumbs : identicon, {
    seed,
    size: 40,
    backgroundColor: ["black"],
    scale: 110,
    ...(style == Style.Enum.thumbs && {
      eyesColor: ["020202"],
      radius: 50,
      mouthColor: ["020202"],
      shapeColor: [
        "ea0276",
        "89ea02",
        "ead702",
        "15ea02",
        "025bea",
        "8902ea",
        "e602ea",
        "ea0219",
        "8502ea",
      ],
    }),
  });
  return avatar.toDataUri();
};

export const SettingsDropdown = () => {
  const { setTheme } = useTheme();

  const [style, setStyle] = useLocalStorage<z.infer<typeof Style>>(
    "style",
    Style.Enum.thumbs
  );

  const { data: connectedAccounts, isFetched: isFetchedConnectedAccounts } =
    useConnectedAccounts();

  const isNoOptions = connectedAccounts.length == 0;

  const { data: chainId, isFetched: isFetchedChainId } = useChainId();

  const { data: currentUser, isFetched: isFetchedLoggedInuser } =
    useLoggedInUser();

  const { mutateAsync, isPending: isConnectingToAccount } = useSelectAccount();

  const { mutateAsync: logout } = useLogout();
  const { mutateAsync: login } = useCreateConnectionToken();

  const connectToAccount = async (account: string) => {
    void (await mutateAsync(account));
  };

  const isLoading =
    !(
      isFetchedLoggedInuser &&
      isFetchedConnectedAccounts &&
      isFetchedChainId
    ) || isConnectingToAccount;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {currentUser ? (
          <button className="h-10">
            <Avatar
              className={cn("hover:opacity-25 h-10", {
                "rounded-none": style == Style.Enum.identicon,
              })}
            >
              {currentUser ? (
                <AvatarImage
                  src={createIdenticon(chainId + currentUser, style)}
                />
              ) : (
                <div>Loading..</div>
              )}
              <AvatarFallback>CN</AvatarFallback>
            </Avatar>
          </button>
        ) : (
          <Button variant="ghost" className="h-10 py-0">
            <Settings className="h-4 w-4" />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuLabel>{currentUser || "Not logged in"}</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {isNoOptions ? (
          <DropdownMenuItem
            onClick={() => {
              login();
            }}
            disabled={!isFetchedConnectedAccounts}
          >
            <LogIn className="mr-2 h-4 w-4" />
            <span>{!isFetchedConnectedAccounts ? "Loading..." : "Login"}</span>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuGroup>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={isLoading}>
                <UserPlus className="mr-2 h-4 w-4" />
                <span className={cn({ italic: isLoading })}>
                  {currentUser ? "Switch account" : "Select account"}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  {connectedAccounts.map((connectedAccount) => (
                    <DropdownMenuItem
                      disabled={isConnectingToAccount}
                      key={connectedAccount}
                      onClick={() => connectToAccount(connectedAccount)}
                    >
                      <img
                        className="mr-2 h-4 w-4 rounded-full"
                        src={createIdenticon(chainId + connectedAccount, style)}
                      />
                      <span>{connectedAccount}</span>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => {
                      login();
                    }}
                  >
                    <PlusCircle className="mr-2 h-4 w-4" />
                    <span>More...</span>
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          </DropdownMenuGroup>
        )}
        <DropdownMenuGroup>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Moon className="mr-2 h-4 w-4" />
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

        <DropdownMenuGroup>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <PawPrint className="mr-2 h-4 w-4" />
              <span>Icons</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent>
                <DropdownMenuItem
                  onClick={() => setStyle(Style.Enum.identicon)}
                >
                  Identicon
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setStyle(Style.Enum.thumbs)}>
                  <span>Thumbs</span>
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={() => {
            logout();
          }}
          disabled={!currentUser}
        >
          <LogOut className="mr-2 h-4 w-4" />
          <span>Log out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
