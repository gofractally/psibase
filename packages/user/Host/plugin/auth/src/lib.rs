#[allow(warnings)]
mod bindings;
use bindings::*;

mod errors;
use errors::ErrorType::MissingQueryToken;
mod helpers;
use helpers::*;

use exports::host::auth::api::Guest as Api;

use psibase::fracpack::{Pack, Unpack};

use crate::bindings::{
    host::{
        client::api as CallContext,
        db::store::{Bucket, Database, DbMode, StorageDuration},
        types::types::Error,
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

// User logged into each app; persistent so the login survives page loads
fn logged_in_user_table() -> Bucket {
    Bucket::new(DB, "logged_in_user")
}

// Query tokens per user, keyed by app
fn query_tokens_table(user: &str) -> Bucket {
    Bucket::new(DB, &format!("query_tokens-{}", user))
}

fn get_logged_in_user(app: &str) -> Option<String> {
    logged_in_user_table()
        .get(app)
        .map(|a| String::from_utf8(a).unwrap())
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

impl Api for HostAuth {
    fn is_logged_in() -> bool {
        Self::get_current_user().is_some()
    }

    fn get_current_user() -> Option<String> {
        get_logged_in_user(&CallContext::get_active_app())
    }

    fn get_logged_in_user(app: String) -> Option<String> {
        check_caller(&["host"], "get-logged-in-user@host:auth/api");
        get_logged_in_user(&app)
    }

    fn has_query_token(user: String, app: String) -> bool {
        check_caller(&["host"], "has-query-token@host:auth/api");
        get_query_token(&user, &app).is_some()
    }

    fn set_logged_in_user(user: String, app: String, token: Option<String>) -> Result<(), Error> {
        check_caller(&["host"], "set-logged-in-user@host:auth/api");

        let query_token = match token {
            Some(t) => {
                query_tokens_table(&user).set(&app, &t.packed());
                t
            }
            None => get_query_token(&user, &app)
                .ok_or_else(|| MissingQueryToken(user.clone(), app.clone()))?,
        };

        set_auth_cookie(&query_token, &app);
        logged_in_user_table().set(&app, user.as_bytes());

        Ok(())
    }

    fn log_out_user(app: String) {
        check_caller(&["host"], "log-out-user@host:auth/api");

        let Some(user) = get_logged_in_user(&app) else {
            return;
        };

        remove_auth_cookie(&app);
        query_tokens_table(&user).delete(&app);
        logged_in_user_table().delete(&app);
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
