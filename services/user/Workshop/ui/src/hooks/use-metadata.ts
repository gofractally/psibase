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
    tosSubpage: string;
    privacyPolicySubpage: string;
    appHomepageSubpage: string;
    status: string;
    icon: string;
    // TODO: complete this type
}

export const useMetadata = () => {
    const { user } = useUser();
    const [currentMetadata, setCurrentMetadata] = useState<
        Metadata | undefined
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
            })) as Metadata;
            console.info("plugin workshop getMetadata call res", res);
            return res;
        } catch (e: unknown) {
            console.error(`${(e as SupervisorError).message}`, e);
        }
    };

    const setMetadata = async (metadata: Partial<Metadata>) => {
        const supervisor = await getSupervisor();
        try {
            await supervisor.functionCall({
                service: "workshop",
                intf: "developer",
                method: "setAppMetadata",
                params: [
                    metadata.name ?? "",
                    metadata.shortDescription ?? "",
                    metadata.longDescription ?? "",
                    "", // todo: icon
                    metadata.tosSubpage ?? "",
                    metadata.privacyPolicySubpage ?? "",
                    metadata.appHomepageSubpage ?? "",
                    metadata.status ?? "",
                    [],
                ],
            });
        } catch (e: unknown) {
            console.error(`${(e as SupervisorError).message}`, e);
            throw e;
        }
    };

    useEffect(() => {
        (async () => {
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
