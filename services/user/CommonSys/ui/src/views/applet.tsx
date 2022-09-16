import { useCallback, useEffect, useState } from "react";

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
    const { appletId, state, onInit } = applet;
    const [appletSrc, setAppletSrc] = useState("");

    const iFrameId = getIframeId(appletId);

    useEffect(() => {
        let doSetAppletSrc = async () => {
            setAppletSrc(await appletId.url());
        };
        doSetAppletSrc();
    }, []);

    useEffect(() => {
        // Set document title
        if (appletId && state === AppletStates.primary) {
            window.document.title = appletId.name;
        }
    }, []);

    let doHandleMessage = useCallback((request: any) => {
        handleMessage(appletId, request);
    }, []);

    useEffect(() => {
        // Configure iFrameResizer
        let iFrame = document.getElementById(iFrameId);
        if (iFrame) {
            // TODO - Fix error: Failed to execute 'postMessage' on 'DOMWindow'
            //        https://github.com/gofractally/psibase/issues/107
            (window as any).iFrameResize(
                {
                    // All options: https://github.com/davidjbradshaw/iframe-resizer/blob/master/docs/parent_page/options.md
                    // log: true,
                    checkOrigin: true,
                    heightCalculationMethod: "lowestElement",
                    onMessage: doHandleMessage,
                    onInit,
                    minHeight:
                        document.documentElement.scrollHeight -
                        iFrame.getBoundingClientRect().top,
                },
                "#" + iFrameId
            )[0].iFrameResizer;
        }
    }, [appletSrc]);

    if (!appletId || !appletSrc) return null;

    return (
        <iframe
            id={iFrameId}
            style={appletStyles[state!]}
            src={appletSrc}
            allow="camera;microphone"
            title={appletId.name}
            frameBorder="0"
        />
    );
};

export default Applet;
