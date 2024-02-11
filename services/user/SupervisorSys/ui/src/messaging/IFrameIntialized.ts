export const I_FRAME_INITIALIZED = "I_FRAME_INITIALIZED" as const;

export interface IFrameInitialized {
  type: typeof I_FRAME_INITIALIZED;
  payload: {};
}

export const isIFrameIntialized = (
  message: any
): message is IFrameInitialized => {
  // TODO add further assertions on expectations in the payload.
  return message && message.type == I_FRAME_INITIALIZED;
};

export const buildMessageIFrameInitialized = (): IFrameInitialized => ({
  payload: {},
  type: "I_FRAME_INITIALIZED",
});
