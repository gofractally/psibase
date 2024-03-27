import { useCallback, useEffect, useMemo, useState } from "react";

import { HandleMessage, NewAppletState } from "../types";
import { AppletStates } from "../config";
import { getIframeId } from "../helpers";

const appletStyles: { [key: number]: React.CSSProperties } = {
    [AppletStates.primary]: {
        margin: 0,
        padding: 0,
        width: "100vw",
        flex: 1,
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
            let url = await appletId.url();

            // If we're on the applet page, add the query params to the applet url
            if (window.location.pathname.startsWith(`/applet/${appletId}`)) {
                const { search, hash } = window.location;
                url += search + hash;
            }

            setAppletSrc(url);
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

    const initializeIFrame = () => {
        const iFrame = document.getElementById(iFrameId);
    };

    return appletId && appletSrc ? (
        <iframe
            id={iFrameId}
            style={appletStyles[state!]}
            src={appletSrc}
            allow="camera;microphone"
            title={appletId.name}
            onLoad={initializeIFrame}
        />
    ) : null;
};

export default Applet;
