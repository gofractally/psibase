<script>
    export let value;
    export let token = null;
    export let precision = null;
    export let symbol = null;


    const parseAmount = (value, precision) => {
        const parsed = Number(Number(value) / Math.pow(10, precision));
        return parsed.toString();
    };

</script>

<span class="uppercase">
    {parseAmount(value, token ? token.precision: precision)}
    {token ? token.symbol : symbol}
</span>
