So I have been working on bringing down the size of the PluginInfo package because it's effectively an essential package now that Sites depends on it. Because of that, it has to be quite small.

Currently it's too big to boot.

My next idea is to try to split the query service into a separate package, but it's weird because it's cargo-psibase-package and it's not clear if cargo will let me build two packages that work on the same service.

If not, then I may have to simply remove the dependence on async_graphql and just use a REST interface for plugin-deps.
