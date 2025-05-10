<script>
    import classNames from "classnames";
    export let disabled = false;
    export let leftIconUrl = "";
    export let label = "";
    export let id = "";
    export let placeholder = "";
    export let value = "";
</script>

<fieldset
    class={classNames(
        $$props.class,
        "space-y-1 text-gray-500 disabled:text-gray-300"
    )}
    {disabled}
>
    {#if label}
        <label for={id}>
            <span class="select-none text-sm font-semibold">
                {label}
            </span>
        </label>
    {/if}
    <input
        {id}
        {placeholder}
        class="w-full border bg-white px-1 py-2 text-red-500 text-gray-900 outline-none placeholder:text-gray-400 focus-visible:ring-1 focus-visible:ring-gray-500"
        bind:value
        style={leftIconUrl
            ? `background: url(${leftIconUrl}) no-repeat scroll 7px 11px; padding-left: 32px;`
            : ""}
    />
</fieldset>
