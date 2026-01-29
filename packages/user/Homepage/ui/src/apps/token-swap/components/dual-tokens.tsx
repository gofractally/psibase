

import {
    CardContent,
    CardFooter,
} from "@shared/shadcn/ui/card";
import { AmountField } from "../components/amount-field";
import { Separator } from "@shared/shadcn/ui/separator";
import { Button } from "@shared/shadcn/ui/button";
import { ReactNode } from "react";
import { Quantity } from "@shared/lib/quantity";


interface TokenProp {
    id: number;
    amount: string,
    setAmount: (val: string) => void,
    onSelect: () => void,
    onMaxBalance?: () => void,
    balance?: Quantity
    label: string
    symbol?: string
    disabled?: boolean
}

export const DualTokens = ({ triggerLabel, token1, token2, onCenterClick, center, footer, onTrigger, disableTrigger, onDisableCenter = false }: {
    token1: TokenProp,
    token2: TokenProp
    onCenterClick: () => void,
    onDisableCenter?: boolean,
    center?: ReactNode,
    footer?: ReactNode,
    disableTrigger?: boolean,
    onTrigger: () => void,
    triggerLabel: string
}) => {

    const sameTokensSelected = token1.id === token2.id;

    return <>

        <CardContent className="space-y-6">
            {/* Token 1 */}
            <AmountField
                disabled={token1.disabled}
                amount={token1.amount}
                onMaxBalance={() => {
                    if (token1.balance) {
                        token1.setAmount(token1.balance?.format({ includeLabel: false, showThousandsSeparator: false }))
                    }
                    if (token1.onMaxBalance) {
                        token1.onMaxBalance()
                    }
                }}
                label={
                    token1.label
                }
                setAmount={(amount) => {
                    token1.setAmount(amount)
                    if (amount == '') {
                        token2.setAmount('')
                    }
                }}
                onSelect={() => {
                    token1.onSelect()
                }}
                balance={token1?.balance?.format({ includeLabel: false })}
                name=""
                symbol={token1.symbol || token1.id.toString()}
            />

            {/* Center button icon */}
            <div className="relative flex justify-center">
                <div className="absolute inset-0 flex items-center">
                    <Separator />
                </div>
                <Button
                    variant="outline"
                    disabled={onDisableCenter}
                    size="icon"
                    className="bg-background hover:bg-muted relative z-10 rounded-full"
                    onClick={onCenterClick}
                >
                    {center}
                </Button>
            </div>

            {/* Token 2 */}
            <AmountField
                disabled={token2.disabled}
                amount={token2.amount}
                label={
                    token2.label
                }
                setAmount={(amount) => {
                    token2.setAmount(amount)
                    if (amount == '') {
                        token1.setAmount('')
                    }
                }}
                onSelect={() => {
                    token2.onSelect()
                }}
                onMaxBalance={() => {
                    if (token2?.balance) {
                        token2.setAmount(token2?.balance?.format({ includeLabel: false, showThousandsSeparator: false }))
                    }
                    if (token2.onMaxBalance) {
                        token2.onMaxBalance()
                    }
                }}
                balance={token2?.balance?.format({ includeLabel: false })}
                name=""
                symbol={token2.symbol || token2.id.toString()}
            />

            {footer}

        </CardContent>

        <CardFooter className="pt-2">
            <Button
                size="lg"
                className="h-14 w-full text-lg font-semibold"
                disabled={disableTrigger || sameTokensSelected}
                onClick={() => {
                    onTrigger();
                }}
            >
                {sameTokensSelected ? "Select tokens" : triggerLabel}
            </Button>
        </CardFooter>
    </>
}