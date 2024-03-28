<script>
    import { onDestroy, onMount } from "svelte";
    import { goto } from "$app/navigation";
    import { loadData } from "/src/lib/loadData.js";
    import { ExplorerIcon, SearchIcon, DotIcon } from "/src/assets/icons";
    import { Blocks, Button, ButtonSet, Error, Loader } from "/src/components";

    let apiInterval = null;
    let data = null;
    let autoUpdateMode = true;

    const setArgs = async (args) => {
        if (args === "last=50") {
            if (!autoUpdateMode) startAutoUpdates();
        } else {
            if (autoUpdateMode) stopAutoUpdates();
        }
        await goto("?" + args);
        data = await loadData(args);
    };

    onMount(async () => {
        let args = "?last=50";
        if (window.location.search) args = window.location.search;
        if (args !== "?last=50") autoUpdateMode = false;
        data = await loadData(args);
        if (data.blocks && autoUpdateMode) startAutoUpdates();
    });

    onDestroy(() => {
        stopAutoUpdates();
    });

    const startAutoUpdates = () => {
        apiInterval = setInterval(async () => {
            const lastBlock = data.blocks[0].header;
            const query = `?last=50&&after="${lastBlock.previous.substr(
                0,
                8
            )}"`;
            const newData = await loadData(query);
            const newBlocks = newData.blocks
                .filter((b) => b.header.blockNum > lastBlock.blockNum)
                .sort((a, b) => b > a);
            const newLength = newBlocks.length + data.blocks.length;
            const oldBlocks =
                newLength > 50
                    ? data.blocks.slice(0, 50 - newLength)
                    : data.blocks;
            data.blocks = [...newBlocks, ...oldBlocks];
        }, 1000);
        autoUpdateMode = true;
    };

    const stopAutoUpdates = () => {
        clearInterval(apiInterval);
        autoUpdateMode = false;
    };

    const processPagingRequests = (pagingFn) => {
        pagingFn(setArgs);
    };

    const toggleAutoUpdateMode = () => {
        if (autoUpdateMode) stopAutoUpdates();
        else {
            setArgs("last=50");
        }
    };
</script>

<svelte:head>
    <title>Psibase Block Explorer</title>
</svelte:head>

<div>
    {#if !data}
        <Loader />
    {:else if data.error}
        <Error value={data.error} />
    {:else}
        <div class="mb-6 flex justify-between items-center select-none">
            <div class="flex gap-2 items-center">
                <ExplorerIcon />
                <h1 class="text-5xl sm:text-6xl text-gray-600">
                    Block explorer
                </h1>
            </div>
            <div class="flex-shrink-0">
                <Button on:click={() => goto("/search")} rightIcon={SearchIcon}
                    >Search</Button>
            </div>
        </div>

        <div class="flex items-center mb-6 gap-2.5 select-none">
            <ButtonSet>
                <Button
                    on:click={() =>
                        processPagingRequests(data.pagedResult.first)}
                    class="text-sm">First</Button>
                <Button
                    class="text-sm"
                    disabled={!data.pagedResult.hasPreviousPage}
                    on:click={() =>
                        processPagingRequests(data.pagedResult.previous)}
                    >Previous</Button>
                <Button
                    class="text-sm"
                    disabled={!data.pagedResult.hasNextPage}
                    on:click={() =>
                        processPagingRequests(data.pagedResult.next)}
                    >Next</Button>
                <Button
                    class="text-sm"
                    on:click={() =>
                        processPagingRequests(data.pagedResult.last)}
                    >Last</Button>
            </ButtonSet>
            <button
                class="flex gap-1.5 items-center w-24"
                on:click={toggleAutoUpdateMode}>
                <DotIcon
                    class={autoUpdateMode
                        ? "text-green-500"
                        : "text-gray-500"} />
                <span
                    class="block text-xs font-semibold text-gray-500 leading-none text-left"
                    >Auto updating</span>
            </button>
        </div>
        <Blocks blocks={data.blocks} />
    {/if}
</div>
