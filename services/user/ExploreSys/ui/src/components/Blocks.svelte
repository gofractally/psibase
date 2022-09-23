<script>
    import classNames from "classnames";
    import { goto } from "$app/navigation";
    export let blocks = [];
    export let clickable = true;

    const onClick = (block) => {
        if (clickable) goto(`/block/${block.header.blockNum}`);
    };
</script>

<table class={classNames($$props.class, "w-full table-fixed")}>
    <thead>
        {#if blocks.length > 0}
            <tr class="border-b border-b-black">
                <th class="w-20">Block<br />No.</th>
                <th class="w-16"># of<br />trans.</th>
                <th>Previous<br />Block</th>
                <th><br />Time</th>
            </tr>
        {/if}
    </thead>
    <tbody>
        {#each blocks as block}
            <tr
                on:click={onClick(block)}
                class={classNames(
                    {clickable},
                    {"text-gray-400": block.transactions.length === 0 && blocks.length > 1}
                )}
            >
                <td class="w-20">{block.header.blockNum}</td>
                <td class="w-16 whitespace-nowrap"
                    >{block.transactions.length}</td
                >
                <td class="max-w-lg truncate">
                    {block.header.previous}
                </td>
                <td class="whitespace-nowrap">{block.header.time}</td>
            </tr>
        {/each}
    </tbody>
</table>

<style>
    tr.clickable:hover {
        @apply bg-gray-100;
        @apply cursor-pointer;
    }
</style>