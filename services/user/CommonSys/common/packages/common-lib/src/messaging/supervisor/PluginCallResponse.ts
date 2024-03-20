const PLUGIN_CALL_RESPONSE = "PLUGIN_CALL_RESPONSE" as const;

export interface PluginCallResponse<T = any> {
  type: typeof PLUGIN_CALL_RESPONSE;
  result: T;
}

export const isPluginCallResponse = (data: any): data is PluginCallResponse =>
  data && data.type == PLUGIN_CALL_RESPONSE

export const buildPluginCallResponse = <T>(
  result: T
): PluginCallResponse<T> => ({
  type: PLUGIN_CALL_RESPONSE,
  result,
});
