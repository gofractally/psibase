import { Outlet } from "react-router-dom";

function Root() {
    return (
        <div className="mx-auto flex min-h-dvh w-full items-center justify-center">
            <Outlet />
        </div>
    );
}

export default Root;
