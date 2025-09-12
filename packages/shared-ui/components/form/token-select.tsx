import { Quantity } from "@shared/lib/quantity";
import { cn } from "@shared/lib/utils";
import { Label } from "@shared/shadcn/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@shared/shadcn/ui/select";

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
    tokens: Token[];
}

export const TokenSelect = ({ tokens }: Props) => {
    const field = useFieldContext<string>();

    const isError = field.state.meta.errors.length > 0;
    const isBlurred = field.state.meta.isBlurred;

    return (
        <div className="flex flex-col gap-2">
            <Label className={cn(isError && isBlurred && "text-destructive")}>
                Token
            </Label>
            <Select
                value={field.state.value}
                onValueChange={field.handleChange}
            >
                <SelectTrigger className="flex-1" id={field.name}>
                    <SelectValue placeholder="Select a token" />
                </SelectTrigger>
                <SelectContent>
                    {tokens.map((balance) => (
                        <SelectItem
                            key={balance.id}
                            className={cn({
                                "text-muted-foreground": !!balance.symbol,
                            })}
                            value={balance.id.toString()}
                        >
                            {balance.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <FieldErrors meta={field.state.meta} />
        </div>
    );
};

export default TokenSelect;
