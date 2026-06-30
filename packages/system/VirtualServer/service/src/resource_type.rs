use psibase::abort_message;

#[derive(async_graphql::Enum, Copy, Clone, Eq, PartialEq)]
pub enum ResourceType {
    Cpu,
    Net,
    Disk,
}

impl ResourceType {
    pub const fn as_id(self) -> u8 {
        match self {
            ResourceType::Cpu => 0,
            ResourceType::Net => 1,
            ResourceType::Disk => 2,
        }
    }

    pub fn from_id(id: u8) -> Self {
        match id {
            0 => ResourceType::Cpu,
            1 => ResourceType::Net,
            2 => ResourceType::Disk,
            _ => abort_message(&format!("Unknown resource id: {id}")),
        }
    }

    pub const fn name(self) -> &'static str {
        match self {
            ResourceType::Cpu => "CPU",
            ResourceType::Net => "Net",
            ResourceType::Disk => "Disk",
        }
    }

    pub const fn measurement_unit(self) -> &'static str {
        match self {
            ResourceType::Cpu => "ms",
            ResourceType::Net => "bytes",
            ResourceType::Disk => "bytes",
        }
    }
}
