<script>
    import { LoaderIcon } from "/src/assets/icons";
</script>

<div aria-modal="true">
    <LoaderIcon style="width: 48px; height: 48px;" class="animate-spin" />
</div>

<style>
    div {
        overflow-y: auto;
        overflow-x: hidden;
        position: fixed;
        height: 100vh;
        z-index: 50;
        justify-content: center;
        display: flex;
        @apply items-center;
        @apply inset-0;
        @apply bg-opacity-0;
        @apply opacity-0;
        @apply transition;
        @apply ease-in-out;
        @apply duration-200;
        @apply bg-opacity-50;
        @apply opacity-100;
    }
</style>
