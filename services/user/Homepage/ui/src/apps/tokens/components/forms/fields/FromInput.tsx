import { FormSchema } from "@/apps/tokens/hooks/useTokenForm";
import { FC } from "react";
import { UseFormReturn } from "react-hook-form";

import {
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@shared/shadcn/ui/form";
import { Input } from "@shared/shadcn/ui/input";

interface Props {
    form: UseFormReturn<FormSchema>;
    disable?: boolean;
}

const FromInput: FC<Props> = ({ form, disable }) => (
    <FormField
        control={form.control}
        name="from"
        disabled={disable}
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
