#[psibase::service(name = "branding")]
mod service {
    use psibase::anyhow;

    #[action]
    fn set_chain_name(name: String) {
        // save name to singleton
        Wrapper::emit().history().set_chain_name(name);
    }

    #[action]
    fn set_logo(img: Vec<u8>) {
        // store logo to accessible url
        let url = String::from("/chain_logo");

        Wrapper::emit().history().set_logo(url);
    }

    #[event(history)]
    pub fn set_chain_name(name: String) {}

    #[event(history)]
    pub fn set_logo(url: String) {}
}
