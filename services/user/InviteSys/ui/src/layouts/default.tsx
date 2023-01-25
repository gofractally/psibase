import { Outlet } from "react-router-dom";

export const Layout = () => {
    return (
        <main className="psibase max-w-screen-xs xs:mt-8 xs:h-auto mx-auto h-full space-y-4 bg-white px-2 py-4">
            <Outlet />
        </main>
    );
};
