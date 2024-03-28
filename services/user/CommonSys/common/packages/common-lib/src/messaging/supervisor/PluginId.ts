export interface PluginId {
    service: string;
    plugin?: string;
}

export interface QualifiedPluginId extends PluginId {
    plugin: string;
}
