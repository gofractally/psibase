export interface PluginId {
    service: string;
    plugin?: string;
}

export interface QualifiedPluginId extends PluginId {
    plugin: string;
}

export function isEqual(
    id1: QualifiedPluginId,
    id2: QualifiedPluginId,
): boolean {
    return id1.service === id2.service && id1.plugin === id2.plugin;
}
