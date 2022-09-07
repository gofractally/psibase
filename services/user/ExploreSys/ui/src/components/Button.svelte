<script>
    import classNames from "classnames";
    export let disabled = false;
    export let leftIcon = false;
    export let rightIcon = false;
    const cls = classNames(
        $$props.class,
        "border py-2 px-4 disabled:text-gray-300",
        "enabled:text-gray-700 enabled:hover:bg-gray-200"
    );
</script>

<button {disabled} class={cls} on:click>
    {#if leftIcon}
        <svelte:component this={leftIcon} class="align-middle inline" />&nbsp;
    {/if}
    <span class="align-middle"><slot /></span>
    {#if rightIcon}
        &nbsp;<svelte:component this={rightIcon} class="align-middle inline" />
    {/if}
</button>
