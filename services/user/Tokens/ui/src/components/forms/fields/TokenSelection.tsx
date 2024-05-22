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
import { formatThousands } from "@/lib/formatNumber";
import { cn } from "@/lib/utils";
import { Plus } from "lucide-react";
import { FC } from "react";
import { UseFormReturn } from "react-hook-form";

export interface TrackedToken {
  id: string;
  label: string;
  amount: number;
  isAdmin: boolean;
  isGenericToken: boolean;
}

interface Props {
  tokens: TrackedToken[];
  form: UseFormReturn<any>;
  setNewTokenModalOpen: (open: boolean) => void;
}

const TokenSelection: FC<Props> = ({ tokens, form, setNewTokenModalOpen }) => (
  <FormField
    control={form.control}
    name="token"
    render={({ field }) => (
      <FormItem>
        <FormLabel>Token</FormLabel>
        <Select onValueChange={field.onChange} defaultValue={field.value}>
          <FormControl>
            <div className="w-full grid grid-cols-6">
              <SelectTrigger className="col-span-5">
                <SelectValue placeholder="No token selected." />
              </SelectTrigger>
              <Button
                type="button"
                onClick={() => setNewTokenModalOpen(true)}
                variant="secondary"
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
                  "text-muted-foreground": balance.isGenericToken,
                })}
                value={balance.id}
                // @ts-ignore
                right={
                  <div className="text-sm text-muted-foreground">
                    Balance: {formatThousands(balance.amount)}
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
