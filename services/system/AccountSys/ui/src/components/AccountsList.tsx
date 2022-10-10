import { AccountWithAuth } from "../App";
import ClosedIcon from "./assets/icons/lock-closed.svg";
import OpenIcon from "./assets/icons/lock-open.svg";
import Heading from "./Heading";

export const AccountsList = ({ accounts }: { accounts: AccountWithAuth[] }) => {
    return (
        <section>
            <Heading tag="h2" className="font-medium text-gray-600">
                All accounts
            </Heading>
            <table className="min-w-full table-fixed">
                <thead className="text-slate-900">
                    <tr>
                        <th
                            scope="col"
                            className="w-full py-3.5 text-left text-sm font-semibold text-gray-900"
                        >
                            Account
                        </th>
                        <th
                            scope="col"
                            className="w-full py-3.5 text-left text-sm font-semibold text-gray-900"
                        >
                            Security
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {accounts.map((account) => (
                        <tr key={account.accountNum} className="h-12 w-8">
                            <td>
                                <div className="w-32 text-lg">
                                    {account.accountNum}
                                </div>
                            </td>
                            <td className="">
                                <div className="w-8">
                                    {account.authService == "auth-any-sys" ? (
                                        <OpenIcon />
                                    ) : (
                                        <ClosedIcon />
                                    )}
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </section>
    );
};
