import { type PluginId } from "@psibase/common-lib";
import { getSupervisor } from "@lib/supervisor";

interface SupervisorError {
    code: number;
    producer: PluginId;
    message: string;
}

export interface AppTags {
    tags: string[];
}

export const useTags = () => {
    const getRelatedTags = async (tag: string) => {
        const supervisor = await getSupervisor();
        console.info("got supervisor!!!", supervisor);
        try {
            const res = (await supervisor.functionCall({
                service: "registry",
                intf: "consumer",
                method: "getRelatedTags",
                params: [tag],
            })) as AppTags;
            console.info("plugin registry getRelatedTags call res", res);
            return res;
        } catch (e: unknown) {
            console.error(`${(e as SupervisorError).message}`, e);
        }
    };

    return {
        getRelatedTags,
    };
};
