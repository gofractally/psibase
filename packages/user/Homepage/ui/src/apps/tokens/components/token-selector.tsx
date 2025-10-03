import type { Quantity } from "../lib/quantity";

import { Icon as SelectIcon } from "@radix-ui/react-select";
import { ChevronDown } from "lucide-react";

import { Avatar } from "@shared/components/avatar";
import { CustomSelect, type SelectOption } from "@shared/shadcn/custom/select";

import { Token } from "../hooks/tokensPlugin/useUserTokenBalances";
import { AnimateNumber } from "./AnimateNumber";

export const TokenSelector = ({
    tokens,
    selectedToken,
    onClickAvailableBalance,
    onChange,
}: {
    tokens: Token[];
    selectedToken?: Token;
    onClickAvailableBalance?: (e: React.MouseEvent<HTMLButtonElement>) => void;
    onChange?: (value: string) => void;
}) => {
    return (
        <div className="@lg:flex-row flex flex-1 flex-col items-center justify-between gap-2">
            <CustomSelect
                options={tokens.map((token) => ({
                    value: {
                        id: token.id.toString(),
                        balance: token.balance,
                    },
                    label: token.label,
                }))}
                keyExtractor={(option) => option.value.id}
                TriggerComponent={
                    <TokenSelectTrigger selectedToken={selectedToken} />
                }
                OptionComponent={TokenSelectOption}
                onChange={onChange}
            />
            <AvailableBalance
                selectedToken={selectedToken}
                onClick={onClickAvailableBalance}
            />
        </div>
    );
};

const TokenSelectOption = ({
    option,
}: {
    option: SelectOption<{ id: string; balance?: Quantity }>;
}) => {
    return (
        <div className="flex min-w-56 items-center justify-between gap-2">
            <div className="flex items-center gap-2">
                <Avatar
                    account={option.label}
                    type="glass"
                    className="size-5"
                />
                <span className="font-mono text-lg font-medium">
                    {option.label}
                </span>
            </div>
            <div>
                <span className="text-muted-foreground text-xs">
                    {option.value.balance?.format({
                        includeLabel: false,
                    })}
                </span>
            </div>
        </div>
    );
};

const TokenSelectTrigger = ({ selectedToken }: { selectedToken?: Token }) => {
    const tokenLabel = selectedToken?.label ?? "UNKNOWN";

    return (
        <div className="flex select-none items-center gap-2 p-1">
            <Avatar account={tokenLabel} type="glass" />
            <span className="font-mono text-3xl font-medium">{tokenLabel}</span>
            <SelectIcon asChild>
                <ChevronDown className="size-4 opacity-50" />
            </SelectIcon>
        </div>
    );
};

const AvailableBalance = ({
    selectedToken,
    onClick,
}: {
    selectedToken?: Token;
    onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) => {
    return (
        <div className="@lg:items-end flex flex-col items-center">
            <span className="text-foreground/75 select-none text-xs font-medium">
                Available
            </span>
            <span className="text-foreground/90 font-mono text-xl font-medium">
                <AnimateNumber
                    n={selectedToken?.balance?.amount ?? 0}
                    precision={selectedToken?.balance?.precision ?? 0}
                    className="hover:cursor-pointer hover:underline"
                    onClick={onClick}
                />
            </span>
        </div>
    );
};
