import { Token } from "@/apps/tokens/hooks/tokensPlugin/useBalances";
import { Plus } from "lucide-react";
import { FC } from "react";
import { UseFormReturn } from "react-hook-form";

import { formatThousands } from "@/lib/formatNumber";

import { cn } from "@shared/lib/utils";
import { Button } from "@shared/shadcn/ui/button";
import {
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@shared/shadcn/ui/form";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@shared/shadcn/ui/select";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

interface Props {
    tokens: Token[];
    form: UseFormReturn<any>;
    setNewTokenModalOpen: (open: boolean) => void;
    isLoading: boolean;
}

const TokenSelection: FC<Props> = ({
    tokens,
    form,
    setNewTokenModalOpen,
    isLoading,
}) =>
    isLoading ? (
        <Skeleton className="h-12 w-full" />
    ) : (
        <FormField
            control={form.control}
            name="token"
            render={({ field }) => (
                <FormItem>
                    <FormLabel>Token</FormLabel>
                    <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                    >
                        <FormControl>
                            <div className="flex w-full items-center gap-1">
                                <SelectTrigger className="flex-1">
                                    <SelectValue placeholder="No token selected." />
                                </SelectTrigger>
                                <Button
                                    type="button"
                                    onClick={() => setNewTokenModalOpen(true)}
                                    variant="secondary"
                                    className="shrink-0"
                                >
                                    <Plus />
                                </Button>
                            </div>
                        </FormControl>
                        <SelectContent>
                            {tokens.map((balance) => (
                                <SelectItem
                                    key={balance.id}
                                    className={cn({
                                        "text-muted-foreground":
                                            !!balance.symbol,
                                    })}
                                    value={balance.id.toString()}
                                    // @ts-ignore
                                    right={
                                        <div className="text-sm">
                                            {balance.balance && (
                                                <div>
                                                    <span className="text-muted-foreground">
                                                        Balance:{" "}
                                                    </span>
                                                    <span className="text-white">
                                                        {formatThousands(
                                                            balance.balance?.toDecimal(),
                                                            balance.balance.getPrecision(),
                                                        )}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    }
                                >
                                    {balance.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <FormMessage />
                </FormItem>
            )}
        />
    );

export default TokenSelection;
