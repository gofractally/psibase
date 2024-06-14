# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/README.md) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type aware lint rules:

- Configure the top-level `parserOptions` property like this:

```js
export default {
  // other rules...
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    project: ['./tsconfig.json', './tsconfig.node.json'],
    tsconfigRootDir: __dirname,
  },
}
```

- Replace `plugin:@typescript-eslint/recommended` to `plugin:@typescript-eslint/recommended-type-checked` or `plugin:@typescript-eslint/strict-type-checked`
- Optionally add `plugin:@typescript-eslint/stylistic-type-checked`
- Install [eslint-plugin-react](https://github.com/jsx-eslint/eslint-plugin-react) and add `plugin:react/recommended` & `plugin:react/jsx-runtime` to the `extends` list


## TASKS
O-update code to remove hidden Links from effect of forces (so they float to outside of bounding box as they did before; this'll create more room for the relevant nodes to spread)
-James suggestion of friends group based on degrees of separation (Center a few people to see a personal network)

-arrow tips don't match arrow shafts
-add nudge to repeat a mouse click a few times slowly to spread the graph
-back-links don't have arrow heads that match line color
-url-query-encoded filter params?
O- mock up a few scenarios by adding color data to the graph

Explorations:
-custom filters?
-incoming/outgoing depth
-Improve color gradient. clearer/nicer. not red-green blind sensitive. configurable?


Feedback
-Who have I attested to and all my friends? Color it; not render stand-alone graph
 - with adjustment for depth (level of indirection)

Completed:
x-numerous ui options, including DepthToSubject, don't keep their value when switching between graphModes
x-poke the simulation on new centered node to redistribute the nodes
 x-changing depth breaks resetting graph and only works in one direction (stopped updating because the simulation had stabalized and was no longer updating)
 x-multi-center-clicking fails pretty fast (also an issue of simulation stopping?)
x-copy notes from previous project html
x-Add types
x-pulse centered node
x-Wire up Council distance spinner (not changing # links highlighted)
x-clarify/streamline the ideal call path:
x - update ui options, calc graph, paint links (based on ui options)
x - changing dagDepth should not restart the sim
x - just pass uiOptions into function, rather the pieces of it
x-Clean up code paths to make fixing these remaining bugs easier
x-Add color picker working
x-Fix the elastic hanging that happens after initial settling: try adding a charge attraction to a huge circle that pulls things toward the bottom of the viewport but not like the centering force
x-how to analyze the graph to color elements?
x-Add meta data to the graph data
x-Venus, Miriam have an extra arrow?!
x-consider moving this to React before it gets too much more complex
x-Fix: unchecking Council distance doesn't clear the suspect links
x - highlight Council member connections of < X hops
x-Explore hilighting potential problems: Experiment with adding adjustable limited depth to graphToDAG algo
x- council connectivity (only) up to a depth of X (slider)
x- red = suspect links?
x-limit depth of search from subject node
x- UI: show/hide connection types; customize color
x- UI: switcher for each connection type: be able to switch outgoing connections be straight lines and incoming be curved; then switch that. Apply forces only to one or the other.
x-fix account-creations not being rendered on DAGification
x-Work on prettiness, perhaps a blue-to-white reputation gradient instead of red to green
x - or a radial gradient where the amount of solid center increases with reputation
x-account creation, identity attestation
x-add back links
x-black dot in middle to show centered person? --> pulse
x-modularize and clean up code
x-Check this shit into github so I don't lose it all and don't have to keep copying shit that works.
x-no size difference.
x - color gradient instead?
x-arrow improvement
x-badge or border for council --> text color
x-Mock up a far larger graph to test, with appropriate number of Council members
x-add bounding box so everything's on-screen
x-Add arrows to make it a DAG so another algo can analyze relationships
x-add mutual attestations. it won't be a DAG

