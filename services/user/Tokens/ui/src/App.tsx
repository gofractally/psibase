import { ConfirmationModal } from "@/components/alert-modal";
import { CreditTable } from "@/components/credit-table";
import { FormCreate } from "@/components/forms/form-create";
import FormTransfer from "@/components/forms/form-transfer";
import { ModalCreateToken } from "@/components/modal-create-token";
import { ModeToggle } from "@/components/mode-toggle";
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

function App() {
  const currentUser = useUser();
  const {
    data: { sharedBalances, tokens },
    refetch,
  } = useUi(currentUser);

  const { mutateAsync: pluginCall } = usePluginCall();

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
    if (!selectedToken) {
      setMode(Mode.Transfer);
      return;
    }
    if (!selectedToken.isAdmin && isMinting) {
      setMode(Mode.Transfer);
    }
  }, [selectedTokenId, selectedToken, mode]);

  const [isConfirmationModalOpen, setConfirmationModalOpen] = useState(false);
  const [isNewTokenModalOpen, setNewTokenModalOpen] = useState(false);

  // TODO: Use graphql query to figure out admin of token,
  //  for now, the user is just gonna have to learn or remember their limitations over tokens they don't have access to.
  const isAdmin = true;

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
    <div>
      <ModeToggle />
      <div className="max-w-screen-lg mx-auto p-4">
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

        <div className="mb-4">
          <CreditTable
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