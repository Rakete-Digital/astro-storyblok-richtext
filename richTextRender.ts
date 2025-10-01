import { richTextResolver } from "./richtext";
import { type Resolvers, type RichTextRenderOptions, type ResolverKey, MarkTypes, TextNode } from "./types";

const defaultResolvers: Resolvers = {
  [MarkTypes.HIGHLIGHT]: (node: TextNode) => {
    const color = node.attrs?.color;
    return `<span style="background-color:${color};">${node.text}</span>`;
  },
  [MarkTypes.LINK]: (node: TextNode) => {
    const { href, target, anchor, linktype, story } = node.attrs || {};

    let finalHref = href || "#";

    if (linktype === "story" && story?.full_slug) {
      finalHref = `/${story.full_slug}`;
    }

    if (anchor) {
      finalHref += `#${anchor}`;
    }

    return `<a href="${finalHref}" target="${target || "_self"}" class="rich-text-link">${node.text}</a>`;
  },
};

export async function richTextRender(
  content: any,
  options: RichTextRenderOptions = {}
): Promise<string> {
  const { except = [], resolvers = {} } = options;

  // filter out excluded resolvers
  const filteredResolvers: Resolvers = Object.fromEntries(
    Object.entries(defaultResolvers).filter(
      ([key]) => !except.includes(key as ResolverKey)
    )
  );

  const resolver = richTextResolver({
    resolvers: {
      ...filteredResolvers,
      ...resolvers, // user overrides
    },
  });

  return resolver.renderHTML(content);
}
