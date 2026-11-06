//! X-MCP: the node-local MCP endpoint at `x-mcp.<root>/` (see
//! mcp-server-on-chain-v2.md). Schema-and-builder only: it never signs or pushes.

pub mod jsonschema;
pub mod rpc;

#[psibase::service(name = "x-mcp")]
#[allow(non_snake_case)]
mod service {
    use crate::rpc::{self, ChainView, HeadTapos, PackageInfo};
    use psibase::services::transact;
    use psibase::services::packages::{InstalledPackageTable, InstalledSchemaTable, SERVICE as PACKAGES};
    use psibase::*;

    struct LiveChain;

    /// Read another service's objective tables. Local services go through
    /// `x-db`, which refuses other services' prefixes, so (as a privileged
    /// local service) open the handle natively, read-only.
    fn foreign<T: Table<R>, R: TableRecord>(service: AccountNumber) -> T {
        let prefix = (service, T::TABLE_INDEX).to_key();
        T::from_handle(KvHandle::open_direct(R::DB, &prefix, KvMode::Read))
    }

    impl ChainView for LiveChain {
        fn packages(&self) -> Vec<PackageInfo> {
            foreign::<InstalledPackageTable, _>(PACKAGES)
                .get_index_pk()
                .iter()
                .map(|p| PackageInfo { name: p.name, description: p.description, services: p.services })
                .collect()
        }
        fn schema(&self, service: AccountNumber) -> Option<Schema> {
            foreign::<InstalledSchemaTable, _>(PACKAGES)
                .get_index_pk()
                .get(&service)
                .map(|s| s.schema)
        }
        /// Same calls as CommonApi's GET /common/tapos/head, plus the
        /// current block time as "now".
        fn head_tapos(&self) -> HeadTapos {
            let t = transact::Wrapper::call();
            let (ref_block_index, ref_block_suffix) = t.headTapos();
            HeadTapos { ref_block_index, ref_block_suffix, now_seconds: t.currentBlock().time.seconds().seconds }
        }
    }

    fn header<'a>(req: &'a HttpRequest, name: &str) -> Option<&'a str> {
        req.headers
            .iter()
            .find(|h| h.name.eq_ignore_ascii_case(name))
            .map(|h| h.value.as_str())
    }

    /// MCP Streamable HTTP endpoint at the root of the x-mcp subdomain.
    #[action]
    fn serveSys(request: HttpRequest, _socket: Option<i32>, _user: Option<AccountNumber>) -> Option<HttpReply> {
        if request.path() != "/" {
            return None;
        }
        let root = request.host.strip_prefix("x-mcp.").unwrap_or(&request.host).to_string();
        let r = rpc::handle(
            &rpc::Req {
                method: &request.method,
                origin: header(&request, "Origin"),
                root_host: &root,
                protocol_version: header(&request, "MCP-Protocol-Version"),
                mcp_method: header(&request, "Mcp-Method"),
                mcp_name: header(&request, "Mcp-Name"),
                body: &request.body.0,
            },
            &LiveChain,
        );
        Some(HttpReply {
            status: r.status,
            contentType: "application/json".into(),
            body: Hex(r.body.map(|b| b.to_string().into_bytes()).unwrap_or_default()),
            headers: r.headers.into_iter().map(|(name, value)| HttpHeader { name, value }).collect(),
        })
    }
}
