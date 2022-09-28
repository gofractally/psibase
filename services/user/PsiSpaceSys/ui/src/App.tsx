import { useState } from "react";
import {
    initializeApplet,
    AppletId,
    query,
    setOperations,
} from "common/rpc.mjs";

import useEffectOnce from "./hooks/useEffectOnce";
import { operations } from "./operations";
import { Heading } from "./components";
import { FilesManager } from "./components/files-manager/files-manager";
import PsiSpaceIcon from "./assets/app-psispace-icon.svg";

const accountSys = new AppletId("account-sys", "");

export const getLoggedInUser = () => {
    return query<void, string>(accountSys, "getLoggedInUser");
};

function App() {
    const [currentUser, setCurrentUser] = useState("");

    useEffectOnce(() => {
        initializeApplet(async () => {
            setOperations(operations);
            const loggedInUser = await getLoggedInUser();
            setCurrentUser(loggedInUser);
        });
    }, []);

    return (
        <div className="mx-auto max-w-screen-xl space-y-4 p-2 sm:px-8">
            <div className="flex items-center gap-2">
                <PsiSpaceIcon />
                <Heading tag="h1" className="select-none text-gray-600">
                    PsiSpace
                </Heading>
            </div>

            {!currentUser ? (
                <p>Loading Logged User Account...</p>
            ) : (
                <FilesManager account={currentUser} />
            )}
        </div>
    );
}

export default App;
