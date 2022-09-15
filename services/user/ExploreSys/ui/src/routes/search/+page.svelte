<script>
    import {goto} from "$app/navigation";
    import {loadBlockData} from "/src/lib/loadData.js";
    import { ExplorerIcon, LeftArrowIcon } from "/src/assets/icons";
    import { Blocks, Button, TextInput } from "/src/components";
    import searchIconUrl from "/src/assets/icons/search.svg?url";

    let searchTerm;
    let blocks = [];
    let account = null;

    const search = async () => {
        if (searchTerm.match(/[0-9]+/)) {
            const data = await loadBlockData(searchTerm);
            if (data.block) {
                blocks = [
                    {
                        header: data.block,
                        transactions: data.transactions,
                    },
                ];
            }
            account = null;
        } else {
            await goto(`/account/${searchTerm}`)
        }
    };
</script>

<div>
    <div class="mb-6 flex items-center gap-2">
        <ExplorerIcon />
        <h1 class="text-6xl text-gray-600">Block Explorer</h1>
        <div class="flex-grow"/>
    </div>
    <Button on:click={() => history.back()} leftIcon={LeftArrowIcon} class="mb-2">
        Block explorer
    </Button>
    <h4 class="my-2 text-gray-600">
        Search account / <span class="text-gray-400">public key</span> / block
    </h4>
    <form on:submit|preventDefault={search} class="mb-4 flex items-center">
        <TextInput
                leftIconUrl={searchIconUrl}
                class="mr-2 w-96 bg-white"
                id="search_input"
                bind:value={searchTerm}
                on:enter={search}
        />
        <Button on:click={search}>Search</Button>
    </form>
    {#if blocks.length > 0}
        <h5 class="mb-4 text-xl">Search results</h5>
    {/if}
    <Blocks {blocks}/>
</div>
