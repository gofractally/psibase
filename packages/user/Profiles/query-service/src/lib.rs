#[psibase::service(name = "profiles+1")]
#[allow(non_snake_case)]
mod service {
    use async_graphql::*;
    use profiles::tables::Profile;
    use psibase::services::http_server::Wrapper as HttpServer;
    use psibase::services::sites::Wrapper as Sites;
    use psibase::*;

    const AVATAR_PATH: &str = "/profile/avatar.avatar";
    const AVATAR_PREFIX: &str = "/avatar/";

    struct Query;

    #[Object]
    impl Query {
        async fn profile(&self, account: AccountNumber) -> Option<Profile> {
            profiles::Wrapper::call().getProfile(account)
        }
    }

    fn not_found() -> HttpReply {
        let mut headers = allow_cors_with_origin("*");
        headers.push(HttpHeader::new("X-Content-Type-Options", "nosniff"));
        HttpReply {
            status: HttpStatus::NotFound as u16,
            contentType: "text/html".into(),
            body: Hex(b"Not Found".to_vec()),
            headers,
        }
    }

    /// Proxies `GET|HEAD /avatar/<account>` from the profiles subdomain to the
    /// avatar stored on that account's Sites content (`/profile/avatar.avatar`).
    fn serve_avatar(request: &HttpRequest) -> Option<HttpReply> {
        if request.method != "GET" && request.method != "HEAD" {
            return None;
        }

        let path = request.path();
        let Some(account_str) = path.strip_prefix(AVATAR_PREFIX) else {
            return None;
        };

        if account_str.is_empty() {
            return Some(not_found());
        }

        let Ok(account) = AccountNumber::from_exact(account_str) else {
            return Some(not_found());
        };

        let Some(props) = Sites::call().getProps(account, AVATAR_PATH.into()) else {
            return Some(not_found());
        };

        if !profiles::is_allowed_content_type(&props.contentType) {
            return Some(not_found());
        }

        let root_host = HttpServer::call().rootHost(request.host.clone());
        let mut site_request = request.clone();
        site_request.host = format!("{account}.{root_host}");
        site_request.target = AVATAR_PATH.into();

        let Some(mut reply) = Sites::call().serveSys(site_request, None) else {
            return Some(not_found());
        };

        reply
            .headers
            .push(HttpHeader::new("X-Content-Type-Options", "nosniff"));
        if reply.status == HttpStatus::Ok as u16 {
            reply.contentType =
                profiles::normalize_content_type(&reply.contentType).to_ascii_lowercase();
        }

        Some(reply)
    }

    #[action]
    #[allow(non_snake_case)]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        None.or_else(|| serve_avatar(&request))
            .or_else(|| serve_graphql(&request, Query))
            .or_else(|| serve_graphiql(&request))
    }
}
