import {
    QualifiedFunctionCallArgs,
} from "@psibase/common-lib";
import { AddableAction } from "@psibase/supervisor-lib/messaging/PluginCallResponse";
import { OriginationData } from "./utils";

// This is the host interface exposed to plugins
export interface HostInterface {

    syncCall: (args: QualifiedFunctionCallArgs) => any;

    addAction: (actions: AddableAction) => void;

    getCaller: () => OriginationData | undefined;

    getSelf: () => OriginationData;
}
