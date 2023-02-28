import { NavBar } from ".";
import AlertBanners from "./alert-banners";

interface Props {
    children: React.ReactNode;
}

export const Layout = ({ children }: Props) => {
    return (
        <>
            <NavBar />
            <AlertBanners />
            <main className="mx-auto w-full max-w-screen-lg flex-1 py-4 md:px-5">
                {children}
            </main>
        </>
    );
};

export default Layout;
