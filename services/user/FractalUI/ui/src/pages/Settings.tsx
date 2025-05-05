import { Spinner } from "@/components/ui/spinner";

import { ControlPanel } from "@/components/control-panel";
import { ErrorCard } from "@/components/error-card";
import { MetaDataForm } from "@/components/metadata-form";

import { useAccountStatus } from "@/hooks/useAccountStatus";
import { useAppMetadata } from "@/hooks/useAppMetadata";
import { useCurrentFractal } from "@/hooks/useCurrentFractal";
import { useSetMetadata } from "@/hooks/useSetMetadata";
import { Account } from "@/lib/zodTypes";

export const Settings = () => {
    const currentFractal = useCurrentFractal();

    const {
        data: metadata,
        isLoading,
        isSuccess,
        error: metadataError,
    } = useAppMetadata(currentFractal);

    const { data: accountStatus } = useAccountStatus(currentFractal);
    const invalidAccountError =
        accountStatus == "Invalid"
            ? new Error(`Invalid account name`)
            : undefined;

    const { mutateAsync: updateMetadata } = useSetMetadata();

    const error = metadataError || invalidAccountError;

    if (error) {
        return <ErrorCard error={error} />;
    } else if (isLoading) {
        return (
            <div className="flex h-dvh w-full justify-center">
                <div>
                    <div className="flex w-full justify-center">
                        <Spinner
                            size="lg"
                            className="bg-black text-center dark:bg-white"
                        />
                    </div>
                    <div>Fetching app metadata...</div>
                </div>
            </div>
        );
    } else
        return (
            <div className="mx-auto grid w-full max-w-screen-xl grid-cols-1 gap-8 p-4 lg:grid-cols-2">
                {isSuccess && (
                    <MetaDataForm
                        key={currentFractal}
                        existingValues={
                            metadata ? metadata.appMetadata : undefined
                        }
                        onSubmit={async (x) => {
                            await updateMetadata({
                                metadata: {
                                    ...x,
                                    owners: [],
                                },
                                account: Account.parse(currentFractal),
                            });
                            return x;
                        }}
                    />
                )}
                <div>
                    <ControlPanel />
                </div>
            </div>
        );
};
