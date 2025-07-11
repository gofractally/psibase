import { CircleSlash2 } from "lucide-react";
import { useParams } from "react-router-dom";

import { EmptyBlock } from "@/components/empty-block";

import { useEvaluationResults } from "@/hooks/fractals/use-evaluation-results";

import { cn } from "@shared/lib/utils";
import { Badge } from "@shared/shadcn/ui/badge";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";

// const data = [
//     {
//         groupNumber: 1,
//         users: ["sparky", "val"],
//         result: ["sparky", "val"],
//     },
//     {
//         groupNumber: 2,
//         users: ["myprod", "alice", "bob", "carol", "dave"],
//         result: ["dave", "bob", "myprod", "alice", "carol"],
//     },
//     {
//         groupNumber: 3,
//         users: ["dan", "brandon", "james", "john", "mike", "steven"],
//         result: ["james", "john", "mike", "brandon"],
//     },
//     {
//         groupNumber: 4,
//         users: ["neo", "trinity", "morpheus"],
//         result: undefined,
//     },
// ];

export const EvaluationResult = () => {
    const { evaluationId } = useParams<{ evaluationId: string }>();

    const { data } = useEvaluationResults(Number(evaluationId));

    return (
        <div className="mx-auto w-full max-w-screen-lg p-4 px-6">
            <div className="flex h-9 items-center">
                <h1 className="text-lg font-semibold">
                    Results for evaluation {evaluationId}
                </h1>
            </div>
            <div className="mt-3">
                {data?.length === 0 ? (
                    <EmptyBlock title="No results found" />
                ) : (
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                        {data?.map((group) => {
                            const members = new Set(group.users);
                            const results = new Set(group.result);
                            const missing = members.difference(results);

                            return (
                                <Card
                                    key={`group-${group.groupNumber}`}
                                    className="overflow-hidden"
                                >
                                    <CardHeader className="bg-muted/50 p-4">
                                        <CardTitle className="flex items-center justify-between text-base font-semibold">
                                            Group {group.groupNumber}
                                            <Badge variant="outline">
                                                {group.users.length} members
                                            </Badge>
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="p-4">
                                        <ol className="space-y-3">
                                            {group.result?.map(
                                                (member, index) => (
                                                    <li
                                                        key={`group-${group.groupNumber}-member-${member}`}
                                                        className="flex items-center gap-4 rounded-md border p-2 transition-colors"
                                                    >
                                                        <div className="bg-background flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-medium">
                                                            {index + 1}
                                                        </div>
                                                        <span className="flex-1 text-sm font-medium">
                                                            {member}
                                                        </span>
                                                    </li>
                                                ),
                                            )}
                                        </ol>
                                        {missing.size > 0 && (
                                            <div
                                                className={cn(
                                                    "space-y-2",
                                                    missing.size !==
                                                        members.size && "mt-4",
                                                )}
                                            >
                                                <h4 className="text-center text-sm font-medium">
                                                    Not ranked
                                                </h4>
                                                <ol className="space-y-3">
                                                    {[...missing].map(
                                                        (member, index) => (
                                                            <li
                                                                key={index}
                                                                className="flex items-center gap-4 rounded-md border p-2 transition-colors"
                                                            >
                                                                <div className="bg-background flex h-8 w-8 items-center justify-center">
                                                                    <CircleSlash2 className="h-3/5 w-3/5" />
                                                                </div>
                                                                <span className="flex-1 text-sm font-medium">
                                                                    {member}
                                                                </span>
                                                            </li>
                                                        ),
                                                    )}
                                                </ol>
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};
