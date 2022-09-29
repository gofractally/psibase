<div class="ButtonSet flex flex-row items-center divide-x">
    <slot />
</div>

<style>
    .ButtonSet > :global(button):first-child {
        border-right: none;
    }
    .ButtonSet > :global(button):last-child {
        @apply border-r;
    }
</style>
