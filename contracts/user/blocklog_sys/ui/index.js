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
                        num
                        previous
                        time
                    }
                }
            }
        }
    }`;
    const pagedResult = useGraphQLPagedQuery('/graphql', query, 10, (result) => result.data?.blocks.pageInfo);
    const tdStyle = { border: "1px solid" };
    return html`
        <div>
            <a href=${siblingUrl()}>psibase</a>
            <h1>blocklog-sys</h1>
        
            <button onClick=${pagedResult.first}>First</button>
            <button disabled=${!pagedResult.hasPreviousPage} onClick=${pagedResult.previous}>Previous</button>
            <button disabled=${!pagedResult.hasNextPage} onClick=${pagedResult.next}>Next</button>
            <button onClick=${pagedResult.last}>Last</button>
            <table>
                <tbody>
                    <tr>
                        <th style=${tdStyle}>Block</th>
                        <th style=${tdStyle}>Previous</th>
                        <th style=${tdStyle}>Time</th>
                    </tr>
                    ${pagedResult.result.data?.blocks.edges.map?.(e => html`<tr>
                        <td style=${tdStyle}>${e.node.header.num}</td>
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
