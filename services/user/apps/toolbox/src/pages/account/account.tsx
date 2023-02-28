import { Link } from "react-router-dom";

import { Layout } from "components";

export const Account = () => {
    return (
        <Layout>
            <div className="flex h-full items-center justify-center text-2xl text-gray-800">
                <Link to="/">&larr; go back home &larr;</Link>
            </div>
        </Layout>
    );
};

export default Account;
