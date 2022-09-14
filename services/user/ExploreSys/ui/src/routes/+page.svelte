<script>
    import { initializeApplet } from "/common/rpc.mjs?client";
    import { onDestroy, onMount } from "svelte";
    import { goto } from "$app/navigation";
    import { loadData } from "/src/lib/loadData.js";
    import { ExplorerIcon, SearchIcon, DotIcon } from "/src/assets/icons";
    import ButtonSet from "/src/components/ButtonSet.svelte";
    import Button from "/src/components/Button.svelte";
    import Blocks from "/src/components/Blocks.svelte";
    import Loader from "/src/components/Loader.svelte";
    import Error from "/src/components/Error.svelte";

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
        initializeApplet();
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
            // console.log("---", data.blocks[0].header.blockNum);
            const lastBlock = data.blocks[0].header.blockNum;
            const newData = await loadData("?last=5");
            const newBlocks = newData.blocks
                .reverse()
                .filter((b) => b.header.blockNum > lastBlock);
            data.blocks = [...newBlocks, ...data.blocks];
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
    <title>PsiBase Block Explorer</title>
</svelte:head>

<div>
    {#if !data}
        <Loader />
    {:else if data.error}
        <Error value={data.error} />
    {:else}
        <div class="mb-6 flex items-center gap-2">
            <ExplorerIcon />
            <h1 class="text-6xl text-gray-600">Block Explorer</h1>
            <div class="flex-grow" />
            <Button on:click={() => goto("/search")} rightIcon={SearchIcon}
                >Search</Button>
        </div>

        <ButtonSet>
            <Button
                on:click={() => processPagingRequests(data.pagedResult.first)}
                >First</Button>
            <Button
                disabled={!data.pagedResult.hasPreviousPage}
                on:click={() =>
                    processPagingRequests(data.pagedResult.previous)}
                >Previous</Button>
            <Button
                disabled={!data.pagedResult.hasNextPage}
                on:click={() => processPagingRequests(data.pagedResult.next)}
                >Next</Button>
            <Button
                on:click={() => processPagingRequests(data.pagedResult.last)}
                >Last</Button>
            <Button class="AutoUpdatingButton" leftIcon={DotIcon}
                    iconClass={autoUpdateMode
                        ? "text-green-500"
                        : "text-gray-500"}
                    on:click={toggleAutoUpdateMode}>
                Auto updating
            </Button>
        </ButtonSet>
        <Blocks blocks={data.blocks} />
    {/if}
</div>

<style>
    :global(.AutoUpdatingButton) {
        border-width: 0 0 0 1px !important;
    }
</style>
