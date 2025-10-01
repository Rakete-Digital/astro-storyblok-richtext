import { richTextResolver } from "./richtext";
import { MarkTypes } from "./types";

export async function richTextRender(content: any): Promise<string> {
  const resolver = richTextResolver({
    resolvers: {
      highlight: (node) => {
        const color = node.attrs?.color;
        return `<span style="background-color:${color};">${node.text}</span>`;
      },
      [MarkTypes.LINK]: (node) => {
        const { href, target, anchor, linktype, story } = node.attrs || {};

        let finalHref = href || "#";

        // Handle Storyblok story links
        if (linktype === "story" && story?.full_slug) {
          finalHref = `/${story.full_slug}`;
        }

        // Append anchor if available
        if (anchor) {
          finalHref += `#${anchor}`;
        }

        return `<a href="${finalHref}" target="${target || "_self"}" class="rich-text-link">${node.text}</a>`;
      },
    },
  });

  return resolver.renderHTML(content);
}
