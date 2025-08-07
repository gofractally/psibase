import { Outlet } from "react-router-dom";

import { Nav } from "./components/nav";

function Root() {
    return (
        <div className="mx-auto mt-4 w-full max-w-screen-lg">
            <Nav />
            <Outlet />
        </div>
    );
}

export default Root;
