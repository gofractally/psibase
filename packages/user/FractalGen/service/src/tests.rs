#[cfg(test)]
mod tests {
    use psibase::*;

    /// FractalGen is a boot package (ProdWithFG). Its postinstall uses runAs
    /// against AuthDyn accounts, which only works before finishBoot enables auth.
    /// `test_case` installs after a booted TestDefault, so boot with it instead.
    #[test]
    fn package_installs() {
        let chain = Chain::create(1 << 27, 1 << 27, 1 << 27, 1 << 27);
        chain
            .boot_with(
                &Chain::test_registry(),
                &["TestDefault".to_string(), "FractalGen".to_string()],
            )
            .unwrap_or_else(|e| panic!("test package_installs failed with {e:?}"));
    }
}
