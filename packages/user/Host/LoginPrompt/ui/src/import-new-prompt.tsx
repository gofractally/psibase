import { useState } from "react";

import { prompt } from "@psibase/common-lib";

import { BrandedGlowingCard } from "@shared/components/branded-glowing-card";
import { ErrorCard } from "@shared/components/error-card";
import { pemToB64 } from "@shared/lib/b64-key-utils";
import { CardContent, CardDescription } from "@shared/shadcn/ui/card";
import { Progress } from "@shared/shadcn/ui/progress";

import { SaveAndConfirmKey, type KeyStep } from "./components/save-and-confirm-key";
import { Loader } from "./components/create-prompt/loader";
import { useConnectAccount } from "./hooks/use-connect-account";
import { useImportNewPrompt } from "./hooks/use-import-new-prompt";

export const ImportNewPrompt = () => {
    const { data, isPending, error } = useImportNewPrompt();
    const connectAccount = useConnectAccount();
    const [step, setStep] = useState<KeyStep>("save");

    if (error) {
        return (
            <ErrorCard
                error={error instanceof Error ? error : new Error(String(error))}
            />
        );
    }

    if (isPending || !data) {
        return <Loader />;
    }

    return (
        <BrandedGlowingCard>
            <div className="-mt-6 px-6">
                <Progress value={step === "save" ? 50 : 100} />
            </div>
            <CardContent className="pb-2">
                <CardDescription>
                    <span className="text-foreground font-semibold">
                        {data.app}
                    </span>{" "}
                    created this account for you
                </CardDescription>
            </CardContent>
            <SaveAndConfirmKey
                accountName={data.account}
                keyB64={pemToB64(data.key)}
                onStepChange={setStep}
                onImported={async (account) => {
                    await connectAccount.mutateAsync({
                        account,
                        login: data.login,
                    });
                    prompt.finished();
                }}
            />
        </BrandedGlowingCard>
    );
};
