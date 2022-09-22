import { AccountWithAuth } from "../App";
import closedIcon from "./assets/icons/lock-closed.svg";
import openIcon from "./assets/icons/lock-open.svg";

export const AccountsList = ({
    accounts,
}: { accounts: AccountWithAuth[] }) => {
    return (
        <div>
            <h2 className="pt-6">Existing accounts</h2>
            <table className="min-w-full table-fixed">
                <thead className="text-slate-900">
                    <tr>
                        <th scope="col" className="py-3.5 w-full text-left text-sm font-semibold text-gray-900">
                            Account
                        </th>
                        <th scope="col" className="py-3.5 w-full text-left text-sm font-semibold text-gray-900">
                            Security
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {accounts.map((account) => (
                        <tr key={account.accountNum} className="w-8 h-12">
                            <td>
                                <div className="w-32 text-lg">{account.accountNum}</div>
                            </td>
                            <td className="">
                                <div className="w-8">
                                    {account.authService == 'auth-any-sys' ? <img src={openIcon} alt={account.authService} /> : <img src={closedIcon} alt={account.authService} />}
                                </div>
                            </td>
                        </tr>
                    ))}

                </tbody>
            </table>
        </div>
    );
};
