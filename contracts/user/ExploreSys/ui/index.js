import { useGraphQLPagedQuery } from '/common/useGraphQLQuery.mjs';
import { siblingUrl } from '/common/rootdomain.mjs';
import htm from 'https://unpkg.com/htm@3.1.0?module';
const html = htm.bind(React.createElement);

const App = () => {
    const query = `{
        blocks(@page@) {
            pageInfo {
                hasPreviousPage
                hasNextPage
                startCursor
                endCursor
            }
            edges {
                node {
                    header {
                        blockNum
                        previous
                        time
                    }
                }
            }
        }
    }`;
    const [autoUpdateMode, setAutoUpdateMode] = React.useState(true);
    const pagedResult = useGraphQLPagedQuery('/graphql', query, {
        pageSize: 10,
        getPageInfo: (result) => result.data?.blocks.pageInfo,
        defaultArgs: `last: 10`
    });
    const tdStyle = { border: "1px solid" };
    
    React.useEffect(()=>{
        let interval
        if (autoUpdateMode) {
            interval = setInterval(()=>{
                pagedResult.last();
            }, 1000)
        } else {
            clearInterval(interval);
        }
        return ()=> {
            clearInterval(interval);
        }
    }, [autoUpdateMode]);

    const processPagingRequests = (pagingFn) => {
        setAutoUpdateMode(false);
        pagingFn();
    }

    if (!pagedResult.result.data) {
        return html`<div>Loading data...</div>`;
    }
    return html`
        <div class="ui container">
            <a href=${siblingUrl()}>chain</a>
            <h1>explore-sys</h1>
        
            <button onClick=${()=>processPagingRequests(pagedResult.first)}>First</button>
            <button disabled=${!pagedResult.hasPreviousPage} onClick=${()=>processPagingRequests(pagedResult.previous)}>Previous</button>
            <button disabled=${!pagedResult.hasNextPage} onClick=${()=>processPagingRequests(pagedResult.next)}>Next</button>
            <button onClick=${()=>processPagingRequests(pagedResult.last)}>Last</button>
            <button disabled=${autoUpdateMode} onClick=${()=>setAutoUpdateMode(true)}>${autoUpdateMode ? "(auto-updating)" : "Auto-Update Mode"}</button>
            <table>
                <tbody>
                    <tr>
                        <th style=${tdStyle}>Block</th>
                        <th style=${tdStyle}>Previous</th>
                        <th style=${tdStyle}>Time</th>
                    </tr>
                    ${pagedResult.result.data?.blocks.edges.reverse().map?.(e => html`<tr>
                        <td style=${tdStyle}>${e.node.header.blockNum}</td>
                        <td style=${tdStyle}>
                            <pre>${e.node.header.previous}</pre>
                        </td>
                        <td style=${tdStyle}>${e.node.header.time}</td>
                    </tr>`)}
                </tbody>
            </table>
        </div>`;
};

const container = document.getElementById('root');
const root = ReactDOM.createRoot(container);
root.render(html`<${App} />`);
