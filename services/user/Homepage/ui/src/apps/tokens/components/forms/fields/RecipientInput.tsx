import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { FormSchema } from "@/apps/tokens/hooks/useTokenForm";
import { FC } from "react";
import { UseFormReturn } from "react-hook-form";

interface Props {
  form: UseFormReturn<FormSchema>;
  disableTo: boolean;
}

const RecipientInput: FC<Props> = ({ form, disableTo }) => (
  <FormField
    control={form.control}
    name="to"
    render={({ field }) => (
      <FormItem>
        <FormLabel className="flex justify-between">Recipient</FormLabel>
        <FormControl>
          <Input placeholder="Account" {...field} disabled={disableTo} />
        </FormControl>
        <FormMessage />
      </FormItem>
    )}
  />
);

export default RecipientInput;
