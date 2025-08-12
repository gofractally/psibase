import { useEffect, useState } from "react";

import {
    FunctionCallArgs,
    type Supervisor,
    siblingUrl,
} from "@psibase/common-lib";

function withArgs(
    service: string,
    plugin: string,
    intf: string,
    method: string,
    params: unknown[] = [],
): FunctionCallArgs {
    return {
        service,
        plugin,
        intf,
        method,
        params,
    };
}

export function LoginBar({ supervisor }: { supervisor: Supervisor }) {
    const [currentUser, setCurrentUser] = useState<string | null>(null);

    useEffect(() => {
        const fetchUser = async () => {
            try {
                const user = await supervisor.functionCall(
                    withArgs("accounts", "plugin", "api", "getCurrentUser"),
                );
                setCurrentUser(user || null);
            } catch (e) {
                alert("Error fetching current user: " + e);
            }
        };

        fetchUser();
    }, [supervisor]);

    const handleClick = async () => {
        try {
            if (currentUser) {
                await supervisor.functionCall(
                    withArgs("accounts", "plugin", "activeApp", "logout"),
                );
                setCurrentUser(null);
            } else {
                console.log(
                    "CommonApi::LoginBar::handleClick().calling createConnectionToken",
                );
                const token = await supervisor.functionCall(
                    withArgs(
                        "accounts",
                        "plugin",
                        "activeApp",
                        "createConnectionToken",
                    ),
                );

                window.location.href = siblingUrl(
                    null,
                    "accounts",
                    `/?token=${encodeURIComponent(token)}`,
                );
            }
        } catch (e) {
            console.error("Error logging out or in: ", e);
            alert("Error logging out or in: " + e);
        }
    };

    return (
        <div className="login-bar">
            <button onClick={handleClick} className="common-button">
                {currentUser ? currentUser : "Connect account"}
            </button>
        </div>
    );
}
