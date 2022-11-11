/// psispace-sys replica
///
/// This is a replica of the original CPP psispace-sys contract as an example,
/// to demonstrate tables and http functionalities.
/// Please don't publish this as the real psispace-sys service.
#[psibase::service(name = "psispace-sys")]
mod service {
    use async_graphql::connection::Connection;
    use async_graphql::*;
    use psibase::{
        check, get_sender, get_service, serve_action_templates, serve_graphiql, serve_graphql,
        serve_pack_action, AccountNumber, HexBytes, HttpReply, HttpRequest, Pack, RawKey, Reflect,
        Table, TableIndex, TableQuery, Unpack,
    };
    use serde::{Deserialize, Serialize};

    type ContentKey = (AccountNumber, String);

    #[table(name = "ContentTable", index = 0)]
    #[derive(Debug, Pack, Unpack, PartialEq, Eq, Reflect, Serialize, Deserialize, SimpleObject)]
    pub struct ContentRow {
        pub account: AccountNumber,
        pub path: String,
        pub content_type: String,
        pub content: HexBytes,
    }

    impl ContentRow {
        #[primary_key]
        fn get_primary_key(&self) -> ContentKey {
            (self.account, self.path.to_owned())
        }
    }

    impl From<ContentRow> for HttpReply {
        fn from(content_row: ContentRow) -> Self {
            HttpReply {
                contentType: content_row.content_type,
                body: content_row.content,
                headers: Vec::new(),
            }
        }
    }

    // Root query object
    struct Query;

    #[Object]
    impl Query {
        // table_query!("allContent", ContentTable, 0);
        // table_query!("content", ContentTable, 0, account);

        /// List all the existing files
        async fn all_content(
            &self,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, ContentRow>> {
            let table_idx = ContentTable::new().get_index_pk();
            TableQuery::new(table_idx)
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
                .await
        }

        /// List files content by account
        async fn content(
            &self,
            account: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, ContentRow>> {
            let table_idx = ContentTable::new().get_index_pk();
            let sidx = TableQuery::subindex::<String>(table_idx, &account);
            sidx.first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
                .await
        }
    }

    /// Store a new file
    #[action]
    #[allow(non_snake_case)]
    fn storeSys(path: String, contentType: String, content: HexBytes) {
        check(path.starts_with('/'), "Path doesn't begin with /");
        let new_content = ContentRow {
            account: get_sender(),
            path,
            content_type: contentType,
            content,
        };
        ContentTable::new().put(&new_content).unwrap();
    }

    /// Remove an existing file
    #[action]
    #[allow(non_snake_case)]
    fn removeSys(path: String) {
        let key = (get_sender(), path);
        ContentTable::new().erase(&key);
    }

    #[action]
    #[allow(non_snake_case)]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        check(
            request.host.len() > request.rootHost.len(),
            "unexpected rootHost len greater than host",
        );

        let account_name_len = request.host.len() - request.rootHost.len();
        let account_name = &request.host[..account_name_len - 1];
        let account = AccountNumber::from(account_name);

        if account == SERVICE {
            handle_contract_request(request)
        } else {
            handle_content_request(account, request)
        }
    }

    fn handle_contract_request(request: HttpRequest) -> Option<HttpReply> {
        None.or_else(|| serve_action_templates::<Wrapper>(&request))
            .or_else(|| serve_pack_action::<Wrapper>(&request))
            .or_else(|| serve_graphql(&request, Query))
            .or_else(|| serve_graphiql(&request))
            .or_else(|| handle_content_request(get_service(), request))
    }

    fn handle_content_request(account: AccountNumber, request: HttpRequest) -> Option<HttpReply> {
        let mut target = request.target;

        if let Some(query_params_begin_pos) = target.find('?') {
            target.truncate(query_params_begin_pos);
        }

        let table = ContentTable::new().get_index_pk();
        let content_key = (account, target.clone());
        let content = table.get(&content_key);

        content
            .or_else(|| get_index_content(&account, &table, &target))
            .or_else(|| get_default_profile(&table, &target))
            .map(HttpReply::from)
    }

    fn get_index_content(
        account: &AccountNumber,
        table: &TableIndex<ContentKey, ContentRow>,
        target: &str,
    ) -> Option<ContentRow> {
        if target.ends_with('/') {
            let key = (account.to_owned(), format!("{}index.html", target));
            table.get(&key)
        } else {
            let key = (account.to_owned(), format!("{}/index.html", target));
            table.get(&key)
        }
    }

    fn get_default_profile<'a>(
        table: &'a TableIndex<ContentKey, ContentRow>,
        target: &'a str,
    ) -> Option<ContentRow> {
        if target == "/" {
            let key = (
                get_service(),
                "/default-profile/default-profile.html".to_owned(),
            );
            table.get(&key)
        } else if target.starts_with("/default-profile/") {
            let key = (get_service(), target.to_owned());
            table.get(&key)
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::{
        service::{ContentRow, ContentTable},
        Wrapper,
    };
    use psibase::{account, AccountNumber, ChainResult, HexBytes, HttpReply, HttpRequest, Table};

    #[psibase::test_case(services("psispace-sys"))]
    fn users_can_store_content(chain: psibase::Chain) -> Result<(), psibase::Error> {
        let bob = account!("bob");
        chain.new_account(bob)?;

        let path = "/abc.html".to_owned();
        let content_type = "text/html".to_owned();
        let content: HexBytes = "<h1>Hello world!</h1>".to_owned().into_bytes().into();
        Wrapper::push_from(&chain, bob).storeSys(
            path.clone(),
            content_type.clone(),
            content.clone(),
        );

        let stored_content = ContentTable::with_service(account!("psispace-sys"))
            .get_index_pk()
            .get(&(bob, path.clone()));

        assert!(stored_content.is_some());

        assert_eq!(
            stored_content.unwrap(),
            ContentRow {
                account: bob,
                path,
                content_type,
                content
            }
        );

        Ok(())
    }

    #[psibase::test_case(services("psispace-sys"))]
    fn paths_must_begin_with_slash(chain: psibase::Chain) -> Result<(), psibase::Error> {
        let bob = account!("bob");
        chain.new_account(bob)?;

        let path = "abc.html".to_owned();
        let content_type = "text/html".to_owned();
        let content: HexBytes = "<h1>Hello world!</h1>".to_owned().into_bytes().into();
        let error = Wrapper::push_from(&chain, bob)
            .storeSys(path.clone(), content_type.clone(), content.clone())
            .trace
            .error
            .unwrap();
        assert!(
            error.contains("Path doesn't begin with /"),
            "error = {}",
            error
        );

        Ok(())
    }

    #[psibase::test_case(services("psispace-sys"))]
    fn index_files_are_retrieved_for_folders(chain: psibase::Chain) -> Result<(), psibase::Error> {
        let bob = account!("bob");
        chain.new_account(bob)?;

        let path = "/articles/index.html".to_owned();
        let content_type = "text/html".to_owned();
        let content: HexBytes = "<h1>Hello world!</h1>".to_owned().into_bytes().into();
        Wrapper::push_from(&chain, bob).storeSys(
            path.clone(),
            content_type.clone(),
            content.clone(),
        );

        // with slash
        let response = push_servesys_request(&chain, "bob", "/articles/").get()?;
        assert!(response.is_some());
        assert_reply(&response.unwrap(), &content_type, &content);

        // without slash
        let response = push_servesys_request(&chain, "bob", "/articles").get()?;
        assert!(response.is_some());
        assert_reply(&response.unwrap(), &content_type, &content);

        // without slash and query parameters
        let response = push_servesys_request(&chain, "bob", "/articles?top=10").get()?;
        assert!(response.is_some());
        assert_reply(&response.unwrap(), &content_type, &content);

        Ok(())
    }

    #[psibase::test_case(services("psispace-sys"))]
    fn contract_files_are_retrieved(chain: psibase::Chain) -> Result<(), psibase::Error> {
        let index_path = "/index.html".to_owned();
        let index_content_type = "text/html".to_owned();
        let index_content: HexBytes = "<h1>PsiSpace File Upload Manager</h1>"
            .to_owned()
            .into_bytes()
            .into();
        Wrapper::push(&chain).storeSys(
            index_path.clone(),
            index_content_type.clone(),
            index_content.clone(),
        );

        let style_path = "/assets/styles.css".to_owned();
        let style_content_type = "text/css".to_owned();
        let style_content: HexBytes = ".container { margin: 20px; }"
            .to_owned()
            .into_bytes()
            .into();
        Wrapper::push(&chain).storeSys(
            style_path.clone(),
            style_content_type.clone(),
            style_content.clone(),
        );

        // index path retrieves index.html file
        let response = push_servesys_request(&chain, "psispace-sys", "/").get()?;
        assert!(response.is_some());
        assert_reply(&response.unwrap(), &index_content_type, &index_content);

        // retrieves styles.css from default profile
        let response = push_servesys_request(&chain, "psispace-sys", "/assets/styles.css").get()?;
        assert!(response.is_some());
        assert_reply(&response.unwrap(), &style_content_type, &style_content);

        Ok(())
    }

    #[psibase::test_case(services("psispace-sys"))]
    fn default_profile_files_are_retrieved(chain: psibase::Chain) -> Result<(), psibase::Error> {
        let index_path = "/default-profile/default-profile.html".to_owned();
        let index_content_type = "text/html".to_owned();
        let index_content: HexBytes = "<h1>Default profile!</h1>".to_owned().into_bytes().into();
        Wrapper::push(&chain).storeSys(
            index_path.clone(),
            index_content_type.clone(),
            index_content.clone(),
        );

        let style_path = "/default-profile/styles.css".to_owned();
        let style_content_type = "text/css".to_owned();
        let style_content: HexBytes = ".container { margin: 20px; }"
            .to_owned()
            .into_bytes()
            .into();
        Wrapper::push(&chain).storeSys(
            style_path.clone(),
            style_content_type.clone(),
            style_content.clone(),
        );

        let bob = account!("bob");
        chain.new_account(bob)?;

        // index path retrieves default-profile.html file
        let response = push_servesys_request(&chain, "bob", "/").get()?;
        assert!(response.is_some());
        assert_reply(&response.unwrap(), &index_content_type, &index_content);

        // retrieves styles.css from default profile
        let response = push_servesys_request(&chain, "bob", "/default-profile/styles.css").get()?;
        assert!(response.is_some());
        assert_reply(&response.unwrap(), &style_content_type, &style_content);

        Ok(())
    }

    #[psibase::test_case(services("psispace-sys"))]
    fn graphql_content_query_retrieves_properly(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        let account_prefix = "acc";

        // Create 50 files from 10 accounts
        for i in 1..=10 {
            let account = AccountNumber::from(format!("{}{}", account_prefix, i).as_str());
            chain.new_account(account)?;

            for j in 1..=5 {
                let path = format!("/articles/blog{}.html", j);
                let content_type = "text/html".to_owned();
                let content: HexBytes = format!("<h1>Hello world {}</h1>", j).into_bytes().into();
                Wrapper::push_from(&chain, account).storeSys(
                    path.clone(),
                    content_type.clone(),
                    content.clone(),
                );
            }
        }

        println!("created accounts and files!");

        let default_page_edges = "
        {
            pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
            edges { node { account path contentType} }
        }
        ";
        let gql = format!(
            "{{
                firstContent: allContent(first: 1) {0}
                lastContent: allContent(last: 1) {0}
            }}",
            default_page_edges
        );
        let json_query = format!("{{\"query\":\"{}\"}}", gql);
        println!("submitting jq {}", json_query);

        let response = Wrapper::push(&chain).serveSys(HttpRequest {
            host: "psispace-sys.testnet.psibase.io".to_string(),
            rootHost: "testnet.psibase.io".to_string(),
            target: "/graphql".to_string(),
            method: "POST".to_string(),
            contentType: "application/json".to_string(),
            body: json_query.to_string().into_bytes().into(),
        });

        println!("gql response trace >>>\n{}", response.trace);

        let response = response.get()?;
        assert!(response.is_some());
        println!("gql response >>>\n {:?}", response.unwrap());

        Ok(())
    }

    fn assert_reply(reply: &HttpReply, content_type: &str, content: &Vec<u8>) {
        assert_eq!(
            reply,
            &HttpReply {
                contentType: content_type.to_owned(),
                body: content.clone().into(),
                headers: Vec::new(),
            },
            "unexpected http reply {:?}",
            reply
        );
    }

    fn push_servesys_request(
        chain: &psibase::Chain,
        account: &str,
        target: &str,
    ) -> ChainResult<Option<HttpReply>> {
        Wrapper::push(&chain).serveSys(HttpRequest {
            host: format!("{}.testnet.psibase.io", account),
            rootHost: "testnet.psibase.io".to_string(),
            target: target.to_string(),
            method: "GET".to_string(),
            contentType: "".to_string(),
            body: Vec::new().into(),
        })
    }
}
