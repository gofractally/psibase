use anyhow::{anyhow, Error};
use clap::Subcommand;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use url::Url;

#[derive(Subcommand, Debug)]
pub enum ConfigCommand {
    /// Read the config file
    Read,

    /// Manages Hosts config: they are api endpoint aliases
    #[command(subcommand)]
    Host(HostSubCommand),
}

#[derive(Subcommand, Debug)]
pub enum HostSubCommand {
    /// Setup a host environment alias in the config file ~/.psibase.toml
    /// to be deployed. Example: dev, prod.
    Set {
        /// Host key. Example: dev, prod, qa1, uat, etc.
        key: String,

        /// Host URL. Example: https://prod.my-psibase-app.io
        url: Url,
    },

    /// Delete a host environment alias from the config file ~/.psibase.toml
    Delete {
        /// Host key. Example: dev, prod, qa1, uat, etc.
        key: String,
    },

    /// List all the hosts in the config file
    List,
}

pub const PSIBASE_CONFIG_NOT_FOUND_ERR: &str = r#"No hosts config found in ~/.psibase.toml
    
Make sure you have the psibase config file setup properly. 

You can do that by running `psibase config host dev=http://my-dev-env.example.com`

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
        ConfigCommand::Host(host_opts) => handle_cli_host_subcommand(host_opts)?,
        ConfigCommand::Read => println!("{}", get_psibase_config_str()?),
    }
    Ok(())
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

fn handle_cli_host_subcommand(host_opts: &HostSubCommand) -> Result<(), anyhow::Error> {
    match host_opts {
        HostSubCommand::Set { key, url } => cmd_host_set(key, url),
        HostSubCommand::Delete { key } => cmd_host_delete(key),
        HostSubCommand::List => cmd_host_list(),
    }
}

fn cmd_host_list() -> Result<(), Error> {
    let config = get_psibase_config_str()?;
    let toml_value = toml::from_str::<toml::Value>(&config)?;
    println!("{}", toml::to_string_pretty(&toml_value)?);
    Ok(())
}

fn cmd_host_set(key: &str, url: &Url) -> Result<(), Error> {
    let mut config = read_psibase_config().unwrap_or_default();
    config.hosts.insert(key.to_string(), url.to_string());
    write_psibase_config(config)?;
    println!("Host {} set successfully", key);
    Ok(())
}

fn cmd_host_delete(key: &str) -> Result<(), Error> {
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
