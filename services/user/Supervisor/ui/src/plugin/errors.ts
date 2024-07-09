import {
    PluginError,
    QualifiedPluginId,
} from "@psibase/common-lib";

export class PluginDownloadFailed extends PluginError {
    constructor(pluginId: QualifiedPluginId) {
        super(pluginId, "Plugin download failed.");
    }
}

export class PluginInvalid extends PluginError {
    constructor(pluginId: QualifiedPluginId) {
        super(pluginId, "Plugin either invalid or called before ready.");
    }
}

export class InvalidCall extends PluginError {
    constructor(pluginId: QualifiedPluginId, intf: string | undefined, method: string) {
        super(pluginId, `Unrecognized call: ${intf ? `${intf}:${method}` : method }`);
    }
}
