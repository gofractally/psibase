#[allow(warnings)]
mod bindings;
use bindings::*;

mod helpers;
use helpers::*;

use exports::host::auth::api::Guest as Api;

use psibase::fracpack::{Pack, Unpack};

use crate::bindings::{
    host::{
        client::api as CallContext,
        db::store::{Bucket, Database, DbMode, StorageDuration},
    },
    supervisor::bridge::{
        intf as Supervisor,
        types::{BodyTypes, Header, HttpRequest},
    },
};

struct HostAuth;

const DB: Database = Database {
    mode: DbMode::NonTransactional,
    duration: StorageDuration::Persistent,
};

fn query_tokens_table(user: &str) -> Bucket {
    Bucket::new(DB, &format!("query_tokens-{}", user))
}

fn get_query_token(user: &str, app: &str) -> Option<String> {
    query_tokens_table(user)
        .get(app)
        .map(|t| String::unpacked(&t).unwrap())
}

fn post_to_app(app: &str, endpoint: &str, body: String) -> HttpRequest {
    HttpRequest {
        uri: format!(
            "{}/{}",
            CallContext::get_app_url(app),
            endpoint.trim_start_matches('/')
        ),
        method: "POST".to_string(),
        headers: vec![Header {
            key: "Content-Type".to_string(),
            value: "application/json".to_string(),
        }],
        body: Some(BodyTypes::Json(body)),
    }
}

fn set_auth_cookie(query_token: &str, app: &str) {
    let req = post_to_app(
        app,
        "/common/set-auth-cookie",
        format!("{{\"accessToken\": \"{}\"}}", query_token),
    );
    Supervisor::send_request(&req, true).unwrap();
}

fn remove_auth_cookie(app: &str) {
    let req = post_to_app(app, "/common/remove-auth-cookie", "{}".to_string());
    Supervisor::send_request(&req, true).unwrap();
}

/// Browser-session credentials: query tokens and auth cookies.
/// Host-only (+ supervisor for `get-active-query-token`).
impl Api for HostAuth {
    fn set_session(user: String, app: String, token: String) {
        check_caller(&["host"], "set-session@host:auth/api");
        query_tokens_table(&user).set(&app, &token.packed());
        set_auth_cookie(&token, &app);
    }

    fn clear_session(user: String, app: String) {
        check_caller(&["host"], "clear-session@host:auth/api");
        remove_auth_cookie(&app);
        query_tokens_table(&user).delete(&app);
    }

    fn get_active_query_token(app: String, user: String) -> Option<String> {
        check_caller(
            &["host", "supervisor"],
            "get-active-query-token@host:auth/api",
        );
        get_query_token(&user, &app)
    }
}

bindings::export!(HostAuth with_types_in bindings);
