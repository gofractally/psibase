import { Mail } from "@components/mail";

import { accounts, mails } from "./fixtures/data";

export default function App() {
    // const layout = cookies().get("react-resizable-panels:layout")
    // const collapsed = cookies().get("react-resizable-panels:collapsed")

    // const defaultLayout = layout ? JSON.parse(layout) : undefined;
    // const defaultCollapsed = collapsed ? JSON.parse(collapsed) : undefined;

    return <Mail accounts={accounts} mails={mails} navCollapsedSize={4} />;
}
