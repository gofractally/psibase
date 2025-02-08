import { PlusCircle, TriangleAlert } from "lucide-react";
import { Button } from "./ui/button";
import { useCreateConnectionToken } from "@/hooks/network/useCreateConnectionToken";
import { useConnectedAccounts } from "@/hooks/network/useConnectedAccounts";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSelectAccount } from "@/hooks/network/useSelectAccount";
import { createIdenticon } from "@/lib/createIdenticon";
import { useChainId } from "@/hooks/network/useChainId";

interface Props {}

export const NotLoggedIn = ({}: Props) => {
  const { mutate: login } = useCreateConnectionToken();
  const { data: connectedAccounts } = useConnectedAccounts();
  const { data: chainId } = useChainId();

  const { mutate: connectToAccount, isPending: isConnectingToAccount } =
    useSelectAccount();

  const isOptions = connectedAccounts && connectedAccounts.length > 0;

  return (
    <div className="relative w-full rounded-lg border p-4 flex justify-between">
      <div className="my-auto flex gap-2">
        <div className="h-full my-auto">
          <TriangleAlert className="h-4 w-4 text-yellow-500" />
        </div>
        <div>
          <div className="">Not logged in</div>
          <div className="text-sm text-muted-foreground">
            Login to continue.
          </div>
        </div>
      </div>
      <div className="my-auto">
        {isOptions ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>Login</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56">
              {connectedAccounts.map((connectedAccount) => (
                <DropdownMenuItem
                  disabled={isConnectingToAccount}
                  key={connectedAccount}
                  onClick={() => connectToAccount(connectedAccount)}
                >
                  <img
                    className="mr-2 h-4 w-4 rounded-none"
                    src={createIdenticon(chainId + connectedAccount)}
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
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button onClick={() => login()}>Login</Button>
        )}
      </div>
    </div>
  );
};
