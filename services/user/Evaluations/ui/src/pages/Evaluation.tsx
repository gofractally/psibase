import { useCloseEvaluation } from "@hooks/use-close-evaluation";
import { useCurrentUser } from "@hooks/use-current-user";
import { useEvaluation } from "@hooks/use-evaluation";
import { useGroups } from "@hooks/use-groups";
import { useRegister } from "@hooks/use-register";
import { useStartEvaluation } from "@hooks/use-start-evaluation";
import { useUsers } from "@hooks/use-users";
import { getStatus } from "@lib/getStatus";
import { humanize } from "@lib/humanize";
import { Button } from "@shadcn/button";
import dayjs from "dayjs";
import { useParams } from "react-router-dom";

export const EvaluationPage = () => {
    const { id } = useParams();

    const { data: evaluation } = useEvaluation(Number(id));
    const { mutate: register, isPending: isRegisterPending } = useRegister();
    const { data: currentUser } = useCurrentUser();
    const { data: users } = useUsers(evaluation?.id);
    const { data: groups } = useGroups(evaluation?.id);
    const {
        mutateAsync: startEvaluation,
        isPending: isStartEvaluationPending,
    } = useStartEvaluation();

    const {
        mutateAsync: closeEvaluation,
        isPending: isCloseEvaluationPending,
        isSuccess: isCloseEvaluationSuccess,
    } = useCloseEvaluation();

    const isRegistered = (users || []).some(
        (user) => user.user === currentUser,
    );

    console.log({ groups });

    const isNoUser = currentUser === null;

    const status =
        evaluation &&
        users &&
        currentUser &&
        groups &&
        getStatus(evaluation, currentUser, users, groups);

    if (isNoUser) {
        return <div>You need to be logged in to access this page</div>;
    }
    if (!status) {
        return <div>Loading...</div>;
    }

    console.log({ status });

    return (
        <div className="flex h-full w-full flex-col items-center justify-center">
            <div className="text-2xl font-bold">Evaluation</div>

            {status.type === "pending" && (
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

            {status.type === "registrationAvailable" && (
                <div>
                    <div>You are registered for this evaluation </div>
                    <div>
                        {dayjs
                            .unix(evaluation!.deliberationStarts)
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
                </div>
            )}
            {status.type === "registeredAwaitingDeliberation" && (
                <div>
                    <div>You are registered for this evaluation </div>
                    <div>
                        Deliberation starts at{" "}
                        {dayjs
                            .unix(status.deliberationStarts)
                            .format("ddd MMM D, HH:mm")}
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
                </div>
            )}
            {status.type === "awaitingEvaluationStart" && (
                <div>
                    <div>Evaluation about to start...</div>
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
            {status.type === "deliberationPendingAsParticipant" && (
                <div>
                    <div>Deliberation</div>
                    <div>
                        Deliberation is in progress, will be completed by{" "}
                        {dayjs
                            .unix(status.deliberationDeadline)
                            .format("ddd MMM D, HH:mm")}
                        (
                        {humanize(
                            dayjs
                                .unix(status.deliberationDeadline)
                                .diff(dayjs()),
                        )}
                        )
                    </div>
                </div>
            )}
            {status.type === "evaluationNotStartedInTime" && (
                <div>
                    <div>Evaluation not started in time</div>
                    
                    {isCloseEvaluationSuccess && <div>Evaluation closed</div>}
                    {status.userShouldDelete && !isCloseEvaluationSuccess && (
                        <div>
                            <Button
                                disabled={isCloseEvaluationPending}
                                onClick={() => {
                                    closeEvaluation({ id: evaluation!.id });
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

            {status.type === "userMustSubmit" && (
                <div>
                    <div>*Redirect to submission page*</div>
                </div>
            )}
            {status.type === "canWatchResults" && (
                <div>
                    <div>Submission is pending...</div>
                    <div>
                        Will be completed by{" "}
                        {dayjs
                            .unix(status.submissionDeadline)
                            .format("ddd MMM D, HH:mm")}
                    </div>
                    <div>**Show current results**</div>
                </div>
            )}
        </div>
    );
};
