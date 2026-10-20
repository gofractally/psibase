import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { siblingUrl } from "@psibase/common-lib";

import { NetworkLogo } from "@shared/components/network-logo";
import { useCurrentUser } from "@shared/hooks/use-current-user";

import { AdminPage } from "./components/admin-page";
import { DoneStep } from "./components/done-step";
import { FailedStep } from "./components/failed-step";
import { Loader } from "./components/loader";
import { NotOpen } from "./components/not-open";
import { RequestWizard } from "./components/request-wizard";
import { hasReturnedFromImport } from "./lib/import-return";
import { isRequestsOpen } from "./lib/portal-api";
import { forgetSignup } from "./lib/signup-request";

const STATUS_QUERY_KEY = ["status"];

const Requests = () => {
    const queryClient = useQueryClient();
    const {
        data: isOpen,
        isPending,
        isError,
    } = useQuery({
        queryKey: STATUS_QUERY_KEY,
        queryFn: isRequestsOpen,
    });

    if (isPending) return <Loader />;
    if (isError) return <FailedStep />;
    if (!isOpen) return <NotOpen />;
    return (
        <RequestWizard
            onClosed={() =>
                void queryClient.invalidateQueries({
                    queryKey: STATUS_QUERY_KEY,
                })
            }
        />
    );
};

const isAdminPath = () =>
    window.location.pathname === "/admin" ||
    window.location.pathname === "/admin/";

const Visitor = () => {
    const returnedFromImport = hasReturnedFromImport();
    const { data: currentUser, isPending } = useCurrentUser({
        enabled: returnedFromImport,
    });
    const account = returnedFromImport ? currentUser : null;

    useEffect(() => {
        if (account) forgetSignup();
    }, [account]);

    if (returnedFromImport && isPending) return <Loader />;
    if (account) return <DoneStep account={account} />;
    // With no one logged in (e.g. a revisited `?imported` link after logout), start a new request.
    return <Requests />;
};

export const App = () => (
    <>
        <header className="bg-background/80 sticky top-0 z-10 flex h-16 shrink-0 items-center border-b px-4 backdrop-blur">
            <NetworkLogo
                onClick={() => {
                    window.top!.location.href = siblingUrl();
                }}
            />
        </header>
        {isAdminPath() ? <AdminPage /> : <Visitor />}
    </>
);
