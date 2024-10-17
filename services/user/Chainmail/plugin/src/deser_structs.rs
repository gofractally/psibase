use psibase::TimePointSec;
use serde::{de, Deserialize};

fn deserialize_msg_id<'d, D>(deserializer: D) -> Result<u64, D::Error>
where
    D: de::Deserializer<'d>,
{
    struct Alien;
    impl<'d> de::Visitor<'d> for Alien {
        type Value = u64;

        fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
            formatter.write_str("a u64 as a string")
        }

        fn visit_str<E>(self, msg_id: &str) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            u64::from_str_radix(msg_id, 10).map_err(E::custom)
        }
    }
    deserializer.deserialize_string(Alien)
}

// fn deserialize_timepoint<'d, D>(deserializer: D) -> Result<u32, D::Error>
// where
//     D: de::Deserializer<'d>,
// {
//     struct Alien;
//     impl<'d> de::Visitor<'d> for Alien {
//         type Value = u32;

//         fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
//             formatter.write_str("a psibase::TimePointSec")
//         }

//         fn visit_str<E>(self, timepoint: &str) -> Result<Self::Value, E>
//         where
//             E: de::Error,
//         {
//             let datetime_as_timepointsec = serde_json::from_str::<TimePointSec>(timepoint);
//             Ok(datetime_as_timepointsec.map_err(E::custom)?.seconds)
//         }
//     }
//     deserializer.deserialize_string(Alien)
// }

#[derive(Clone, Debug, Deserialize)]
pub struct TempMessageForDeserialization {
    #[serde(deserialize_with = "deserialize_msg_id")]
    pub msg_id: u64,
    pub _archived_msg_id: Option<String>,
    pub receiver: String,
    pub sender: String,
    pub subject: String,
    pub body: String,
    // #[serde(deserialize_with = "deserialize_timepoint")]
    pub datetime: TimePointSec,
}
