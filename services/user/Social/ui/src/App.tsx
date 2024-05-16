import { Mail } from "./components/mail";
import { accounts, mails } from "./fixtures/data";

export default function App() {
    // const layout = cookies().get("react-resizable-panels:layout")
    // const collapsed = cookies().get("react-resizable-panels:collapsed")

    // const defaultLayout = layout ? JSON.parse(layout.value) : undefined
    // const defaultCollapsed = collapsed ? JSON.parse(collapsed.value) : undefined

    return (
        <Mail
            accounts={accounts}
            mails={mails}
            defaultLayout={undefined}
            defaultCollapsed={undefined}
            // defaultLayout={defaultLayout}
            // defaultCollapsed={defaultCollapsed}

            navCollapsedSize={4}
        />
    );
}
