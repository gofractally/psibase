use anyhow::{anyhow, Error};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use url::Url;

#[derive(Serialize, Deserialize, Default)]
pub struct PsibaseConfig {
    pub hosts: HashMap<String, String>,
}

fn psibase_config_path() -> Result<PathBuf, Error> {
    let home = std::env::var("HOME")?;
    let path = Path::new(&home).join(".psibase.toml");
    Ok(path)
}

fn read_psibase_config() -> Option<PsibaseConfig> {
    // TODO: watch https://github.com/rust-lang/libs-team/issues/372
    psibase_config_path()
        .ok()
        .map(|config_path| std::fs::read_to_string(&config_path).ok())
        .flatten()
        .map(|config_str| toml::from_str::<PsibaseConfig>(&config_str).ok())
        .flatten()
}

fn write_psibase_config(config: PsibaseConfig) -> Result<(), Error> {
    let path = psibase_config_path()?;
    let config_str = toml::to_string(&config)?;
    std::fs::write(path, config_str)?;
    Ok(())
}

pub fn read_host_config_url(host_key: &str) -> Result<String, Error> {
    let psibase_config = read_psibase_config().expect(
        r#"No hosts config found in ~/.psibase.toml
    
Make sure you have the psibase config file setup properly. 

You can do that by running `cargo psibase config host dev=http://my-dev-env.example.com`

Or manually editing the ~/.psibase.toml:

[hosts]
prod = "https://prod.example.com"
dev = "https://dev.example.com"
qa1 = "https://qa1.example.com""#,
    );

    match psibase_config.hosts.get(host_key) {
        Some(host_url) => Ok(host_url.to_string()),
        None => Err(anyhow!(
            "Host {} not found in ~/.psibase.toml; Available hosts: {}",
            host_key,
            psibase_config
                .hosts
                .keys()
                .map(|k| k.to_string())
                .collect::<Vec<String>>()
                .join(", ")
        )),
    }
}

pub fn setup_config_host(key: &str, url: &Url) -> Result<(), Error> {
    let mut config = read_psibase_config().unwrap_or_default();
    config.hosts.insert(key.to_string(), url.to_string());
    write_psibase_config(config)
}
