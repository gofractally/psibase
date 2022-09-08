<script>
    import classNames from "classnames";
    export let disabled = false;
    export let leftIcon = false;
    export let rightIcon = false;
    export let iconClass = null;
    const cls = classNames(
        $$props.class,
        "border py-2 px-4 disabled:text-gray-300",
        "enabled:text-gray-700 enabled:hover:bg-gray-200"
    );
    const getIconClass = (iconClass) => classNames(iconClass, "align-middle inline");
</script>

<button {disabled} class={cls} on:click>
    {#if leftIcon}
        <svelte:component this={leftIcon} class={getIconClass(iconClass)} />&nbsp;
    {/if}
    <span class="align-middle"><slot /></span>
    {#if rightIcon}
        &nbsp;<svelte:component this={rightIcon} class={getIconClass(iconClass)} />
    {/if}
</button>
