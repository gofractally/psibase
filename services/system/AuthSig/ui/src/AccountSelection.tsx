import { useCreateConnectionToken } from "./hooks/useCreateConnectionToken";
import { usePublicToPrivate } from "./hooks/usePrivateFromPublicKey";
import { siblingUrl } from "@psibase/common-lib";
import { modifyUrlParams } from "./lib/modifyUrlParams";
import { Button } from "./components/ui/button";
import { useState } from "react";
import { useAccountLookup } from "./hooks/useAccountLookup";
import { useLocalStorage } from "usehooks-ts";

import QRCode from "react-qr-code";
import { cn } from "./lib/utils";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConnectedAccounts } from "./hooks/useConnectedAccounts";
import { Copy, Download } from "lucide-react";
import { Input } from "./components/ui/input";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { z } from "zod";
import { useAccountSelector } from "./hooks/useAccountSelector";
import { Skeleton } from "@/components/ui/skeleton";

const ModalState = z.enum(["Off", "Warn", "Show"]);

export const AccountSelection = () => {
  const { data: connectionToken } = useCreateConnectionToken();

  const onReveal = () => {
    setModalState(warnUser ? "Warn" : "Show");
  };

  const { data: availableAccounts, isFetching: isLoadingConnectedAccounts } =
    useConnectedAccounts();

  const { selectedAccount, setSelectedAccount } = useAccountSelector(
    availableAccounts,
    () => {
      window.location.href = modifyUrlParams(
        siblingUrl(undefined, "accounts"),
        {
          token: connectionToken!,
        }
      );
    }
  );

  const { data: account } = useAccountLookup(selectedAccount);
  const { data: privateKey } = usePublicToPrivate(account?.pubkey);
  const url = modifyUrlParams(siblingUrl("", "accounts"), {
    key: privateKey || "",
  });

  const isLoading = isLoadingConnectedAccounts;

  const [modalState, setModalState] = useState<z.infer<typeof ModalState>>(
    ModalState.parse("Off")
  );

  const [warnUser, setWarnUser] = useLocalStorage("warnUser", true);

  const onCopyClick = async () => {
    if (!url) {
      toast("No URL available.");
      return;
    }
    if ("clipboard" in navigator) {
      await navigator.clipboard.writeText(url);
      toast.success("Copied to clipboard.");
    } else {
      toast.error("Copying failed, not in secure context?");
    }
  };

  return (
    <div className="flex flex-col gap-4 mt-4 p-2 ">
      <p>Copy your account to another device or browser session.</p>
      <div className="flex gap-2">
        {isLoading ? (
          <Skeleton className="w-full h-[40px] my-auto rounded-sm" />
        ) : (
          <Select
            onValueChange={(account) => {
              setSelectedAccount(account);
            }}
            value={selectedAccount}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={selectedAccount} />
            </SelectTrigger>
            <SelectContent>
              {availableAccounts.map((account) => (
                <SelectItem key={account} value={account}>
                  {account}
                </SelectItem>
              ))}
              <SelectItem value={"other"}>Other...</SelectItem>
            </SelectContent>
          </Select>
        )}
        <Button
          className="pr-3 w-20"
          disabled={isLoading}
          onClick={() => {
            onReveal();
          }}
        >
          <Download className="h-4 w-4" />
        </Button>
      </div>

      <Dialog
        open={modalState !== "Off"}
        onOpenChange={(e) => {
          if (!e) {
            setModalState("Off");
          }
        }}
      >
        {modalState == "Warn" && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Sensitive information ahead!</DialogTitle>
              <DialogDescription>
                I understand the following information is sensitive and should
                not be shared with others.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <div className="w-full flex justify-between">
                <Button
                  variant="outline"
                  onClick={() => {
                    setWarnUser(false);
                    setModalState("Show");
                  }}
                >
                  Don't show again
                </Button>
                <Button
                  onClick={() => {
                    setModalState("Show");
                  }}
                >
                  Continue
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        )}
        {modalState == "Show" && (
          <DialogContent>
            <div className="flex flex-col text-muted-foreground gap-2">
              <div className="text-center text-lg">
                Copying{" "}
                <span className="text-primary font-semibold">
                  {selectedAccount}
                </span>
              </div>
              <div className="text-sm">
                This link and QR code contains sensitive information, do not
                share with others.
              </div>
              <div className="flex justify-center">
                <QRCode size={300} value={url} viewBox={`0 0 256 256`} />
              </div>
              <div className="flex justify-center w-full">
                <div className="flex items-center w-full space-x-2">
                  <Input
                    id="link"
                    className={cn("text-muted-foreground ", { italic: !url })}
                    value={url}
                    readOnly
                  />
                  <Button
                    type="submit"
                    size="sm"
                    className="px-3"
                    onClick={() => {
                      onCopyClick();
                    }}
                  >
                    <span className="sr-only">Copy</span>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
};
