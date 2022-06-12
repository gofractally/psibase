import {siblingUrl} from '/common/rootdomain.mjs';
import {useGraphQLPagedQuery} from '/common/useGraphQLQuery.mjs';
import htm from 'https://unpkg.com/htm@3.1.0?module';

const html = htm.bind(React.createElement);

var tokenHeaders = [{value: 'Symbol'}, {value: 'Balance'}];

function Nav()
{
   return html`
      <div class="ui secondary menu">
         <a class="item" href=${siblingUrl()}>
            Home
         </a>
         <a class="active item">
            Wallet
         </a>
         <div class="right menu">
            <div class="item">
               <div class="ui icon input">
                  <input type="text" placeholder="Search..." />
                  <i class="search link icon"></i>
               </div>
            </div>
            <a class="ui item">
               Logout
            </a>
         </div>
      </div>
   `;
}

function Headers(headers)
{
   return html`<tr>
      ${headers.map(x => {
      return html`<th>${x.value}</th>`;
   })}
   </tr>`;
}

function Table()
{
   return html`
      <table class="ui celled table">
         <thead>
            ${Headers(tokenHeaders)}
         </thead>
         <tbody>
            <tr>
               <td>Key</td>
               <td>Val</td>
            </tr>
            <tr>
               <td>Key</td>
               <td>Val</td>
            </tr>
         </tbody>
      </table>
   `;
}

/* GQL Schema:
type BalanceKey_t {
    account: String!
    tokenId: Float!
}
type BalanceRecord {
    key: BalanceKey_t!
    balance: String!
}
type BalanceRecordEdge {
    node: BalanceRecord!
    cursor: String!
}
type PageInfo {
    hasPreviousPage: Boolean!
    hasNextPage: Boolean!
    startCursor: String!
    endCursor: String!
}
type BalanceRecordConnection {
    edges: [BalanceRecordEdge!]!
    pageInfo: PageInfo!
}
type Query {
    balances(gt: Float ge: Float lt: Float le: Float first: Float last: Float before: String after: String): BalanceRecordConnection!
}
*/


const App = () => {
   const query = `{
           balances(@page@) {
               pageInfo {
                   hasPreviousPage
                   hasNextPage
                   startCursor
                   endCursor
               }
               edges {
                   node {
                       key {
                          account
                          tokenId
                       }
                       balance
                   }
               }
           }
       }`;
   const pagedResult =
       useGraphQLPagedQuery('/graphql', query, 10, (result) => result.data?.blocks.pageInfo);

   return html`
      <div class="ui container">
         ${Nav()}
         <h2>Token Balances</h2>
         ${Table()}
      </div>
   `;

   //    const tdStyle = {border: '1px solid'};
   //    return html`
   //         <div>
   //             <a href=${siblingUrl()}>psibase</a>
   //             <h1>explore-sys</h1>

   //             <button onClick=${pagedResult.first}>First</button>
   //             <button disabled=${!pagedResult.hasPreviousPage} onClick=${
   //        pagedResult.previous}>Previous</button>
   //             <button disabled=${!pagedResult.hasNextPage} onClick=${pagedResult.next}>Next</button>
   //             <button onClick=${pagedResult.last}>Last</button>
   //             <table>
   //                 <tbody>
   //                     <tr>
   //                         <th style=${tdStyle}>Block</th>
   //                         <th style=${tdStyle}>Previous</th>
   //                         <th style=${tdStyle}>Time</th>
   //                     </tr>
   //                     ${pagedResult.result.data?.blocks.edges.map?.(e => html`<tr>
   //                         <td style=${tdStyle}>${e.node.header.blockNum}</td>
   //                         <td style=${tdStyle}>
   //                             <pre>${e.node.header.previous}</pre>
   //                         </td>
   //                         <td style=${tdStyle}>${e.node.header.time}</td>
   //                     </tr>`)}
   //                 </tbody>
   //             </table>
   //         </div>`;
};

const container = document.getElementById('root');
const root      = ReactDOM.createRoot(container);
root.render(html`<${App} />`);
