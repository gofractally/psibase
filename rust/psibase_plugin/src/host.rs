pub mod client {
    use crate::bindings::host::common::client;

    pub fn get_active_app() -> String {
        client::get_active_app()
    }

    pub fn get_sender() -> String {
        client::get_sender()
    }

    pub fn get_receiver() -> String {
        client::get_receiver()
    }

    pub fn get_app_url(app: String) -> String {
        client::get_app_url(&app)
    }
}

pub mod server {
    use crate::bindings::host::common::server;
    use crate::bindings::host::types::types::{BodyTypes, Error, PostRequest};

    pub fn get_json(endpoint: &str) -> Result<String, Error> {
        server::get_json(endpoint)
    }

    pub fn post(request: PostRequest) -> Result<BodyTypes, Error> {
        server::post(&request)
    }

    pub fn post_graphql_get_json(graphql: &str) -> Result<String, Error> {
        server::post_graphql_get_json(&graphql)
    }
}
