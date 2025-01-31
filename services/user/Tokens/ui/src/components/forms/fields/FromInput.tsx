import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
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
        <div className="flex justify-between">
          <FormLabel>From</FormLabel>
        </div>
        <FormControl>
          <Input {...field} placeholder="Account" />
        </FormControl>
        <FormMessage />
      </FormItem>
    )}
  />
);

export default FromInput;
