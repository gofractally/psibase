#[crate::service(name = "package-sys", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::package::Meta;
    #[action]
    fn postinstall(package: Meta) {
        unimplemented!()
    }
}
