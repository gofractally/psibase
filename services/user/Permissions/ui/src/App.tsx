import { useEffect } from "react";

import { Nav } from "@/components/nav";

import { supervisor } from "./main";

export const App = () => {
    const init = async () => {
        await supervisor.onLoaded();
    };

    useEffect(() => {
        init();
    }, []);

    return (
        <div className="mx-auto h-screen w-screen max-w-screen-lg">
            <Nav title="Permissions Admin Page" />
        </div>
    );
};
