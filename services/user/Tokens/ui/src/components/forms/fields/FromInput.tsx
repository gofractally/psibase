import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { FormSchema } from "@/hooks/useTokenForm";
import { FC } from "react";
import { UseFormReturn } from "react-hook-form";

interface Props {
  form: UseFormReturn<FormSchema>;
}

const FromInput: FC<Props> = ({ form }) => (
  <FormField
    control={form.control}
    name="from"
    render={({ field }) => (
      <FormItem>
        <FormLabel>From</FormLabel>
        <FormControl>
          <Input {...field} />
        </FormControl>
        <FormDescription>
          Account to decrease in balance, leave blank to burn your own balance.
        </FormDescription>
        <FormMessage />
      </FormItem>
    )}
  />
);

export default FromInput;
