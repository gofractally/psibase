import { Quantity } from "@shared/lib/quantity";
import { cn } from "@shared/lib/utils";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";

import { useFieldContext } from "./app-form";
import { FieldErrors } from "./field-errors";

interface Token {
    id: number;
    balance?: Quantity;
    owner: string;
    isAdmin: boolean;
    symbol: string;
    label: string;
    precision: number;
}

interface Props {
    selectedToken: Token | undefined;
    disabled?: boolean;
}

export const TokenAmountInput = ({ selectedToken, disabled }: Props) => {
    const field = useFieldContext<string>();
    const placeholder = selectedToken
        ? `Enter amount in ${selectedToken.symbol}`
        : "Enter amount";

    const isError = field.state.meta.errors.length > 0;
    const isBlurred = field.state.meta.isBlurred;

    return (
        <div className="flex flex-col gap-2">
            <Label className={cn(isError && isBlurred && "text-destructive")}>
                Amount
            </Label>
            <Input
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                name={field.name}
                disabled={disabled}
                placeholder={placeholder}
            />
            <FieldErrors meta={field.state.meta} />
        </div>
    );
};

export default TokenAmountInput;
