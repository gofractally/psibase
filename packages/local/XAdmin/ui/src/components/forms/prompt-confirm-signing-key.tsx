import { withForm } from "@shared/components/form/app-form";
import { GlowingCard } from "@shared/components/glowing-card";
import {
    CardContent,
    CardDescription,
    CardTitle,
} from "@shared/shadcn/ui/card";

const formOptions = {
    defaultValues: {
        account: "",
        privateKey: "",
    },
};

export const PromptConfirmSigningKey = withForm({
    ...formOptions,
    render: ({ form }) => {
        const onKeyDown = (e: React.KeyboardEvent) => {
            if (e.key === "Enter") {
                form.handleSubmit();
            }
        };

        return (
            <GlowingCard className="w-xl mx-auto">
                <CardContent className="flex flex-col">
                    <div className="mb-6 flex-1 space-y-2">
                        <CardTitle className="text-3xl font-normal">
                            Confirm your account
                        </CardTitle>
                        <CardDescription>
                            Use your block producer account
                        </CardDescription>
                    </div>
                    <div className="flex flex-1 flex-col gap-4">
                        <form.AppField
                            name="account"
                            children={(field) => {
                                return (
                                    <field.TextField
                                        label="Account name"
                                        placeholder="Account name"
                                        onKeyDown={onKeyDown}
                                    />
                                );
                            }}
                        />
                        <form.AppField
                            name="privateKey"
                            children={(field) => {
                                return (
                                    <field.TextField
                                        type="password"
                                        label="Private key"
                                        placeholder="Private key"
                                        onKeyDown={onKeyDown}
                                    />
                                );
                            }}
                        />
                    </div>
                </CardContent>
            </GlowingCard>
        );
    },
});
