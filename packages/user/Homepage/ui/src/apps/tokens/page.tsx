import { CreditTable } from "@/apps/tokens/components/credit-table";
import { FormCreate } from "@/apps/tokens/components/forms/form-create";
import FormTransfer from "@/apps/tokens/components/forms/form-transfer";
import { ModalCreateToken } from "@/apps/tokens/components/modal-create-token";
import { NoTokensWarning } from "@/apps/tokens/components/no-tokens-warning";
import { TransferModal } from "@/apps/tokens/components/transfer-modal";
import {
    updateBalanceCache,
    useBalances,
} from "@/apps/tokens/hooks/tokensPlugin/useBalances";
import { useCredit } from "@/apps/tokens/hooks/tokensPlugin/useCredit";
import { useTokenForm } from "@/apps/tokens/hooks/useTokenForm";
import { useEffect, useMemo, useState } from "react";

import { useCurrentUser } from "@/hooks/use-current-user";
import { Account } from "@/lib/zod/Account";

import { toast } from "@shared/shadcn/ui/sonner";

import { Quantity } from "./lib/quantity";

export const TokensPage = () => {
    const { data: currentUserData, isSuccess } = useCurrentUser();
    const {
        data,
        refetch: refetchUserBalances,
        isLoading: isLoadingBalances,
    } = useBalances(currentUserData);

    const currentUser = isSuccess ? currentUserData : null;

    const sharedBalances = data ? data.sharedBalances : [];
    const tokens = useMemo(() => (data ? data.tokens : []), [data]);
    const isLoading = !isSuccess || isLoadingBalances;

    const { isPending, mutateAsync: credit } = useCredit();

    const form = useTokenForm();

    const [isNewTokenModalOpen, setNewTokenModalOpen] = useState(false);
    const [isTransferModalOpen, setTransferModal] = useState(false);

    function onSubmit() {
        console.log("onSubmit");
        setTransferModal(true);
    }

    const selectedTokenId = form.watch("token");
    const selectedToken = tokens.find(
        (balance) => balance.id == Number(selectedTokenId),
    );

    useEffect(() => {
        if (!selectedTokenId && tokens.length > 0) {
            form.setValue("token", tokens[0].id.toString());
            return;
        }
    }, [form, selectedTokenId, tokens]);

    const onSuccessfulTx = () => {
        form.setValue("amount", "");
        form.setValue("memo", "");
        form.setValue("to", "");
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
                Account.parse(currentUser),
                tokenId,
                amount,
                "Subtract",
            );
        } catch (e) {
            toast("Error", {
                description:
                    e instanceof Error
                        ? e.message
                        : `Unrecognised error, see logs.`,
            });
        } finally {
            refetchUserBalances();
        }
    };

    const isNoTokens = currentUser && tokens.length == 0;
    const amount = form.watch("amount");

    const quantity = useMemo(() => {
        const { precision, id, symbol } = selectedToken || {};
        if (!precision || !id) return null;
        return new Quantity(amount, precision, id, symbol);
    }, [amount, selectedToken]);

    return (
        <div className="mx-auto h-screen w-screen max-w-screen-lg">
            <div className="mx-auto flex max-w-screen-lg flex-col gap-3 p-4">
                {isNoTokens && (
                    <NoTokensWarning
                        onContinue={() => {
                            setNewTokenModalOpen(true);
                        }}
                    />
                )}
                <ModalCreateToken
                    open={isNewTokenModalOpen}
                    onOpenChange={(e) => setNewTokenModalOpen(e)}
                >
                    <FormCreate
                        onClose={() => {
                            refetchUserBalances();
                            setNewTokenModalOpen(false);
                        }}
                    />
                </ModalCreateToken>
                <TransferModal
                    isPending={isPending}
                    onClose={() => setTransferModal(false)}
                    open={isTransferModalOpen}
                    from={currentUser}
                    to={form.watch("to")}
                    onContinue={performTransfer}
                    quantity={quantity}
                />
                <FormTransfer
                    isLoading={isLoading}
                    form={form}
                    tokens={tokens}
                    selectedToken={selectedToken}
                    setNewTokenModalOpen={setNewTokenModalOpen}
                    onSubmit={() => onSubmit()}
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
};
