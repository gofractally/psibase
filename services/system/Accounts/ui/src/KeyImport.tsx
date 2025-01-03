import { useSearchParams } from "react-router-dom";
import { base64ToPem } from "./lib/key";
import { usePrivateToPublicKey } from "./hooks/usePrivateToPublicKey";
import { useAccountsLookup } from "./hooks/useAccountsLookup";
import { useEffect, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "./lib/utils";
import { Button } from "./components/ui/button";
import { useMutation } from "@tanstack/react-query";
import { supervisor } from "./main";
import { z } from "zod";

const ImportKeyParams = z.object({
  accounts: z.string().array(),
  privateKey: z.string(),
});

const useImportKey = () =>
  useMutation<null, Error, z.infer<typeof ImportKeyParams>>({
    mutationKey: ["importKey"],
    mutationFn: async (data) => {
      const { accounts, privateKey } = ImportKeyParams.parse(data);
      void (await supervisor.functionCall({
        method: "importKey",
        params: [privateKey],
        service: "auth-sig",
        intf: "keyvault",
      }));

      for (const account of accounts) {
        void (await supervisor.functionCall({
          method: "importAccount",
          params: [account],
          service: "accounts",
          intf: "admin",
        }));
      }
      return null;
    },
  });

let awaitingAccounts = true;

function KeyImport() {
  const [searchParams] = useSearchParams();

  const key = searchParams.get("key");

  const extractedPrivateKey = key && base64ToPem(key);

  const { data: publicKey } = usePrivateToPublicKey(extractedPrivateKey || "");
  const { data: availableAccounts } = useAccountsLookup(publicKey);

  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);

  const handleCheck = (account: string, checked: boolean) => {
    setSelectedAccounts((accounts) => [
      ...accounts.filter((x) => x !== account),
      ...(checked ? [account] : []),
    ]);
  };

  useEffect(() => {
    if (awaitingAccounts && availableAccounts.length > 0) {
      awaitingAccounts = false;
      setSelectedAccounts(availableAccounts);
    }
  }, [availableAccounts]);

  const { isPending, mutate } = useImportKey();

  const isNoAccountSelected = selectedAccounts.length == 0;
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
        {availableAccounts.map((account) => {
          const isSelected = selectedAccounts.includes(account);
          return (
            <button
              onClick={() => handleCheck(account, !isSelected)}
              key={account}
              className={cn("p-4 w-full flex rounded-sm justify-between", {
                "bg-muted": isSelected,
                "bg-muted/25": !isSelected,
              })}
            >
              <Checkbox
                checked={isSelected}
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
            mutate({
              privateKey: extractedPrivateKey!,
              accounts: selectedAccounts,
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
