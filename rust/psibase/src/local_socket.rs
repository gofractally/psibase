use reqwest::Url;

pub fn apply_proxy(
    builder: reqwest::ClientBuilder,
    proxy: &Option<Url>,
) -> Result<reqwest::ClientBuilder, anyhow::Error> {
    if let Some(url) = proxy {
        if url.scheme() == "unix" {
            Ok(builder.unix_socket(url.path()))
        } else {
            Ok(builder.proxy(reqwest::Proxy::http(url.as_str())?))
        }
    } else {
        Ok(builder)
    }
}
