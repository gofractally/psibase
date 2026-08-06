#[psibase::service(name = "profiles+1")]
#[allow(non_snake_case)]
mod service {
    use async_graphql::*;
    use profiles::tables::{AvatarTable, Profile};
    use psibase::*;

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

    /// Serves `GET|HEAD /avatar/<account>` from the Profiles avatar table.
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

        let Some(avatar) = AvatarTable::read().get_index_pk().get(&account) else {
            return Some(not_found());
        };

        let Some(content_type) = profiles::content_type_mime(avatar.content_type) else {
            return Some(not_found());
        };

        let mut headers = allow_cors_with_origin("*");
        headers.push(HttpHeader::new("X-Content-Type-Options", "nosniff"));
        headers.push(HttpHeader::new("Cache-Control", "no-cache"));

        let body = if request.method == "HEAD" {
            Hex(Vec::new())
        } else {
            Hex(avatar.content)
        };

        Some(HttpReply {
            status: HttpStatus::Ok as u16,
            contentType: content_type.into(),
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
