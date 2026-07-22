import type { UUID } from "crypto";

import {
    QualifiedFunctionCallArgs,
    QualifiedPluginId,
} from "@psibase/common-lib";

// This is the part of the supervisor interface exposed to front-end apps
export interface AppInterface {
    preloadPlugins: (
        callerOrigin: string,
        id: string,
        plugins: QualifiedPluginId[],
    ) => Promise<void>;

    entry: (
        callerOrigin: string,
        id: UUID,
        args: QualifiedFunctionCallArgs,
    ) => Promise<void>;

    getJson: (
        callerOrigin: string,
        id: string,
        plugin: QualifiedPluginId,
    ) => Promise<void>;
}
