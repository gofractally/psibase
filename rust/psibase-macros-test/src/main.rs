fn main() {
    println!("Hello, world!");
}

#[psibase::service(name = "testsvc")]
mod service {
    use psibase::anyhow;

    #[action]
    // got an error because serde dep wasn't present?
    fn add(a: i32, b: i32) -> i32 {
        a + b
    }
    #[event(history)]
    fn something(msg: String) {}
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_event_attribute_parsing() {
        use super::*;
        use psibase::fracpack::Pack;

        println!("test_event_attribute_parsing().top");

        println!("SERVICE: {}", service::SERVICE);

        // println!("{:#?}", service::Wrapper);
        println!("Wrapper SERVICE: {}", service::Wrapper::SERVICE);
        // println!("{:#?}", service::Actions);

        service::action_structs::add { a: 2, b: 5 }.packed();

        println!("test_event_attribute_parsing().bottom");
    }
}
