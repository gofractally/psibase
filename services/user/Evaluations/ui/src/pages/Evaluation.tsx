import { useCloseEvaluation } from "@hooks/app/use-close-evaluation";
import { useCurrentUser } from "@hooks/use-current-user";
import { useEvaluation } from "@hooks/app/use-evaluation";
import { useGroups } from "@hooks/app/use-groups";
import { useRegister } from "@hooks/app/use-register";
import { useStartEvaluation } from "@hooks/app/use-start-evaluation";
import { useUnregister } from "@hooks/app/use-unregister";
import { useUsers } from "@hooks/app/use-users";
import { getStatus, Types } from "@lib/getStatus";
import { humanize } from "@lib/humanize";
import { Button } from "@shadcn/button";
import dayjs from "dayjs";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useInterval, useLocalStorage } from "usehooks-ts";
import { Switch } from "@shadcn/switch";

const defaultRefreshInterval = 10000;

export const EvaluationPage = () => {
    const { id } = useParams();
    const { data: currentUser } = useCurrentUser();

    const [refreshInterval, setRefreshInterval] = useState<number>(
        defaultRefreshInterval,
    );
    const [ticks, setTick] = useState<number>(0);
    const { data: evaluation, error: evaluationError } = useEvaluation(
        currentUser,
        Number(id),
    );
    const { mutate: register, isPending: isRegisterPending } = useRegister();
    const { mutate: unregister, isPending: isUnregisterPending } =
        useUnregister();

    const { data: users, error: usersError } = useUsers(
        evaluation?.id,
        refreshInterval,
    );
    const { data: groups, error: groupsError } = useGroups(evaluation?.id);
    const {
        mutateAsync: startEvaluation,
        isPending: isStartEvaluationPending,
        isError: isStartEvaluationError,
    } = useStartEvaluation();

    useInterval(() => {
        setTick(ticks + 1);
    }, 1000);

    const [autoStart, setAutoStart] = useLocalStorage(`autoStart-${id}`, false);

    const {
        mutateAsync: closeEvaluation,
        isPending: isCloseEvaluationPending,
        isSuccess: isCloseEvaluationSuccess,
    } = useCloseEvaluation();

    const isRegistered = (users || []).some(
        (user) => user.user === currentUser,
    );

    const isNoUser = currentUser === null;

    const status =
        evaluation &&
        users &&
        currentUser &&
        groups &&
        getStatus(evaluation, currentUser, users, groups);

    useEffect(() => {
        const userIsAwaitingStart =
            status &&
            status.type == "awaitingEvaluationStart" &&
            !status.userShouldStart;

        if (userIsAwaitingStart && refreshInterval > 1000) {
            setRefreshInterval(1000);
        }
    }, [status]);

    useEffect(() => {
        if (
            autoStart &&
            status &&
            status.type === Types.AwaitingEvaluationStart &&
            status.userShouldStart &&
            !isStartEvaluationError &&
            !isStartEvaluationPending
        ) {
            startEvaluation({
                id: evaluation!.id,
                entropy: Math.floor(1000000 * Math.random()),
            });
        }
    }, [autoStart, status]);

    const navigate = useNavigate();

    useEffect(() => {
        if (
            status &&
            (status.type === Types.DeliberationPendingParticipant ||
                status.type == Types.UserMustSubmit)
        ) {
            navigate(`/${id}/${status.groupNumber}`);
        }
    }, [status]);

    if (isNoUser) {
        return <div>You need to be logged in to access this page</div>;
    }
    if (!status) {
        return <div>Loading...</div>;
    }

    return (
        <div className="flex h-full w-full flex-col ">
            <div className="text-2xl font-bold">Evaluation {id}</div>

            {status.type === Types.Pending && (
                <div>
                    <div>
                        Registration starts at{" "}
                        {dayjs
                            .unix(status.registrationStarts)
                            .format("ddd MMM D, HH:mm")}
                    </div>
                    <div>
                        <Button disabled={true}>
                            Register in{" "}
                            {humanize(
                                dayjs
                                    .unix(status.registrationStarts)
                                    .diff(dayjs()),
                            )}
                        </Button>
                    </div>
                </div>
            )}

            {status.type === Types.RegistrationAvailable && (
                <div className="flex flex-col gap-2">
                    <div>Registration is available.</div>
                    <div>
                        {dayjs
                            .unix(evaluation.deliberationStarts)
                            .format("ddd MMM D, HH:mm")}{" "}
                        ({" "}
                        {humanize(
                            dayjs
                                .unix(evaluation!.deliberationStarts)
                                .diff(dayjs()),
                        )}
                        )
                    </div>
                    <div className="flex w-full justify-center">
                        <Button
                            disabled={isRegisterPending || isRegistered}
                            onClick={() => {
                                register(evaluation!.id);
                            }}
                        >
                            {isRegisterPending
                                ? "Registering..."
                                : isRegistered
                                  ? "Registered"
                                  : "Register"}
                        </Button>
                    </div>
                    {status.userIsHost && (
                        <div className="flex w-full items-center justify-center gap-2">
                            <div>Auto start evaluation</div>

                            <Switch
                                checked={autoStart}
                                onCheckedChange={(e) => {
                                    setAutoStart(e);
                                }}
                            />
                        </div>
                    )}
                </div>
            )}
            {status.type === Types.RegisteredAwaitingDeliberation && (
                <div className="flex flex-col gap-2">
                    <div>You are registered for this evaluation </div>
                    <div>
                        Deliberation starts at{" "}
                        {dayjs
                            .unix(status.deliberationStarts)
                            .format("ddd MMM D, HH:mm")}
                    </div>
                    <div>
                        {humanize(
                            dayjs.unix(status.deliberationStarts).diff(dayjs()),
                        )}
                    </div>
                    <div className="flex w-full justify-center">
                        <Button
                            disabled={isUnregisterPending}
                            variant="outline"
                            onClick={() => {
                                if (
                                    window.confirm(
                                        "Are you sure you want to unregister?",
                                    )
                                ) {
                                    unregister(evaluation!.id);
                                }
                            }}
                        >
                            {isUnregisterPending
                                ? "Unregistering..."
                                : "Unregister"}
                        </Button>
                    </div>
                    {status.userIsHost && (
                        <div className="flex w-full items-center justify-center gap-2">
                            <div>Auto start evaluation</div>
                            <Switch
                                checked={autoStart}
                                onCheckedChange={(e) => {
                                    setAutoStart(e);
                                }}
                            />
                        </div>
                    )}
                </div>
            )}
            {status.type === Types.AwaitingEvaluationStart && (
                <div>
                    <div>Awaiting evaluation start...</div>
                    {status.userShouldStart ? (
                        <Button
                            disabled={isStartEvaluationPending}
                            onClick={() => {
                                startEvaluation({
                                    id: evaluation!.id,
                                    entropy: Math.floor(
                                        1000000 * Math.random(),
                                    ),
                                });
                            }}
                        >
                            {isStartEvaluationPending
                                ? "Starting..."
                                : "Start evaluation"}
                        </Button>
                    ) : (
                        <div className="text-sm text-muted-foreground">
                            Awaiting the evaluation to be started by the owner.
                        </div>
                    )}
                </div>
            )}
            {status.type === Types.DeliberationPendingParticipant && (
                <div>
                    <div>Deliberation</div>
                    <div>
                        Sending you to group number {status.groupNumber}...
                    </div>
                </div>
            )}
            {status.type === Types.EvaluationNotStartedInTime && (
                <div>
                    <div>Evaluation not started in time</div>

                    {isCloseEvaluationSuccess && <div>Evaluation closed</div>}
                    {status.userShouldDelete && !isCloseEvaluationSuccess && (
                        <div>
                            <Button
                                disabled={isCloseEvaluationPending}
                                onClick={() => {
                                    closeEvaluation(evaluation!.id);
                                }}
                            >
                                {isCloseEvaluationPending
                                    ? "Closing..."
                                    : "Close evaluation"}
                            </Button>
                        </div>
                    )}
                </div>
            )}

            {status.type === Types.DeliberationPendingSpectator && (
                <div>
                    You are a spectator and not included in this evaluation.
                </div>
            )}
            {status.type === Types.UserMustSubmit && (
                <div>
                    <div>*Redirect to submission page*</div>
                </div>
            )}
            {status.type === Types.CanWatchResults && (
                <div className="grid w-full grid-cols-2 gap-2  sm:grid-cols-3">
                    {status.groups.map((group) => (
                        <div key={group.number} className="rounded-sm border">
                            <div className="text-center text-lg font-semibold">
                                Group {group.number}
                            </div>
                            {group.result && (
                                <div className="flex flex-col text-center">
                                    {group.result.map((r) => (
                                        <div key={r}>{r}</div>
                                    ))}
                                </div>
                            )}
                            <div>
                                Members:{" "}
                                {users
                                    .filter(
                                        (u) => u.groupNumber === group.number,
                                    )
                                    .map((u) => u.user)
                                    .sort((a, b) => a.localeCompare(b))
                                    .join(", ")}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
