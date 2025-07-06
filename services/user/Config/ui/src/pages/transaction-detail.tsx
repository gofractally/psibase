import { useParams } from "react-router-dom";

export const TransactionDetail = () => {
    const { id } = useParams();

    return (
        <div className="mx-auto h-screen w-screen max-w-screen-lg">
            Transaction Detail {id}
        </div>
    );
};
