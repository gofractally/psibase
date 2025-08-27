import { useEffect /*, useState*/ } from "react";

import { getSupervisor, prompt } from "@psibase/common-lib";

import { Button } from "@shared/shadcn/ui/button";

const supervisor = getSupervisor();

export const App = () => {
    //const [error, _setError] = useState<string | null>(null);
    //const [_contextId, setContextId] = useState<string | null>(null);

    useEffect(() => {
        const initApp = async () => {
            // const cid = prompt.getContextId();
            // if (!cid) {
            //     return;
            // }
            //setContextId(cid);

            const result = await supervisor.functionCall({
                service: "accounts",
                intf: "activeApp",
                method: "getConnectedAccounts",
                params: [],
            });

            console.log(result);
        };

        initApp();
    }, []);

    // if (error) {
    //     return <div>{error}</div>;
    // }

    return (
        <div className="mx-auto h-screen w-screen max-w-screen-lg rounded border border-gray-200 p-6">
            <h3 className="text-4xl">Account connection</h3>

            <Button
                onClick={() => {
                    prompt.finished();
                }}
            >
                Finished
            </Button>
        </div>
    );
};
