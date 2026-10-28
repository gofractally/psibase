#[cfg(test)]
mod tests {
    use psibase::*;

    /// FractalTester depends on FractalGen, which must run its postinstall at
    /// boot (before auth is enforced). Install-after-TestDefault is the wrong path.
    #[test]
    fn package_installs() {
        let chain = Chain::create(1 << 27, 1 << 27, 1 << 27, 1 << 27);
        chain
            .boot_with(
                &Chain::test_registry(),
                &["TestDefault".to_string(), "FractalTester".to_string()],
            )
            .unwrap_or_else(|e| panic!("test package_installs failed with {e:?}"));
    }
}
