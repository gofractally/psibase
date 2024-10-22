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
            const tags = (await supervisor.functionCall({
                service: "registry",
                intf: "consumer",
                method: "getRelatedTags",
                params: [tag],
            })) as string[];
            console.info("plugin registry getRelatedTags call res", tags);
            return { tags };
        } catch (e: unknown) {
            console.error(`${(e as SupervisorError).message}`, e);
        }
    };

    return {
        getRelatedTags,
    };
};
