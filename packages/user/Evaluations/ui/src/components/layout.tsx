import { Outlet } from "react-router-dom";

import { Nav } from "./nav";

export const Layout = () => {
    return (
        <div className="mx-auto h-screen w-screen max-w-screen-lg">
            <Nav title="Evaluations" />
            <Outlet />
        </div>
    );
};
