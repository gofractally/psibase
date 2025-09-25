import { ActiveAndUpcoming } from "../evaluations/active-and-upcoming"
import { Completed } from "../evaluations/completed"



export const Guild = () => {


    return <div className="mx-auto w-full max-w-screen-lg p-4 px-6">
        <div className="flex h-9 items-center">
            <h1 className="text-lg font-semibold">All members</h1>
        </div>
        <div className="mt-3 flex flex-col gap-3">
            <div className="border rounded-sm border-sm">
                <ActiveAndUpcoming />
            </div>
            <div className="border rounded-sm border-sm">
                <Completed />
            </div>
        </div>
    </div>
}