<script>
    import { page } from "$app/stores";
    import { onMount } from "svelte";
    import Button from "/src/components/Button.svelte";
    import Error from "/src/components/Error.svelte";
    import LeftArrow from "/src/assets/icons/leftArrow.svg";
    import { loadTransferHistory } from "/src/lib/loadData.js";
    import AccountHistory from "/src/components/AccountHistory.svelte";
    import Loader from "/src/components/Loader.svelte";
    let data = null;

    onMount(async () => {
        const account = $page.params.name;
        const result = await loadTransferHistory(account);
        console.log(result.data.holderEvents.edges);
        const history = result.data.holderEvents.edges.map(
            (e) => e.node
        );
        console.log("history", history);
        data = {
            account,
            history,
        };
    });
</script>

<div>
    {#if !data}
        <Loader />
    {:else if data.error}
        <Button on:click={() => history.back()} leftIcon={LeftArrow} class="mb-2">
            Search
        </Button>
        <Error value={data.error} />
    {:else}
        <div class="mb-4">
            <h1 class="text-6xl text-gray-600">Account Details</h1>
        </div>
        <Button on:click={() => history.back()} leftIcon={LeftArrow} class="mb-2">
            Search
        </Button>
        <h4 class="py-4">{data.account}</h4>
        <AccountHistory data={data} />
    {/if}
</div>
