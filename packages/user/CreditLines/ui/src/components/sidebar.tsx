import { useCurrentUser } from "@/hooks/use-current-user";




export const Sidebar = () => {


    const { data: currentUser } = useCurrentUser();
    // use fetch the credit relations for the current user here


    return (
        <div className="">
            Display the list of credit relations here. {currentUser}
        </div>
    );
}