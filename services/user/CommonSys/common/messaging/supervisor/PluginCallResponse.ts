const PLUGIN_CALL_RESPONSE = "PLUGIN_CALL_RESPONSE" as const;

export interface PluginCallResponse<T = any> {
  type: typeof PLUGIN_CALL_RESPONSE;
  payload: {
    id: string;
    result: T;
  };
}

export const isPluginCallResponse = (data: any): data is PluginCallResponse =>
  data &&
  data.type == PLUGIN_CALL_RESPONSE &&
  typeof data.payload.id == "string";

export const buildPluginCallResponse = <T>(
  id: string,
  result: T
): PluginCallResponse<T> => ({
  type: PLUGIN_CALL_RESPONSE,
  payload: {
    id,
    result,
  },
});
