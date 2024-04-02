import { siblingUrl } from "@psibase/common-lib";

const App = () => {
    return (
        <div className="flex h-screen w-screen flex-col">
            Under construction...
            <ul>
                <li>
                    <a href={siblingUrl(null, "explorer", null, false)}>
                        Explorer
                    </a>
                </li>
                <li>
                    <a href={siblingUrl(null, "docs", null, false)}>Docs</a>
                </li>
            </ul>
        </div>
    );
};

export default App;
