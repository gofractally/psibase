# InviteSys App

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->

**Table of contents**

-   [Setup](#setup)
-   [Directory Structure](#directory-structure)
    -   [Top-level Structure](#top-level-structure)
    -   [Example](#example)
    -   [Pages vs. Views vs. Components](#pages-vs-views-vs-components)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

## Setup

Refer to the top-level README for instructions setting up and running the web app.

## Temporary Mock Users

Anyone can log in with their full name and hive user name. The hive username is only used to pull their photo, if it exists. If not, it lets them in anyway. (So really, any value can be used for the hive username part of the login.)

## Directory Structure

The directory structure for the React app is inspired by [React Architecture: How to Structure and Organize a React Application](https://www.taniarascia.com/react-architecture-directory-structure/). This is a first draft proposal and is subject to change based on feedback from the team or as requirements grow.

### Top-level Structure

-   **assets** - global static assets such as images, svgs, logos, etc.
-   **components** - global shared/reusable components, such as layout (wrappers, navigation), form components, buttons (if these are highly reusable, we should consider moving them to the Storybook component library in this monorepo)
-   **pages** - these should map directly to pages
-   **store** - client-side state (reducers, actions, etc.)
-   **styles** - styles

### Example

```
src
 ┣ assets
 ┃ ┗ logo.svg
 ┣ components
 ┃ ┣ index.ts
 ┃ ┗ sample-modal.tsx
 ┣ pages
 ┃ ┣ elsewhere
 ┃ ┃ ┣ views
 ┃ ┃ ┃ ┣ elsewhere-table.tsx
 ┃ ┃ ┃ ┗ index.ts
 ┃ ┃ ┗ elsewhere.tsx
 ┃ ┣ home
 ┃ ┃ ┗ home.tsx
 ┃ ┗ index.tsx
 ┣ store
 ┃ ┣ actions.ts
 ┃ ┗ index.tsx
 ┣ styles
 ┃ ┗ globals.css
 ┣ favicon.svg
 ┣ main.tsx
 ┗ vite-env.d.ts
```

### Pages vs. Views vs. Components

-   **Pages** contain directories which enclose the page's file and related views.
-   **Views** are nested within pages and represent components that appear only in that page (not somewhere else).
-   **Components** are reusable components that could appear anywhere in the UI. Just keep in mind that if they're highly reusable (_e.g._, `<Button />`), it may make sense to move them into the Storybook component library in `/packages/components`.
