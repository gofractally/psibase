#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use psibase::*;
    use tpack;

    #[table(record = "WebContentRow", index = 0)]
    struct WebContentTable;

    #[action]
    fn storeSys(path: String, contentType: String, content: Hex<Vec<u8>>) {
        println!("{} {}", path, contentType);
        store_content(path, contentType, content, &WebContentTable::new()).unwrap()
    }

    #[action]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        None.or_else(|| serve_content(&request, &WebContentTable::new()))
            .or_else(|| serve_simple_ui::<tpack::Wrapper>(&request))
    }
}
