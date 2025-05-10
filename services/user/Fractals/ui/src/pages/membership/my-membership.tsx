import { Button } from "@/components/ui/button";
import { useCurrentFractal } from "@/hooks/useCurrentFractal";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useFractal } from "@/hooks/useFractal";
import { useJoinFractal } from "@/hooks/useJoinFractal";
import { useMembership } from "@/hooks/useMembership";
import { getMemberLabel } from "@/lib/getMemberLabel";



export const MyMembership = () => {
    const fractalAccount = useCurrentFractal();
    const { data: currentUser } = useCurrentUser();

    const { data: fractal } = useFractal(fractalAccount);
    const { data: membership, error } = useMembership(
        fractalAccount,
        currentUser,
    );

    const { mutateAsync: joinFractal } = useJoinFractal()

    console.log({ fractalAccount, currentUser, membership });

    const status = membership == null ? "Not a member" : membership ? getMemberLabel(membership.memberStatus) : 'Loading...';

    return (
        <div className="w-full max-w-screen-xl p-4">
            <h1 className="text-lg font-semibold">My membership</h1>
            <div>
                <div>Fractal</div>
                {JSON.stringify(fractal)}
            </div>
            <div>
                <div>Membership - {status}</div>
                {JSON.stringify(membership || error)}
            </div>
            {membership == null && <div>
                Not a member
                <Button onClick={() => {
                    joinFractal({
                        fractal: fractalAccount!
                    })
                }}>Join fractal</Button>
            </div>}
        </div>
    );
};
