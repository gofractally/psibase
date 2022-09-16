<script>
    import { getJson, siblingUrl } from "common/rpc.mjs?client";
    import { page } from "$app/stores";
    import { onMount } from "svelte";
    import { LeftArrowIcon } from "/src/assets/icons";
    import { loadTransferHistory } from "/src/lib/loadData.js";
    import { AccountHistory, Amount, Button, Error, Loader } from "/src/components";

    let data = null;

    const fetchTokenTypes = async () => {
        const url = await siblingUrl(null, "token-sys", "api/getTokenTypes");
        return getJson(url);
    }

    const fetchBalances = async (user) => {
        const url = await siblingUrl(null, "token-sys", `api/balances/${user}`);
        return getJson(url);
    }

    onMount(async () => {
        try {
            const account = $page.params.name;
            const result = await loadTransferHistory(account);
            console.log("loadTransferHistory", result);
            const history = result.data.holderEvents.edges.map(
                (e) => e.node
            );
            // console.log("history", history);
            const tokenTypesRes = await fetchTokenTypes();
            // console.log("tokenTypesRes", tokenTypesRes);
            const tokenTypes = tokenTypesRes.reduce(
                (prev, token) => {
                    prev[token.id] = {
                        precision: token.precision.value,
                        symbol: token.symbolId,
                    };
                    return prev;
                },
                {}
            );
            // console.log("tokenTypes", tokenTypes);
            const balances = await fetchBalances(account);
            // console.log("balances", balances);
            data = {
                tokenTypes,
                account,
                history,
                balances,
            };
        }
        catch(error) {
            console.log("eeerrror", error);
            data = { error };
        }
    });
</script>

<div>
    {#if !data}
        <Loader />
    {:else if data.error}
        <Button on:click={() => history.back()} leftIcon={LeftArrowIcon} class="mb-2">
            Search
        </Button>
        <Error value={data.error} />
    {:else}
        <div class="mb-4">
            <h1 class="text-6xl text-gray-600">Account Details</h1>
        </div>
        <Button on:click={() => history.back()} leftIcon={LeftArrowIcon} class="mb-2">
            Search
        </Button>
        <h4 class="py-4">{data.account}</h4>
        <h6>Balances</h6>
        {#each data.balances as b}
            <div class="pb-4">
                <Amount value={b.balance} precision={b.precision} symbol={b.symbol} />
            </div>
        {/each}
        <AccountHistory data={data} />
    {/if}
</div>
