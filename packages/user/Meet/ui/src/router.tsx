import { createBrowserRouter } from "react-router-dom";

import { Layout } from "@/components/layout";
import { Home } from "@/pages/home";
import { PrivateRoom } from "@/pages/private-room";
import { Room } from "@/pages/room";

export const router = createBrowserRouter([
    {
        path: "/",
        element: <Layout />,
        children: [
            { index: true, element: <Home /> },
            { path: "room/:roomId", element: <Room /> },
            { path: "private/:meetingId", element: <PrivateRoom /> },
        ],
    },
]);
