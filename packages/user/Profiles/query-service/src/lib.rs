#[psibase::service(name = "profiles+1")]
#[allow(non_snake_case)]
mod service {
    use async_graphql::*;
    use profiles::tables::Profile;
    use psibase::services::sites::Wrapper as Sites;
    use psibase::*;

    const AVATAR_PATH: &str = "/profile/avatar.image";
    const AVATAR_PREFIX: &str = "/avatar/";

    struct Query;

    #[Object]
    impl Query {
        async fn profile(&self, account: AccountNumber) -> Option<Profile> {
            profiles::Wrapper::call().getProfile(account)
        }
    }

    fn etag_for(hash: &Checksum256) -> String {
        Hex(&hash.0[..8]).to_string()
    }

    fn not_found() -> HttpReply {
        HttpReply {
            status: HttpStatus::NotFound as u16,
            contentType: "text/html".into(),
            body: Hex(b"Not Found".to_vec()),
            headers: allow_cors_with_origin("*"),
        }
    }

    /// Proxies `GET|HEAD /avatar/<account>` from the profiles subdomain to the
    /// avatar stored on that account's Sites content (`/profile/avatar.image`).
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

        let etag = etag_for(&props.contentHash);

        if request
            .get_header("If-None-Match")
            .is_some_and(|v| v == etag)
        {
            let mut headers = allow_cors_with_origin("*");
            headers.push(HttpHeader::new("ETag", &etag));
            return Some(HttpReply {
                status: HttpStatus::NotModified as u16,
                contentType: String::new(),
                body: Hex(Vec::new()),
                headers,
            });
        }

        let body = if request.method == "HEAD" {
            Hex(Vec::new())
        } else {
            Hex(Sites::call().getData(account, AVATAR_PATH.into(), true))
        };

        let mut headers = allow_cors_with_origin("*");
        headers.push(HttpHeader::new("Cache-Control", "no-cache"));
        headers.push(HttpHeader::new("ETag", &etag));

        Some(HttpReply {
            status: HttpStatus::Ok as u16,
            contentType: props.contentType,
            body,
            headers,
        })
    }

    #[action]
    #[allow(non_snake_case)]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        None.or_else(|| serve_avatar(&request))
            .or_else(|| serve_graphql(&request, Query))
            .or_else(|| serve_graphiql(&request))
    }
}
