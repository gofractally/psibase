<script>
    import classNames from "classnames";
    import { IncomingIcon, OutgoingIcon } from "/src/assets/icons";
    import { Amount } from "/src/components";

    export let data = null;

    const getAction = (t) => {
        if (t.receiver === data.account) {
            return IncomingIcon;
        }
        return OutgoingIcon;
    }
</script>

<table class={classNames($$props.class, "w-full table-fixed")}>
    <thead>
        <tr class="border-b border-b-black">
            <th>Date</th>
            <th>From</th>
            <th>To</th>
            <th>Action</th>
            <th>Amount</th>
        </tr>
    </thead>
    <tbody>
    {#each data.history as t}
        <tr>
            <td class="w-20">{t.time}</td>
            <td>{t.sender}</td>
            <td>{t.receiver}</td>
            <td><svelte:component this={getAction(t)} /></td>
            <td><Amount value={t.amount.value} token={data.tokenTypes[t.tokenId]} /></td>
        </tr>
    {/each}
    </tbody>
</table>
