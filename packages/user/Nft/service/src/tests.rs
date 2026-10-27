#[cfg(test)]
mod tests {
    #[psibase::test_case(packages("Nft"))]
    fn package_installs(_chain: psibase::Chain) -> Result<(), psibase::Error> {
        Ok(())
    }
}
