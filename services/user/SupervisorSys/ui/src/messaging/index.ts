import { IFrameInitialized } from "./IFrameIntialized";

type MessageToParent = IFrameInitialized;

export const sendMessageToParent = (message: MessageToParent) => {
  window.parent.postMessage(message, "*");
};

export const sendMessageToService = (service: string) => {
  // TODO send message
  console.log(service);
};
