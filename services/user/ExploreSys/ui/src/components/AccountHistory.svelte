<script>
    import classNames from "classnames";
    import IncomingIcon from "/src/assets/icons/incoming.svg";
    import OutgoingIcon from "/src/assets/icons/incoming.svg";

    export let data = null;

    const getAction = (t) => {
        if (t.receiver === data.account) {
            return IncomingIcon;
        }
        return OutgoingIcon;
    }
</script>

<table class={classNames($$props.class, "w-full table-fixed")}>
    <tbody>
        <tr class="border-b border-b-black">
            <th>Date</th>
            <th>From</th>
            <th>To</th>
            <th>Action</th>
            <th>Amount</th>
        </tr>
    {#each data.history as t}
        <tr>
            <td class="w-20">{t.time}</td>
            <td>{t.sender}</td>
            <td>{t.receiver}</td>
            <td><svelte:component this={getAction(t)} /></td>
            <td>{t.amount.value}</td>
        </tr>
    {/each}
    </tbody>
</table>
