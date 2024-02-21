import { Outlet } from "react-router-dom";

import { useInitilize } from "../store/hooks/useInitialize";
import { psiboardApplet } from "../service";

export const Layout = () => {
  useInitilize(psiboardApplet);

  return (
    <main className="psibase max-w-screen-xs xs:mt-8 xs:h-auto mx-auto h-full space-y-4 bg-white px-2 py-4">
      <Outlet />
    </main>
  );
};
