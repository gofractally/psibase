<script>
    import {goto} from "$app/navigation";
    import {loadBlockData, getAccountsByKey} from "/src/lib/loadData.js";
    import { ExplorerIcon, LeftArrowIcon } from "/src/assets/icons";
    import { Blocks, Button, Error, TextInput } from "/src/components";
    import searchIconUrl from "/src/assets/icons/search.svg?url";

    let searchTerm;
    let currentSearch;
    let blocks = [];
    let accounts = [];
    let error;

    const search = async (e) => {
        e.preventDefault();
        error = "";
        if (searchTerm.match(/^PUB_/)) {
            const data = await getAccountsByKey(searchTerm);
            if (data.error) error = data.error;
            else accounts = data;
        } else if (searchTerm.match(/[0-9]+/)) {
            const data = await loadBlockData(searchTerm);
            if (data.block) {
                blocks = [
                    {
                        header: data.block,
                        transactions: data.transactions,
                    },
                ];
            }
        } else {
            await goto(`/account/${searchTerm}`)
        }
        currentSearch = searchTerm;
        return null;
    };
</script>

<div>
    <div class="mb-6 flex items-center gap-2">
        <ExplorerIcon />
        <h1 class="text-6xl text-gray-600">Block Explorer</h1>
        <div class="flex-grow" />
    </div>
    <Button on:click={() => history.back()} leftIcon={LeftArrowIcon} class="mb-2">
        Block explorer
    </Button>
    <h4 class="my-2 text-gray-600">
        Search account / public key / block
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
    {#if currentSearch && !error && blocks.length === 0 && accounts.length === 0}
        <h4 class="my-4 text-xl">No results</h4>
    {/if}
    {#if error}
        <Error value={error} />
    {/if}
    {#if blocks.length > 0}
        <h5 class="my-4 text-xl">Search results</h5>
        <Blocks {blocks}/>
    {/if}
    {#if accounts.length > 0}
        <h5 class="my-4 text-xl">Search results</h5>
        <ul>
            {#each accounts as a}
                <li><a href="#" on:click={() => goto(`/account/${a.account}`)}>{a.account}</a></li>
            {/each}
        </ul>
    {/if}
</div>
