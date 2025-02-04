import { ConfirmationModal } from "@/components/confirmation-modal";
import { CreditTable } from "@/components/credit-table";
import { FormCreate } from "@/components/forms/form-create";
import FormTransfer from "@/components/forms/form-transfer";
import { ModalCreateToken } from "@/components/modal-create-token";
import { Tab, useTab } from "@/hooks/useMode";
import { useTokenForm } from "@/hooks/useTokenForm";
import { useBalances } from "@/hooks/tokensPlugin/useBalances";
import { wait } from "@/lib/wait";
import { useEffect, useState } from "react";
import { Nav } from "@/components/nav";
import { useLoggedInUser } from "./hooks/network/useLoggedInUser";
import { useBurn } from "./hooks/tokensPlugin/useBurn";
import { useCredit } from "./hooks/tokensPlugin/useCredit";
import { useMint } from "./hooks/tokensPlugin/useMint";
import { toast } from "sonner";
import { TransferModal } from "./components/transfer-modal";
import { NoTokensWarning } from "./components/no-tokens-warning";
import { NotLoggedIn } from "./components/not-logged-in";
import { updateBalanceCache } from "./lib/updateBalanceCache";
import { z } from "zod";

function App() {
  const { data: currentUserData, isSuccess } = useLoggedInUser();
  const {
    data,
    refetch: refetchUserBalances,
    isLoading: isLoadingBalances,
  } = useBalances(currentUserData);

  const currentUser = isSuccess ? currentUserData : null;

  const sharedBalances = data ? data.sharedBalances : [];
  const tokens = data ? data.tokens : [];
  const isLoading = !isSuccess || isLoadingBalances;

  const { isPending: isBurnPending, mutateAsync: burn } = useBurn();
  const { isPending: isCreditPending, mutateAsync: credit } = useCredit();
  const { isPending: isMintPending, mutateAsync: mint } = useMint();

  const isPending = isBurnPending || isCreditPending || isMintPending;
  const { isBurning, isMinting, isTransfer, setTab, tab } = useTab();

  const form = useTokenForm(tab);

  function onSubmit() {
    if (isTransfer) {
      setTransferModal(true);
    } else {
      setConfirmationModalOpen(true);
    }
  }

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
      setTab(Tab.Enum.Transfer);
      return;
    }
    if (!selectedToken.isAdmin && isMinting) {
      setTab(Tab.Enum.Transfer);
    }
  }, [selectedTokenId, selectedToken, tab, tokens]);

  const [isConfirmationModalOpen, setConfirmationModalOpen] = useState(false);
  const [isNewTokenModalOpen, setNewTokenModalOpen] = useState(false);
  const [isTransferModalOpen, setTransferModal] = useState(false);

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
    form.setValue("memo", "");
    form.setValue("to", "");
    form.setValue("from", "");
  };

  const performTransfer = async () => {
    const tokenId = form.watch("token");
    const amount = form.watch("amount");
    const memo = form.watch("memo")!;
    const recipient = form.watch("to")!;

    try {
      await credit({ tokenId, receiver: recipient, amount, memo });
      toast("Sent", {
        description: `Sent ${amount} ${
          selectedToken?.label || selectedToken?.symbol
        } to ${recipient}`,
      });
      onSuccessfulTx();
      setTransferModal(false);
      updateBalanceCache(
        z.string().parse(currentUser),
        tokenId,
        amount,
        "Subtract"
      );
    } catch (e) {
      toast("Error", {
        description:
          e instanceof Error ? e.message : `Unrecognised error, see logs.`,
      });
    } finally {
      wait(3000).then(() => {
        refetchUserBalances();
      });
    }
  };

  const performTx = async () => {
    if (!currentUser) throw new Error("Expected current user");
    const tokenId = form.watch("token");
    const amount = form.watch("amount");
    const memo = form.watch("memo")!;

    try {
      const token = tokens.find((token) => token.id.toString() === tokenId);
      if (!token) throw new Error("Failed to find token");

      if (isBurning) {
        const burningFrom = form.watch("from");
        await burn({ tokenId, amount, account: burningFrom || "", memo });
        toast("Burned", {
          description: `Burned ${amount} ${
            token.balance?.getDisplayLabel() || ""
          } tokens${burningFrom ? ` from ${burningFrom}` : ""}`,
        });
        if (!burningFrom) {
          updateBalanceCache(currentUser, tokenId, amount, "Subtract");
        }
        setConfirmationModalOpen(false);
        onSuccessfulTx();
      } else if (isMinting) {
        await mint({ tokenId, amount, memo });
        toast("Minted", {
          description: `Added ${amount} ${
            token.balance?.getDisplayLabel() || token.symbol
          } to your balance.`,
        });
        onSuccessfulTx();
        setConfirmationModalOpen(false);
        updateBalanceCache(currentUser, tokenId, amount, "Add");
      } else {
        throw new Error(`Failed to identify type of plugin call`);
      }
    } catch (e) {
      toast("Error", {
        description:
          e instanceof Error ? e.message : `Unrecognised error, see logs.`,
      });
    } finally {
      wait(3000).then(() => {
        refetchUserBalances();
      });
    }
  };

  const isNoTokens = currentUser && !isLoading && tokens.length == 0;
  const isNotLoggedIn = !currentUser && !isLoading;

  return (
    <div className="mx-auto h-screen w-screen max-w-screen-lg">
      <Nav title="Tokens" />

      <div className="max-w-screen-lg mx-auto p-4 flex flex-col gap-3">
        {isNoTokens && (
          <NoTokensWarning
            onContinue={() => {
              setNewTokenModalOpen(true);
            }}
          />
        )}
        {isNotLoggedIn && <NotLoggedIn />}
        <ModalCreateToken
          open={isNewTokenModalOpen}
          onOpenChange={(e) => setNewTokenModalOpen(e)}
        >
          <FormCreate
            onClose={() => {
              wait(3000).then(() => {
                refetchUserBalances();
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
        <TransferModal
          isPending={isPending}
          onClose={() => setTransferModal(false)}
          open={isTransferModalOpen}
          from={currentUser}
          amount={form.watch("amount")}
          tokenId={selectedToken?.id}
          to={form.watch("to")}
          onContinue={() => {
            performTransfer();
          }}
        />
        <FormTransfer
          isLoading={isLoading}
          form={form}
          tokens={tokens}
          tab={tab}
          selectedToken={selectedToken}
          setMode={setTab}
          setNewTokenModalOpen={setNewTokenModalOpen}
          onSubmit={onSubmit}
        />
        <div className="my-4">
          <CreditTable
            isLoading={isLoading}
            user={currentUser}
            balances={sharedBalances}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
