import { ControlPanel } from "@/components/control-panel";
import { MetaDataForm } from "@/components/metadata-form";

import { useAccountStatus } from "@/hooks/use-account-status";
import { useAppMetadata } from "@/hooks/use-app-metadata";
import { useCurrentApp } from "@/hooks/use-current-app";
import { useSetMetadata } from "@/hooks/use-set-metadata";

import { ErrorCard } from "@shared/components/error-card";
import { Spinner } from "@shared/components/spinner";
import { zAccount } from "@shared/lib/schemas/account";

export const Settings = () => {
    const currentApp = useCurrentApp();

    const {
        data: metadata,
        isLoading,
        isSuccess,
        error: metadataError,
    } = useAppMetadata(currentApp);

    const { data: accountStatus } = useAccountStatus(currentApp);
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
                        key={currentApp}
                        existingValues={
                            metadata
                                ? {
                                      name: metadata.name,
                                      shortDesc: metadata.shortDesc,
                                      longDesc: metadata.longDesc,
                                      icon: metadata.icon,
                                      iconMimeType: metadata.iconMimeType,
                                      tags: metadata.tags,
                                  }
                                : undefined
                        }
                        onSubmit={async (x) => {
                            await updateMetadata({
                                metadata: {
                                    ...x,
                                },
                                account: zAccount.parse(currentApp),
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
