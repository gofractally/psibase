<script>
    import classNames from "classnames";
    import { goto } from "$app/navigation";
    export let blocks = [];
    export let clickable = true;

    const onClick = (block) => {
        if (clickable) goto(`/block/${block.header.blockNum}`);
    };

    const formatDateTime = (datetime) => {
        const segments = datetime.split("T");
        const date = segments[0];
        const time = segments[1].replace("Z", "");
        return `${date} ${time}`;
    };
</script>

<table class={classNames($$props.class, "w-full table-fixed")}>
    <thead>
        {#if blocks.length > 0}
            <tr class="border-b border-b-black select-none">
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
                    { clickable },
                    {
                        "text-gray-500":
                            block.transactions.length === 0 &&
                            blocks.length > 1,
                    }
                )}>
                <td class="w-20">{block.header.blockNum}</td>
                <td class="w-16 whitespace-nowrap"
                    >{block.transactions.length}</td>
                <td class="max-w-lg truncate">
                    {block.header.previous}
                </td>
                <td>{formatDateTime(block.header.time)}</td>
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
