const PLUGIN_CALL_RESPONSE = "PLUGIN_CALL_RESPONSE" as const;

export interface AddableAction {
  service: string;
  action: string;
  args: Uint8Array;
}

export interface PluginCallResponse<T = any> {
  type: typeof PLUGIN_CALL_RESPONSE;
  result: T;
  actions: AddableAction[];
}

export const isPluginCallResponse = (data: any): data is PluginCallResponse =>
  data && data.type == PLUGIN_CALL_RESPONSE

export const buildPluginCallResponse = <T>(
  result: T,
  actions: AddableAction[],
): PluginCallResponse<T> => ({
  type: PLUGIN_CALL_RESPONSE,
  result,
  actions,
});
