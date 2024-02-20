import { AppletId, MessageTypes } from "@psibase/common-lib";
import { AppletStates } from "./config";

export type HandleMessage = (sender: AppletId, request: any) => void;

type AppletMetaValue = (typeof AppletStates)[keyof typeof AppletStates];

// TODO: These sorely need to be generalized and combined into one! It's all just applet metadata.
export interface AppletMeta {
    appletStr: string;
    subPath: string;
    state?: AppletMetaValue;
}

export interface ReceiverAppletMeta {
    rApplet: string;
    rSubPath: string;
    state?: AppletMetaValue;
}

export interface SenderAppletMeta {
    applet: string;
    subPath: string;
    state?: AppletMetaValue;
}

export type ResponseAppletMeta = SenderAppletMeta;

export interface AppletState extends AppletMeta {
    onInit: () => void;
}

export interface NewAppletMeta {
    appletId: AppletId;
    state?: AppletMetaValue;
}

export interface NewAppletState extends NewAppletMeta {
    onInit: () => void;
}

export type MessageTypeValue = (typeof MessageTypes)[keyof typeof MessageTypes];

export type ReplyWithCallbackId = {
    response: any;
    errors: any[];
    callbackId?: number;
};
