use anyhow::{anyhow, Error};
use clap::Subcommand;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use url::Url;

#[derive(Subcommand, Debug)]
pub enum ConfigCommand {
    /// Read the config file
    Read,

    /// Set a config value
    Set {
        /// Config key to set. Example: hosts.dev, hosts.prod, etc.
        key: String,

        /// Config value to set on the provided key. Example: https://prod.my-psibase-app.io
        value: String,
    },

    /// Get a config section or value
    Get {
        /// Config key to get. Example: hosts.dev, hosts.prod or hosts (to get the full section).
        key: String,
    },

    Unset {
        /// Config key to unset (removed). Example: hosts.dev, hosts.prod, etc.
        key: String,
    },
}

pub enum ConfigKey {
    Hosts(String),
    HostsSection,
}

impl FromStr for ConfigKey {
    type Err = Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        if let Some((section, key)) = s.split_once('.') {
            if section == "hosts" {
                Ok(ConfigKey::Hosts(key.to_string()))
            } else {
                Err(anyhow!("Unknown config section: {}", section))
            }
        } else if s == "hosts" {
            Ok(ConfigKey::HostsSection)
        } else {
            Err(anyhow!("Invalid config key format. Expected 'section.key'"))
        }
    }
}

pub const PSIBASE_CONFIG_NOT_FOUND_ERR: &str = r#"No config found in ~/.psibase.toml
    
Make sure you have the psibase config file setup properly. 

You can do that by setting psibase config values running `psibase config set hosts.dev http://my-dev-env.example.com`

Or manually editing the ~/.psibase.toml:

[hosts]
prod = "https://prod.example.com"
dev = "https://dev.example.com"
qa1 = "https://qa1.example.com""#;

#[derive(Serialize, Deserialize, Default, Debug)]
pub struct PsibaseConfig {
    pub hosts: HashMap<String, String>,
}

pub fn handle_cli_config_cmd(config: &ConfigCommand) -> Result<(), anyhow::Error> {
    match config {
        ConfigCommand::Set { key, value } => cmd_set(key, value)?,
        ConfigCommand::Get { key } => cmd_get(key)?,
        ConfigCommand::Unset { key } => cmd_unset(key)?,
        // ConfigCommand::Host(host_opts) => handle_cli_host_subcommand(host_opts)?,
        ConfigCommand::Read => println!("{}", get_psibase_config_str()?),
    }
    Ok(())
}

pub fn cmd_set(key: &str, value: &str) -> Result<(), Error> {
    match ConfigKey::from_str(key)? {
        ConfigKey::Hosts(key) => cmd_host_set(&key, value),
        ConfigKey::HostsSection => Err(anyhow!("It's not allowed to set the entire hosts section")),
    }
}

pub fn cmd_get(key: &str) -> Result<(), Error> {
    match ConfigKey::from_str(key)? {
        ConfigKey::Hosts(key) => cmd_host_get(&key),
        ConfigKey::HostsSection => cmd_host_list_section(),
    }
}

pub fn cmd_unset(key: &str) -> Result<(), Error> {
    match ConfigKey::from_str(key)? {
        ConfigKey::Hosts(key) => cmd_host_unset(&key),
        ConfigKey::HostsSection => Err(anyhow!(
            "It's not allowed to unset the entire hosts section"
        )),
    }
}

pub fn read_host_url(host_key: &str) -> Result<String, Error> {
    let psibase_config = read_psibase_config()?;
    psibase_config.hosts.get(host_key).cloned().ok_or_else(|| {
        let available_hosts = psibase_config
            .hosts
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>()
            .join(", ");
        anyhow!(
            "Host {} not found in ~/.psibase.toml; Available hosts: {}",
            host_key,
            available_hosts
        )
    })
}

fn cmd_host_list_section() -> Result<(), Error> {
    let config = get_psibase_config_str()?;
    let toml_value = toml::from_str::<toml::Value>(&config)?;
    println!("{}", toml::to_string_pretty(&toml_value)?);
    Ok(())
}

fn cmd_host_get(key: &str) -> Result<(), Error> {
    let config = read_psibase_config().unwrap_or_default();
    println!("{}", config.hosts.get(key).expect("Host not set"));
    Ok(())
}

fn cmd_host_set(key: &str, url_str: &str) -> Result<(), Error> {
    let url = Url::parse(url_str)?;
    let mut config = read_psibase_config().unwrap_or_default();
    config.hosts.insert(key.to_string(), url.to_string());
    write_psibase_config(config)?;
    println!("Host {} set successfully", key);
    Ok(())
}

fn cmd_host_unset(key: &str) -> Result<(), Error> {
    let mut config = read_psibase_config()?;
    if config.hosts.remove(key).is_some() {
        write_psibase_config(config)?;
        println!("Host {} removed successfully", key);
        Ok(())
    } else {
        Err(anyhow!("Host {} not found in ~/.psibase.toml", key))
    }
}

fn get_psibase_config_path() -> Result<PathBuf, Error> {
    // TODO: watch https://github.com/rust-lang/libs-team/issues/372
    let home = std::env::var("HOME")?;
    let path = Path::new(&home).join(".psibase.toml");
    Ok(path)
}

fn get_psibase_config_str() -> Result<String, Error> {
    let path = get_psibase_config_path()?;
    std::fs::read_to_string(&path).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => anyhow!(PSIBASE_CONFIG_NOT_FOUND_ERR),
        _ => e.into(),
    })
}

fn read_psibase_config() -> Result<PsibaseConfig, Error> {
    let config_str = get_psibase_config_str()?;
    toml::from_str::<PsibaseConfig>(&config_str).map_err(Error::from)
}

fn write_psibase_config(config: PsibaseConfig) -> Result<(), Error> {
    let path = get_psibase_config_path()?;
    let config_str = toml::to_string(&config)?;
    std::fs::write(path, config_str)?;
    Ok(())
}
