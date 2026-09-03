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

fn bucket_id(user: &str) -> String {
    format!("query_tokens-{}", user)
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

fn set_active_query_token(query_token: &str, app: &str, user: &str) {
    let req = post_to_app(
        app,
        "/common/set-auth-cookie",
        format!("{{\"accessToken\": \"{}\"}}", query_token),
    );
    Supervisor::send_request(&req, true).unwrap();

    Bucket::new(DB, &bucket_id(user)).set(&app, &query_token.to_string().packed());
}

fn remove_active_query_token(app: &str, user: &str) {
    let req = post_to_app(app, "/common/remove-auth-cookie", "{}".to_string());
    Supervisor::send_request(&req, true).unwrap();

    Bucket::new(DB, &bucket_id(user)).delete(&&app);
}

impl Api for HostAuth {
    fn set_logged_in_user(user: String, app: String, auth_service: String) -> Result<(), Error> {
        check_caller(&["accounts"], "set-logged-in-user@host:auth/api");

        let query_token = match Bucket::new(DB, &bucket_id(&user)).get(&app) {
            Some(t) => String::unpacked(&t).unwrap(),
            None => mint_query_token(&app, &user, &auth_service)?,
        };

        set_active_query_token(&query_token, &app, &user);

        Ok(())
    }

    fn log_out_user(user: String, app: String) {
        check_caller(&["accounts"], "log_out_user@host:auth/api");
        remove_active_query_token(&app, &user);
    }

    fn get_active_query_token(app: String, user: String) -> Option<String> {
        check_caller(
            &["host", "supervisor"],
            "get-active-query-token@host:auth/api",
        );

        Bucket::new(DB, &bucket_id(&user))
            .get(&app)
            .map(|t| String::unpacked(&t).unwrap())
    }
}

bindings::export!(HostAuth with_types_in bindings);
