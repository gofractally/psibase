import { FormSchema } from "@/apps/tokens/hooks/useTokenForm";
import { useFormContext } from "react-hook-form";

import {
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@shared/shadcn/ui/form";
import { Input } from "@shared/shadcn/ui/input";

interface Props {
    disabled?: boolean;
}

const RecipientInput = ({ disabled = false }: Props) => {
    const form = useFormContext<FormSchema>();
    return (
        <FormField
            control={form.control}
            name="to"
            render={({ field }) => (
                <FormItem>
                    <FormLabel className="flex justify-between">
                        Recipient
                    </FormLabel>
                    <FormControl>
                        <Input
                            placeholder="Account"
                            {...field}
                            disabled={disabled}
                        />
                    </FormControl>
                    <FormMessage />
                </FormItem>
            )}
        />
    );
};

export default RecipientInput;
