import { useSearchParams } from "react-router-dom";
import { usePrivateToPublicKey } from "./hooks/usePrivateToPublicKey";
import { useAccountsLookup } from "./hooks/useAccountsLookup";
import { useEffect, useState } from "react";
import { Checkbox } from "@shared/shadcn/ui/checkbox";
import { cn } from "@shared/lib/utils";
import { Button } from "@shared/shadcn/ui/button";
import { useMutation } from "@tanstack/react-query";
import { supervisor } from "./main";
import { z } from "zod";
import { toast } from "@shared/shadcn/ui/sonner";
import { siblingUrl } from "@psibase/common-lib";
import { useDecodeB64 } from "./hooks/useB64";

const ImportKeyParams = z.object({
  accounts: z.string().array(),
  privateKey: z.string(),
});

const useImportKey = () =>
  useMutation<string[], Error, z.infer<typeof ImportKeyParams>>({
    mutationKey: ["importKey"],
    mutationFn: async (data) => {
      const { accounts, privateKey } = ImportKeyParams.parse(data);
      void (await supervisor.functionCall({
        method: "importKey",
        params: [privateKey],
        service: "auth-sig",
        intf: "keyvault",
      }));

      const successfulImports: string[] = [];
      for (const account of accounts) {
        try {
          void (await supervisor.functionCall({
            method: "importAccount",
            params: [account],
            service: "accounts",
            intf: "admin",
          }));
          successfulImports.push(account);
          toast(`Imported ${account}`);
        } catch (e) {
          toast(`Failed to import ${account}`, {
            description:
              e instanceof Error ? e.message : "Unrecognised error, see log.",
          });
        }
      }
      return successfulImports;
    },
    onSuccess: () => {
      toast("Account import successful", {
        duration: 180000,
        description: "You may now return to the homepage.",
        action: (
          <div className="w-full flex justify-end">
            <Button
              onClick={() => {
                window.location.href = siblingUrl();
              }}
            >
              Homepage
            </Button>
          </div>
        ),
      });
    },
  });

let awaitingAccounts = true;

function KeyImport() {
  const [searchParams] = useSearchParams();

  const key = searchParams.get("key");
  const { data: extractedPrivateKey } = useDecodeB64(key);
  const { data: publicKey } = usePrivateToPublicKey(extractedPrivateKey || "");
  const { data: importableAccounts } = useAccountsLookup(publicKey);

  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);

  const handleCheck = (account: string, checked: boolean) => {
    setSelectedAccounts((accounts) => [
      ...accounts.filter((x) => x !== account),
      ...(checked ? [account] : []),
    ]);
  };

  useEffect(() => {
    if (awaitingAccounts && importableAccounts.length > 0) {
      awaitingAccounts = false;
      setSelectedAccounts(importableAccounts);
    }
  }, [importableAccounts]);

  const {
    isPending,
    mutate: importAccounts,
    data: importedAccounts,
  } = useImportKey();

  const successfullyImportedAccounts: string[] = importedAccounts || [];

  const isNoAccountSelected =
    selectedAccounts.filter(
      (account) => !successfullyImportedAccounts.some((acc) => acc == account)
    ).length == 0;
  const disableImportButton =
    isNoAccountSelected || isPending || !extractedPrivateKey;

  return (
    <div>
      <h1 className="scroll-m-20 border-b pb-2 text-3xl font-semibold tracking-tight first:mt-0">
        Import an account
      </h1>{" "}
      <p className="leading-7 text-bg-muted-foreground [&:not(:first-child)]:mt-6">
        Select an account to import to your wallet.
      </p>
      <div className="flex  py-4 flex-col gap-3">
        {importableAccounts.map((account) => {
          const isSelected = selectedAccounts.includes(account);
          const isImported = successfullyImportedAccounts.includes(account);
          return (
            <button
              onClick={() => handleCheck(account, !isSelected)}
              key={account}
              disabled={isImported}
              className={cn("p-4 w-full flex rounded-sm justify-between", {
                "bg-muted": isSelected && !isImported,
                "bg-muted/25": !isSelected && !isImported,
                "border border-green-300 opacity-50": isImported,
              })}
            >
              <Checkbox
                checked={isSelected && !isImported}
                disabled={isImported}
                onCheckedChange={(e: boolean) => handleCheck(account, e)}
              />
              {account}
            </button>
          );
        })}
      </div>
      <div className="flex justify-between text-muted-foreground text-sm">
        <Button
          onClick={() => {
            importAccounts({
              privateKey: extractedPrivateKey!,
              accounts: selectedAccounts.filter(
                (account) =>
                  !successfullyImportedAccounts.some((acc) => acc == account)
              ),
            });
          }}
          disabled={disableImportButton}
        >
          {isPending ? "Importing" : "Import"}
        </Button>
        <div>
          {selectedAccounts.length == 0
            ? "Select at least 1 account."
            : `Importing ${selectedAccounts.length} account(s).`}
        </div>
      </div>
    </div>
  );
}

export default KeyImport;
