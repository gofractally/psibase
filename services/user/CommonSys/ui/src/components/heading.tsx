import React from "react";

export type HeadingTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "span";

// NOTE: These should match what's in `index.css`.
const HEADING_STYLES: { [key in HeadingTag]: string } = {
    h1: "text-5xl md:text-6xl font-semibold",
    h2: "text-4xl md:text-5xl font-semibold",
    h3: "text-3xl md:text-4xl font-semibold",
    h4: "text-2xl md:text-3xl font-semibold tracking-normal md:tracking-[-0.02em]",
    h5: "text-xl md:text-2xl font-semibold",
    h6: "text-lg leading-6 md:text-xl md:leading-7 font-semibold",
    span: "",
};

export interface HeadingProps {
    tag: HeadingTag;
    styledAs?: HeadingTag;
    className?: string;
    children: React.ReactNode;
}

/**
 * The `<Heading />` component provides an opinionated interface to headings.
 * It may eventually offer more config options (e.g, color variants).
 *
 * HTML Heading tags are structural and syntactical, not stylistic. They outline the structure
 * of the document for parsing by screen readers, search engines, etc. Levels should not be
 * skipped when possible, and there should optimally be only one `H1` per page.
 *
 * If you wish to have an `H2` that's styled with the default `H5` styles, use the component like this:
 * `<Heading tag="h2" styledAs="h5">My Heading</Heading>`. This can help us maintain the proper
 * document structure while adhering to our fixed set of text styles. You can also create `span` tags
 * styled with heading styles in this way.
 */
export const Heading = ({
    tag,
    styledAs,
    className,
    children,
}: HeadingProps) => {
    let styledAsClass = "";
    if (styledAs) styledAsClass = HEADING_STYLES[styledAs];
    return React.createElement(
        tag,
        {
            className: `${styledAsClass} ${className}`,
        },
        children
    );
};

export default Heading;
