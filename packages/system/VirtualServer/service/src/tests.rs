#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    use crate::Wrapper;

    #[psibase::test_case(packages("VirtualServer"))]
    fn test(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init();

        println!("TODO: VirtualServer tests");

        Ok(())
    }
}
