import { useNavigate } from "react-router-dom";

import { EmptyBlock } from "@/components/EmptyBlock";
import { ErrorCard } from "@/components/error-card";
import { LoadingBlock } from "@/components/loading-block";

import { useChainId } from "@/hooks/use-chain-id";
import { useStagedTransactions } from "@/hooks/use-staged-transactions";
import { generateAvatar } from "@/lib/createIdenticon";

import { Avatar, AvatarImage } from "@shared/shadcn/ui/avatar";
import { Button } from "@shared/shadcn/ui/button";

const shorten = (id: string, length: number) =>
    id.slice(0, length) + "...." + id.slice(-length);

export const PendingTransactions = () => {
    const { data: transactions, error, isLoading } = useStagedTransactions();

    const { data: chainId } = useChainId();

    const navigate = useNavigate();

    if (isLoading) return <LoadingBlock />;
    if (error) return <ErrorCard error={error} />;

    return (
        <div className="mx-auto w-full max-w-screen-lg space-y-6 px-2">
            <div className="flex flex-col gap-2">
                {transactions?.length == 0 && (
                    <EmptyBlock
                        title="No pending transactions."
                        description="Proposed changes will appear here."
                    />
                )}
                {transactions?.map((transaction) => (
                    <div
                        key={transaction.id}
                        className="border-sm flex justify-between border p-4"
                    >
                        <div className="flex flex-col gap-2">
                            <div className="flex gap-3">
                                <div className="text-lg">#{transaction.id}</div>
                            </div>
                            <div className="text-muted-foreground flex flex-col text-xs">
                                <div>{shorten(transaction.txid, 5)}</div>
                                <div>
                                    {new Date(
                                        transaction.proposeDate,
                                    ).toLocaleString()}
                                </div>
                            </div>
                        </div>
                        <div className="flex flex-col justify-center">
                            <div className="flex gap-2">
                                <div className="flex items-center gap-2 text-sm">
                                    <Avatar className="h-4 w-4 rounded-sm">
                                        <AvatarImage
                                            src={generateAvatar(
                                                chainId,
                                                transaction.proposer,
                                            )}
                                        />
                                    </Avatar>
                                    {transaction.proposer}
                                </div>
                                <Button
                                    size="sm"
                                    onClick={() => {
                                        navigate(
                                            `/pending-transactions/${transaction.id}`,
                                        );
                                    }}
                                >
                                    Open
                                </Button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
