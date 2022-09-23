import { useCallback, useEffect, useMemo, useState } from "react";

import { HandleMessage, NewAppletState } from "../types";
import { AppletStates } from "../config";
import { getIframeId } from "../helpers";

const appletStyles: { [key: number]: React.CSSProperties } = {
    [AppletStates.primary]: {
        margin: 0,
        padding: 0,
    },
    [AppletStates.headless]: {
        display: "none",
    },
    [AppletStates.modal]: {
        padding: 0,
        position: "absolute",
        width: 400,
        height: 266,
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
    },
};

interface Props {
    applet: NewAppletState;
    handleMessage: HandleMessage;
}

export const Applet = ({ applet, handleMessage }: Props) => {
    const [appletSrc, setAppletSrc] = useState("");

    const { appletId, state, onInit } = applet;

    const iFrameId = useMemo(() => getIframeId(appletId), [appletId]);

    useEffect(() => {
        const doSetAppletSrc = async () => {
            setAppletSrc(await appletId.url());
        };
        doSetAppletSrc();
    }, [appletId]);

    useEffect(() => {
        // Set document title
        if (appletId && state === AppletStates.primary) {
            window.document.title = appletId.name;
        }
    }, [appletId, state]);

    const doHandleMessage = useCallback(
        (request: any) => {
            handleMessage(appletId, request);
        },
        [appletId, handleMessage]
    );

    useEffect(() => {
        if (appletSrc && appletId) {
            console.info(`Initializing applet ${appletId}: ${appletSrc}`);
            // Configure iFrameResizer
            const iFrame = document.getElementById(iFrameId);
            if (iFrame) {
                // TODO - Fix error: Failed to execute 'postMessage' on 'DOMWindow'
                //        https://github.com/gofractally/psibase/issues/107
                (window as any).iFrameResize(
                    {
                        // All options: https://github.com/davidjbradshaw/iframe-resizer/blob/master/docs/parent_page/options.md
                        // log: true,
                        checkOrigin: true,
                        autoResize: false,
                        scrolling: true,
                        onMessage: doHandleMessage,
                        onInit,
                        minHeight:
                            document.documentElement.scrollHeight -
                            iFrame.getBoundingClientRect().top,
                        maxHeight:
                            document.documentElement.scrollHeight -
                            iFrame.getBoundingClientRect().top,
                    },
                    "#" + iFrameId
                )[0].iFrameResizer;
            }
        }
    }, [appletSrc, appletId, onInit, iFrameId, doHandleMessage]);

    return appletId && appletSrc ? (
        <iframe
            id={iFrameId}
            style={appletStyles[state!]}
            src={appletSrc}
            allow="camera;microphone"
            title={appletId.name}
            frameBorder="0"
        />
    ) : null;
};

export default Applet;
