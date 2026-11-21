# Preview height regression

The live native page was checked in Chrome; no in-app browser surface was
available. Three polls at a 920×800 CSS viewport showed the same excessive
height while real native prices changed. The old tablet CSS required a
925px order panel and stretched it across the book and ticket rows. Its
actual table content was only 83px. The SVG height was stable and the hidden
recent-trade list had `display:none`.

| Live measurement | Before | After |
|---|---:|---:|
| Page scroll height | 1954px | 1241px |
| Trading grid | 1451.69px | 738.5px |
| Order panel | 1027.69px | 134px |
| Order table content | 83px | 83px |
| Plot viewport | 275.5px | 456px |

The fix removes artificial book, ticket, and order-panel minima, keeps three
columns where they fit down to 860px, and uses natural rows at narrower
widths. The order list scrolls internally when long. The chart uses the
available space rather than a blank order panel.

Three subsequent polls had exactly the same corrected dimensions; raw
measurements are in `layout-height-after.json`. Additional 760px and 390px
checks had no horizontal page overflow. At 390px the plot is 235px high;
the real book, ticket, orders, and assets remain accessible by normal page
scrolling. Screenshots are `layout-preview.jpg` and `layout-phone.jpg`.

Only `/style.css` was uploaded to native Sites for this fix. The existing
compatible financial JavaScript remained live; the unpublished Stop market
button count was zero. No financial transaction or API change was deployed.
The browser was returned to its normal viewport, Alice, BTC/USD market #1,
and the 5-second price/volume chart.
