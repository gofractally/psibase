# Dynamic imports

The `import.wit` interface is used to dynamically import the `smart-auth` interface from any of the compliant auth service plugins.

The `export.wit` interface is exported by auth service plugins in order to be compliant and importable.

This asymmetry arises because the interface exporter does not know/care that the importer must specify the specific auth plugin to which the host should dynamically link at runtime. But the importer needs an interface that allows it to specify the plugin dynamically. Therefore, the same interface cannot be used for both purposes.
