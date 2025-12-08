pub enum Resource {
    NetworkBandwidth,
    Compute,
    //Storage,
    //TempStorage, // Events
}

pub struct Prices;

impl Prices {
    pub fn get_price(resource: Resource) -> u64 {
        match resource {
            Resource::NetworkBandwidth => 1,
            Resource::Compute => 1,
            // Resource::Storage => 1,
            // Resource::TempStorage => 1,
        }
    }
}
