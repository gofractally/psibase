import { useParams } from "react-router-dom"


export const ApplicationDetail = () => {


    const { applicant } = useParams();

    return <div className="mx-auto w-full max-w-screen-lg p-4 px-6">
        <div className="flex h-9 items-center">
            <h1 className="text-lg font-semibold">Application {applicant
            }</h1>
        </div>
    </div>
}