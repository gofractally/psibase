import { Button } from "@/components/ui/button";
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Token } from "@/hooks/tokensPlugin/useBalances";
import { formatThousands } from "@/lib/formatNumber";
import { cn } from "@/lib/utils";
import { Plus } from "lucide-react";
import { FC } from "react";
import { UseFormReturn } from "react-hook-form";

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
    <Skeleton className="w-full h-12" />
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
              <div className="w-full flex items-center gap-1">
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
                    "text-muted-foreground": !!balance.symbol,
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
                              balance.balance.getPrecision()
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
