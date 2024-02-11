const PLUGIN_CALL_REQUEST = "PLUGIN_CALL_REQUEST" as const;

export interface FunctionCallArgs {
  service: string;
  method: string;
  params: any[];
}

export interface PluginCallRequest {
  type: typeof PLUGIN_CALL_REQUEST;
  payload: {
    id: string;
    args: any[];
  };
}

export const isPluginCallRequest = (data: any): data is PluginCallRequest =>
  data &&
  data.type == PLUGIN_CALL_REQUEST &&
  typeof data.payload.id == "string";

export const buildPluginCallRequest = (
  id: string,
  args: any[]
): PluginCallRequest => ({
  type: PLUGIN_CALL_REQUEST,
  payload: {
    id,
    args,
  },
});
