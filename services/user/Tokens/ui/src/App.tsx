import { ConfirmationModal } from "@/components/alert-modal";
import { CreditTable } from "@/components/credit-table";
import { FormCreate } from "@/components/forms/form-create";
import FormTransfer from "@/components/forms/form-transfer";
import { ModalCreateToken } from "@/components/modal-create-token";
import { Mode } from "@/components/transfer-toggle";
import { m, useMode } from "@/hooks/useMode";
import { useTokenForm } from "@/hooks/useTokenForm";
import { useBalances as useBalances } from "@/hooks/tokensPlugin/useBalances";
import { wait } from "@/lib/wait";
import { useEffect, useState } from "react";
import { Nav } from "@/components/nav";
import { useLoggedInUser } from "./hooks/network/useLoggedInUser";
import { AccountSelection } from "./components/account-selection";
import { useBurn } from "./hooks/tokensPlugin/useBurn";
import { useCredit } from "./hooks/tokensPlugin/useCredit";
import { useMint } from "./hooks/tokensPlugin/useMint";
import { toast } from "sonner";

function App() {
  const { data: currentUser } = useLoggedInUser();
  const {
    data: { sharedBalances, tokens },
    refetch,
    isLoading,
  } = useBalances(currentUser);

  const { isPending: isBurnPending, mutateAsync: burn } = useBurn();
  const { isPending: isCreditPending, mutateAsync: credit } = useCredit();
  const { isPending: isMintPending, mutateAsync: mint } = useMint();

  const isPending = isBurnPending || isCreditPending || isMintPending;

  const form = useTokenForm();

  function onSubmit() {
    setConfirmationModalOpen(true);
  }

  const { setMode, mode } = useMode();
  const { isBurning, isMinting, isTransfer } = m(mode);

  const selectedTokenId = form.watch("token");
  const selectedToken = tokens.find(
    (balance) => balance.id == Number(selectedTokenId)
  );

  useEffect(() => {
    if (!selectedTokenId && tokens.length > 0) {
      form.setValue("token", tokens[0].id.toString());
      return;
    }
    if (!selectedToken) {
      setMode(Mode.Transfer);
      return;
    }
    if (!selectedToken.isAdmin && isMinting) {
      setMode(Mode.Transfer);
    }
  }, [selectedTokenId, selectedToken, mode, tokens]);

  const [isConfirmationModalOpen, setConfirmationModalOpen] = useState(false);
  const [isNewTokenModalOpen, setNewTokenModalOpen] = useState(false);

  const isAdmin = selectedToken?.isAdmin || false;

  const modalWarning = `This will ${
    isBurning ? "burn" : isMinting ? "mint" : "transfer"
  } ${form.watch("amount")} tokens${
    isBurning && isAdmin && form.watch("from")
      ? ` from ${form.watch("from")}'s account.`
      : ""
  }`;

  const onSuccessfulTx = () => {
    form.setValue("amount", "");
    setConfirmationModalOpen(false);
  };

  const performTx = async () => {
    const tokenId = form.watch("token");
    const amount = form.watch("amount");
    const memo = form.watch("memo")!;

    try {
      if (isTransfer) {
        const recipient = form.watch("to")!;
        await credit({ tokenId, receiver: recipient, amount, memo });
        toast("Sent", { description: `Sent ${amount} to ${recipient}` });
        onSuccessfulTx();
      } else if (isBurning) {
        const burningFrom = form.watch("from");
        await burn({ tokenId, amount, account: burningFrom || "", memo });
        toast("Burned", {
          description: `Burned ${amount} tokens${
            burningFrom ? ` from ${burningFrom}` : ""
          }`,
        });
        onSuccessfulTx();
      } else if (isMinting) {
        await mint({ tokenId, amount, memo });
        toast("Minted", { description: `Added ${amount} to your balance.` });
        onSuccessfulTx();
      } else {
        throw new Error(`Failed to identify type of plugin call`);
      }
    } catch (e) {
      toast("Error", {
        description:
          e instanceof Error ? e.message : `Unrecognised error, see logs.`,
      });
    } finally {
      refetch();
      wait(3000).then(() => {
        refetch();
      });
    }
  };

  return (
    <div className="mx-auto h-screen w-screen max-w-screen-lg">
      <Nav title="Tokens" />

      <div className="max-w-screen-lg mx-auto p-4 flex flex-col gap-3">
        <AccountSelection />
        <ModalCreateToken
          open={isNewTokenModalOpen}
          onOpenChange={(e) => setNewTokenModalOpen(e)}
        >
          <FormCreate
            onClose={() => {
              wait(3000).then(() => {
                refetch();
              });
              setNewTokenModalOpen(false);
            }}
          />
        </ModalCreateToken>
        <ConfirmationModal
          descriptions={[modalWarning]}
          isPending={isPending}
          onClose={() => setConfirmationModalOpen(false)}
          onContinue={() => performTx()}
          open={isConfirmationModalOpen}
        />
        <FormTransfer
          form={form}
          tokens={tokens}
          mode={mode}
          selectedToken={selectedToken}
          setMode={setMode}
          setNewTokenModalOpen={setNewTokenModalOpen}
          onSubmit={onSubmit}
        />
        <div className="my-4">
          <CreditTable
            isLoading={isLoading}
            user={currentUser}
            // @ts-ignore
            balances={sharedBalances}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
