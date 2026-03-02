I'm mid implementation on this task, but I've hit a roadblock, which is that I want plugin uploads to Sites to eagerly cache the dependencies. However, that implies Sites must depend on PluginInfo.
And that implies that push_boot must deploy PluginInfo, because Transact/Producers/Setcode (essential services) -> Sites -> PluginInfo.
...And that additional data is causing push_boot to OOM.

Steven says, "the option to increase memory is stored in chain state, so it can't be changed before boot".

Which means the only solution I can think of is to wait for 
https://github.com/gofractally/psibase/issues/1744

Which would allow us to split the essential service packages from their UIs, and therefore the essential services would no longer depend on Sites, and therefore Sites->PluginInfo wouldn't increase push_boot memory requirements.

