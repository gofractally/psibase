import { useEffect, useState } from "react";

import { type PluginId } from "@psibase/common-lib";
import { getSupervisor } from "@lib/supervisor";

import { useUser } from "./use-user";
import { AppStatus } from "@types";

interface SupervisorError {
    code: number;
    producer: PluginId;
    message: string;
}

export interface Metadata {
    name: string;
    shortDescription: string;
    longDescription: string;
    icon: string;
    iconMimeType: string;
    tosSubpage: string;
    privacyPolicySubpage: string;
    appHomepageSubpage: string;
    status: AppStatus;
    tags: string[];
    redirectUris: string[];
    owners: string[];
}

export interface MetadataRes {
    appMetadata: Metadata;
    extraMetadata: {
        createdAt: string;
    };
}

export const useMetadata = () => {
    const { user } = useUser();
    const [currentMetadata, setCurrentMetadata] = useState<
        MetadataRes | undefined
    >();

    const getMetadata = async (acc: string) => {
        const supervisor = await getSupervisor();
        console.info("got supervisor!!!", supervisor);
        try {
            const res = (await supervisor.functionCall({
                service: "registry",
                intf: "consumer",
                method: "getAppMetadata",
                params: [acc],
            })) as MetadataRes;

            console.info("plugin registry getMetadata call res", res);
            return res;
        } catch (e: unknown) {
            console.error(
                `getMetadata error: ${(e as SupervisorError).message}`,
                e,
            );
        }
    };

    const setMetadata = async (metadata: Metadata) => {
        const supervisor = await getSupervisor();
        try {
            console.info({ metadata });
            await supervisor.functionCall({
                service: "registry",
                intf: "developer",
                method: "setAppMetadata",
                params: [
                    {
                        ...metadata,
                        status: Number(metadata.status),
                    },
                ],
            });
        } catch (e: unknown) {
            console.error(
                `setMetadata error: ${(e as SupervisorError).message}`,
                e,
            );
            throw e;
        }
    };

    useEffect(() => {
        (async () => {
            console.log({ user });
            if (user) {
                console.info("loading metadata for current user", user);
                const metadata = await getMetadata(user);
                if (metadata) {
                    setCurrentMetadata(metadata);
                }
            } else {
                setCurrentMetadata(undefined);
            }
        })();
    }, [user]);

    return {
        currentMetadata,
        getMetadata,
        setMetadata,
    };
};
