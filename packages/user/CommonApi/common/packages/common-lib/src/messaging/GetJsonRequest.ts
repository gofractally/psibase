import { QualifiedPluginId } from "./PluginId";
import { GET_JSON_REQUEST } from "./index";

export interface GetJsonRequest {
    type: typeof GET_JSON_REQUEST;
    id: string;
    payload: {
        plugin: QualifiedPluginId;
    };
}

export const isGetJsonRequest = (data: any): data is GetJsonRequest =>
    data && data.type == GET_JSON_REQUEST;

export const buildGetJsonRequest = (
    plugin: QualifiedPluginId,
): GetJsonRequest => ({
    type: GET_JSON_REQUEST,
    id: window.crypto.randomUUID?.() ?? Math.random().toString(),
    payload: {
        plugin,
    },
});
