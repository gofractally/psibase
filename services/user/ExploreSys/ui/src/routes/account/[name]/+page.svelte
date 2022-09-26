<script>
    import { getJson, siblingUrl } from "common/rpc.mjs?client";
    import { page } from "$app/stores";
    import { onMount } from "svelte";
    import { LeftArrowIcon } from "/src/assets/icons";
    import {getPubKeyByAccountName, loadTransferHistory} from "/src/lib/loadData.js";
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
            // const result = await loadTransferHistory(account);
            // const history = result.data.holderEvents.edges.map(
            //     (e) => e.node
            // );
            // // console.log("history", history);
            // const tokenTypesRes = await fetchTokenTypes();
            // // console.log("tokenTypesRes", tokenTypesRes);
            // const tokenTypes = tokenTypesRes.reduce(
            //     (prev, token) => {
            //         prev[token.id] = {
            //             precision: token.precision.value,
            //             symbol: token.symbolId,
            //         };
            //         return prev;
            //     },
            //     {}
            // );
            // console.log("tokenTypes", tokenTypes);
            const balances = await fetchBalances(account);
            // console.log("balances", balances);
            data = {
                // tokenTypes,
                account,
                history,
                balances,
                pubkey: undefined,
            };
            const authRec = await getPubKeyByAccountName(account);
            if (authRec.account && authRec.account === account) {
                data.pubkey = authRec.pubkey;
            }
        }
        catch(error) {
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
        <div class="flex gap-12 place-content-between">
            <div>
                {#if data.balances.length > 0}
                    <h6>Balances</h6>
                {:else}
                    <p>No token balances</p>
                {/if}
                {#each data.balances as b}
                    <div class="pb-4">
                        <Amount value={b.balance} precision={b.precision} symbol={b.symbol} />
                    </div>
                {/each}
            </div>
            {#if data.pubkey}
                <div class="justify-self-center">
                    <h6 class="text-right">Public Key</h6>
                    <p class="font-mono text-gray-600">{data.pubkey}</p>
                </div>
            {/if}
        </div>
        <!-- <AccountHistory data={data} />-->
    {/if}
</div>
