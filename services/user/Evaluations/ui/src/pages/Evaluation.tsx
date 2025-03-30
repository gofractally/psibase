import { useCurrentUser } from "@hooks/use-current-user";
import { useEvaluation } from "@hooks/use-evaluation";
import { useRegister } from "@hooks/use-register";
import { useUsers } from "@hooks/use-users";
import { type Evaluation } from "@lib/getEvaluation";
import { humanize } from "@lib/humanize";
import { Button } from "@shadcn/button";
import dayjs from "dayjs";
import { useParams } from "react-router-dom";
import { z } from "zod";

const zStatus = z.enum([
    "pending",
    "registration",
    "deliberation",
    "submission",
    "finished",
]);

const getStatus = (evaluation: Evaluation): z.infer<typeof zStatus> => {
    const currentTime = dayjs().unix();
    if (currentTime >= evaluation.finishBy) {
        return zStatus.Values.finished;
    }
    if (currentTime >= evaluation.submissionStarts) {
        return zStatus.Values.submission;
    }
    if (currentTime >= evaluation.deliberationStarts) {
        return zStatus.Values.deliberation;
    }
    if (currentTime >= evaluation.registrationStarts) {
        return zStatus.Values.registration;
    }
    return zStatus.Values.pending;
};

// TODO: status is based on time only but should also call it finished if the result for the evaluation is already published

export const EvaluationPage = () => {
    const { id } = useParams();

    const { data: evaluation } = useEvaluation(Number(id));
    console.log({ evaluation });
    const { mutate: register, isPending: isRegisterPending } = useRegister();
    const { data: currentUser } = useCurrentUser();

    const { data: users, error: usersError } = useUsers(evaluation?.id);
    console.log({ users, usersError });

    const isRegistered = (users || []).some(
        (user) => user.user === currentUser,
    );

    const isNoUser = currentUser === null;

    const status = evaluation && getStatus(evaluation);

    console.log({ id, evaluation, status });

    if (isNoUser) {
        return <div>You need to be logged in to access this page</div>;
    }

    return (
        <div className="flex h-full w-full flex-col items-center justify-center">
            <div className="text-2xl font-bold">Evaluation</div>

            {!status && <div>Loading...</div>}
            {status === "pending" && (
                <div>
                    <div>
                        Registration starts at{" "}
                        {dayjs
                            .unix(evaluation!.registrationStarts)
                            .format("ddd MMM D, HH:mm")}
                    </div>
                    <div>
                        <Button disabled={true}>
                            Register in{" "}
                            {humanize(
                                dayjs
                                    .unix(evaluation!.registrationStarts)
                                    .diff(dayjs()),
                            )}
                        </Button>
                    </div>
                </div>
            )}
            {status === "registration" && (
                <div>
                    {isRegistered && (
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
                        </div>
                    )}
                    {!isRegistered && (
                        <div>
                            Registration is open until{" "}
                            {dayjs
                                .unix(evaluation!.deliberationStarts)
                                .format("ddd MMM D, HH:mm")}
                        </div>
                    )}
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
            {status === "deliberation" && (
                <div>
                    <div>Deliberation</div>
                    {isRegistered && (
                        <div>
                            Your group has attested, awaiting the other groups
                            to do the same.
                        </div>
                    )}
                    {!isRegistered && (
                        <div>
                            Evaluation is in progress, will be completed by{" "}
                            {dayjs
                                .unix(evaluation!.finishBy)
                                .format("ddd MMM D, HH:mm")}
                            (
                            {humanize(
                                dayjs.unix(evaluation!.finishBy).diff(dayjs()),
                            )}
                            )
                        </div>
                    )}
                </div>
            )}
            {status === "submission" && <div>Submission</div>}
            {status === "finished" && <div>Finished</div>}
        </div>
    );
};
