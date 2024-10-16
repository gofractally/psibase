import { useEffect, useState } from "react";

import { type PluginId } from "@psibase/common-lib";
import { getSupervisor } from "@lib/supervisor";

import { useUser } from "./use-user";

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
    status: string;
    tags: string[];
    redirectUris: string[];
    owners: string[];
}

export interface MetadataRes {
    metadata: {
        name: string;
        shortDescription: string;
        longDescription: string;
        icon: string;
        iconMimeType: string;
        tosSubpage: string;
        privacyPolicySubpage: string;
        appHomepageSubpage: string;
        status: string;
        tags: string[];
        redirectUris: string[];
        owners: string[];
    };
    tags: {
        id: number;
        tag: string;
    }[];
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
                service: "workshop",
                intf: "consumer",
                method: "getAppMetadata",
                params: [acc],
            })) as MetadataRes;

            console.info("plugin workshop getMetadata call res", res);
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
            await supervisor.functionCall({
                service: "workshop",
                intf: "developer",
                method: "setAppMetadata",
                params: [
                    metadata.name,
                    metadata.shortDescription,
                    metadata.longDescription,
                    metadata.icon,
                    metadata.iconMimeType,
                    metadata.tosSubpage,
                    metadata.privacyPolicySubpage,
                    metadata.appHomepageSubpage,
                    metadata.status,
                    metadata.tags,
                    metadata.redirectUris,
                    metadata.owners,
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
