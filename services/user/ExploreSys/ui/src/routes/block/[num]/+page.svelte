<script>
    import { page } from "$app/stores";
    import { onMount } from "svelte";
    import Button from "/src/components/Button.svelte";
    import Error from "/src/components/Error.svelte";
    import LeftArrow from "/src/assets/icons/leftArrow.svg";
    import { loadBlockData } from "/src/lib/loadData.js";
    import Blocks from "/src/components/Blocks.svelte";
    import Loader from "/src/components/Loader.svelte";
    let data = null;
    let blocks = [];

    onMount(async () => {
        data = await loadBlockData($page.params.num);
        if (data.block) {
            blocks = [
                {
                    header: data.block,
                    transactions: data.transactions,
                },
            ];
        }
    });
</script>

<div class="ml-4">
    {#if !data}
        <Loader />
    {:else if data.error}
        <Button on:click={() => history.back()} leftIcon={LeftArrow} class="mb-2">
            Back
        </Button>
        <Error value={data.error} />
    {:else}
        <div class="mb-4">
            <h1 class="text-6xl text-gray-600">Block Detail</h1>
        </div>
        <Button on:click={() => history.back()} leftIcon={LeftArrow} class="mb-2">
            Back
        </Button>
        <Blocks clickable={false} class="mb-6" {blocks} />
        <div>
            <table class="w-full table-fixed">
                <thead>
                    <tr>
                        <th>Trx. #</th>
                        <th>Service</th>
                        <th>Sender</th>
                        <th>Method</th>
                    </tr>
                </thead>
                <tbody>
                    {#each data.transactions as trx, index}
                        {#each trx.actions as action}
                            <tr>
                                <td>{index + 1}</td>
                                <td>{action.service}</td>
                                <td>{action.sender}</td>
                                <td>{action.method}</td>
                            </tr>
                        {/each}
                    {/each}
                </tbody>
            </table>
        </div>
    {/if}
</div>

<style>
    th,
    td {
        @apply font-mono;
        @apply text-sm;
        @apply p-2;
        @apply text-left;
    }
    th {
        @apply font-bold;
    }
</style>
