import { Outlet } from "react-router-dom";
import { Nav } from "./components/nav";

export const Root = () => {
    return (
        <div className="mx-auto h-screen w-screen max-w-screen-lg">
            <Nav />
            <Outlet />
        </div>
    );
};
