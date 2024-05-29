import { ConfirmationModal } from "@/components/alert-modal";
import { CreditTable } from "@/components/credit-table";
import { FormCreate } from "@/components/forms/form-create";
import FormTransfer from "@/components/forms/form-transfer";
import { ModalCreateToken } from "@/components/modal-create-token";
import { Mode } from "@/components/transfer-toggle";
import { m, useMode } from "@/hooks/useMode";
import { usePluginCall } from "@/hooks/usePluginCall";
import { useTokenForm } from "@/hooks/useTokenForm";
import { useUi } from "@/hooks/useUi";
import { useUser } from "@/hooks/useUser";
import { wait } from "@/lib/wait";
import { tokenPlugin } from "@/plugin";
import { FunctionCallArgs } from "@psibase/common-lib";
import { useEffect, useState } from "react";
import { Nav } from "@/components/nav";

function App() {
  const currentUser = useUser();
  const {
    data: { sharedBalances, tokens },
    refetch,
    isLoading,
  } = useUi(currentUser);

  const { mutateAsync: pluginCall, isPending } = usePluginCall();

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

  const performTx = async () => {
    const tokenId = form.watch("token");
    const amount = form.watch("amount");
    const memo = form.watch("memo")!;
    let args: FunctionCallArgs;

    if (isTransfer) {
      const recipient = form.watch("to")!;
      args = tokenPlugin.transfer.credit(tokenId, recipient, amount, memo);
    } else if (isBurning) {
      args = tokenPlugin.intf.burn(tokenId, amount);
    } else if (isMinting) {
      args = tokenPlugin.intf.mint(tokenId, amount, memo);
    } else {
      throw new Error(`Failed to identify args`);
    }
    try {
      await pluginCall(args);
      form.setValue("amount", "");
      setConfirmationModalOpen(false);
    } catch (e) {
      console.error(e, "caught error");
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
          descriptions={[
            modalWarning,
            "Please be aware that it is irreversible and cannot be undone.",
          ]}
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
