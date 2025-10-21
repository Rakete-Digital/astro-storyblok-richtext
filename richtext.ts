import { optimizeImage } from './images-optimization';
import {
  BlockTypes,
  LinkTypes,
  MarkTypes,
  TextTypes,
} from './types';
import type {
  BlockAttributes,
  MarkNode,
  StoryblokRichTextContext,
  StoryblokRichTextNode,
  StoryblokRichTextNodeResolver,
  StoryblokRichTextNodeTypes,
  StoryblokRichTextOptions,
  TextNode,
} from './types';
import {
  attrsToString,
  attrsToStyle,
  cleanObject,
  escapeHtml,
  SELF_CLOSING_TAGS,
} from './utils';

import { experimental_AstroContainer } from 'astro/container';
import StoryblokComponent from '@storyblok/astro/StoryblokComponent.astro';

// Astro container and async queue for component resolver
let container: null | experimental_AstroContainer = null;
let asyncReplacements: Promise<{ id: string; result: string }>[] = [];

/** Default HTML render function */
function defaultRenderFn<T = string | null>(
  tag: string,
  attrs: BlockAttributes = {},
  children?: T,
): T {
  const attrsString = attrsToString(attrs);
  const tagString = attrsString ? `${tag} ${attrsString}` : tag;
  const content = Array.isArray(children) ? children.join('') : children || '';

  if (!tag) {
    return content as unknown as T;
  } else if (SELF_CLOSING_TAGS.includes(tag)) {
    return `<${tagString}>` as unknown as T;
  }
  return `<${tagString}>${content}</${tag}>` as unknown as T;
}

export function richTextResolver<T>(options: StoryblokRichTextOptions<T> = {}) {
  const keyCounters = new Map<string, number>();

  const {
    renderFn = defaultRenderFn,
    textFn = escapeHtml,
    resolvers = {},
    optimizeImages = false,
    keyedResolvers = false,
    language
  } = options;
  const isExternalRenderFn = renderFn !== defaultRenderFn;

  /** process attributes */
  const processAttributes = (attrs: BlockAttributes = {}): BlockAttributes => {
    const { textAlign, class: className, id: idName, style: existingStyle, ...rest } = attrs;
    const styles: string[] = [];

    if (existingStyle) {
      styles.push(existingStyle.endsWith(';') ? existingStyle : `${existingStyle};`);
    }

    if (textAlign) {
      styles.push(`text-align: ${textAlign};`);
    }

    return cleanObject({
      ...rest,
      class: className,
      id: idName,
      ...(styles.length > 0 ? { style: styles.join(' ') } : {}),
    });
  };

  const nodeResolver = (tag: string): StoryblokRichTextNodeResolver<T> =>
    (node: StoryblokRichTextNode<T>, context): T => {
      const attributes = processAttributes(node.attrs);
      return context.render(tag, attributes, node.children || null as any) as T;
    };

  const imageResolver: StoryblokRichTextNodeResolver<T> = (node, context) => {
    const { src, alt, title, srcset, sizes } = node.attrs || {};
    let finalSrc = src;
    let finalAttrs = {};

    if (optimizeImages) {
      const { src: optimizedSrc, attrs: optimizedAttrs } = optimizeImage(src, optimizeImages);
      finalSrc = optimizedSrc;
      finalAttrs = optimizedAttrs;
    }

    const imgAttrs = {
      src: finalSrc,
      alt,
      title,
      srcset,
      sizes,
      ...finalAttrs,
    };

    return context.render('img', cleanObject(imgAttrs)) as T;
  };

  const headingResolver: StoryblokRichTextNodeResolver<T> = (node, context): T => {
    const { level, ...rest } = node.attrs || {};
    const attributes = processAttributes(rest);
    return context.render(`h${level}`, attributes, node.children) as T;
  };

  const emojiResolver: StoryblokRichTextNodeResolver<T> = (node, context) => {
    const internalImg = context.render('img', {
      src: node.attrs?.fallbackImage,
      alt: node.attrs?.alt,
      style: 'width: 1.25em; height: 1.25em; vertical-align: text-top',
      draggable: 'false',
      loading: 'lazy',
    }) as T;

    return context.render('span', {
      'data-type': 'emoji',
      'data-name': node.attrs?.name,
      'data-emoji': node.attrs?.emoji,
    }, internalImg) as T;
  };

  const codeBlockResolver: StoryblokRichTextNodeResolver<T> = (node, context): T => {
    return context.render('pre', node.attrs || {}, context.render('code', {}, node.children || '' as any),
    ) as T;
  };

  const markResolver = (tag: string, styled = false): StoryblokRichTextNodeResolver<T> =>
    ({ text, attrs }, context): T => {
      const { class: className, id: idName, ...styleAttrs } = attrs || {};
      const attributes = styled
        ? {
          class: className,
          id: idName,
          style: attrsToStyle(styleAttrs) || undefined,
        }
        : attrs || {};

      return context.render(tag, cleanObject(attributes), text as any) as T;
    };

  const renderToT = (node: any): T => render(node) as unknown as T;

  const textResolver: StoryblokRichTextNodeResolver<T> = (node: StoryblokRichTextNode<T>): T => {
    const { marks, ...rest } = node as TextNode<T>;
    if ('text' in node) {
      if (marks) {
        return marks.reduce(
          (text: T, mark: MarkNode<T>) => renderToT({ ...mark, text }) as T,
          renderToT({ ...rest, children: rest.children as T }) as T,
        );
      }
      const attributes = node.attrs || {};
      if (keyedResolvers) {
        const currentCount = keyCounters.get('txt') || 0;
        keyCounters.set('txt', currentCount + 1);
        attributes.key = `${'txt'}-${currentCount}`;
      }
      return textFn(rest.text, attributes) as T;
    }
    return '' as T;
  };

  const linkResolver: StoryblokRichTextNodeResolver<T> = (node, context) => {
    const { linktype, href, anchor, ...rest } = node.attrs || {};

    let finalHref = '';
    switch (linktype) {
      case LinkTypes.ASSET:
      case LinkTypes.URL:
        finalHref = href;
        break;
      case LinkTypes.EMAIL:
        finalHref = `mailto:${href}`;
        break;
      case LinkTypes.STORY:
        finalHref = href;
        if (anchor) finalHref = `${finalHref}#${anchor}`;
        break;
      default:
        finalHref = href;
        break;
    }
    const attributes: Record<string, any> = { ...rest };
    if (finalHref) attributes.href = finalHref;
    return context.render('a', attributes, node.text as any) as T;
  };

  /** 
   * Component resolver — uses AstroContainer 
   * returns placeholders and queues async renders
   */
  const componentResolver: StoryblokRichTextNodeResolver<T> = (node): T => {
    const componentBody = node.attrs?.body;
    if (!Array.isArray(componentBody)) return '' as T;

    const html = componentBody.map((blok) => {
      if (!blok || typeof blok !== 'object') return '';
      const id = crypto.randomUUID();
      const placeholder = `<!--ASYNC-${id}-->`;

      if (container) {
        const promise = container
          .renderToString(StoryblokComponent, { props: { blok, language } })
          .then((result: any) => ({ id, result }))
          .catch((err: any) => {
            console.error('Component rendering failed:', err);
            return { id, result: '<!-- Component render error -->' };
          });
        asyncReplacements.push(promise);
      }
      return placeholder;
    }).join('\n');

    return html as unknown as T;
  };

  // table resolvers
  const tableResolver: StoryblokRichTextNodeResolver<T> = (node, context): T => {
    const attributes = processAttributes(node.attrs);
    const children = node.children || null as any;
    return context.render('table', attributes, context.render('tbody', {}, children)) as T;
  };

  const tableRowResolver: StoryblokRichTextNodeResolver<T> = (node, context): T => {
    const attributes = processAttributes(node.attrs);
    return context.render('tr', attributes, node.children) as T;
  };

  const tableCellResolver: StoryblokRichTextNodeResolver<T> = (node, context): T => {
    const { colspan, rowspan, colwidth, backgroundColor, textAlign, ...rest } = node.attrs || {};
    const styles: string[] = [];
    if (colwidth) styles.push(`width: ${colwidth}px;`);
    if (backgroundColor) styles.push(`background-color: ${backgroundColor};`);
    if (textAlign) styles.push(`text-align: ${textAlign};`);
    const attributes = {
      ...rest,
      ...(colspan > 1 ? { colspan } : {}),
      ...(rowspan > 1 ? { rowspan } : {}),
      ...(styles.length > 0 ? { style: styles.join(' ') } : {}),
    };
    return context.render('td', cleanObject(attributes), node.children) as T;
  };
  
  const tableHeaderResolver: StoryblokRichTextNodeResolver<T> = (node, context): T => {
    const { colspan, rowspan, colwidth, backgroundColor, textAlign, ...rest } = node.attrs || {};
    const styles: string[] = [];
    if (colwidth) styles.push(`width: ${colwidth}px;`);
    if (backgroundColor) styles.push(`background-color: ${backgroundColor};`);
    if (textAlign) styles.push(`text-align: ${textAlign};`);
    const attributes = {
      ...rest,
      ...(colspan > 1 ? { colspan } : {}),
      ...(rowspan > 1 ? { rowspan } : {}),
      ...(styles.length > 0 ? { style: styles.join(' ') } : {}),
    };
    return context.render('th', cleanObject(attributes), node.children) as T;
  };

  const originalResolvers = new Map<StoryblokRichTextNodeTypes, StoryblokRichTextNodeResolver<T>>([
    [BlockTypes.DOCUMENT, nodeResolver('')],
    [BlockTypes.HEADING, headingResolver],
    [BlockTypes.PARAGRAPH, nodeResolver('p')],
    [BlockTypes.UL_LIST, nodeResolver('ul')],
    [BlockTypes.OL_LIST, nodeResolver('ol')],
    [BlockTypes.LIST_ITEM, nodeResolver('li')],
    [BlockTypes.IMAGE, imageResolver],
    [BlockTypes.EMOJI, emojiResolver],
    [BlockTypes.CODE_BLOCK, codeBlockResolver],
    [BlockTypes.HR, nodeResolver('hr')],
    [BlockTypes.BR, nodeResolver('br')],
    [BlockTypes.QUOTE, nodeResolver('blockquote')],
    [BlockTypes.COMPONENT, componentResolver],
    [TextTypes.TEXT, textResolver],
    [MarkTypes.LINK, linkResolver],
    [MarkTypes.ANCHOR, linkResolver],
    [MarkTypes.STYLED, markResolver('span', true)],
    [MarkTypes.BOLD, markResolver('strong')],
    [MarkTypes.TEXT_STYLE, markResolver('span', true)],
    [MarkTypes.ITALIC, markResolver('em')],
    [MarkTypes.UNDERLINE, markResolver('u')],
    [MarkTypes.STRIKE, markResolver('s')],
    [MarkTypes.CODE, markResolver('code')],
    [MarkTypes.SUPERSCRIPT, markResolver('sup')],
    [MarkTypes.SUBSCRIPT, markResolver('sub')],
    [MarkTypes.HIGHLIGHT, markResolver('mark')],
    [BlockTypes.TABLE, tableResolver],
    [BlockTypes.TABLE_ROW, tableRowResolver],
    [BlockTypes.TABLE_CELL, tableCellResolver],
    [BlockTypes.TABLE_HEADER, tableHeaderResolver],
  ]);

  const mergedResolvers = new Map<StoryblokRichTextNodeTypes, StoryblokRichTextNodeResolver<T>>([
    ...originalResolvers,
    ...(Object.entries(resolvers).map(([type, resolver]) => [type as StoryblokRichTextNodeTypes, resolver])) as unknown as Array<[StoryblokRichTextNodeTypes, StoryblokRichTextNodeResolver<T>]>,
  ]);

  const createRenderContext = () => {
    const contextRenderFn = (tag: string, attrs: BlockAttributes = {}, children?: T): T => {
      if (keyedResolvers && tag) {
        const currentCount = keyCounters.get(tag) || 0;
        keyCounters.set(tag, currentCount + 1);
        attrs.key = `${tag}-${currentCount}`;
      }
      return renderFn(tag, attrs, children);
    };
    const context: StoryblokRichTextContext<T> = {
      render: contextRenderFn,
      originalResolvers,
      mergedResolvers,
    };
    return context;
  };

  function renderNode(node: StoryblokRichTextNode<T>): T {
    if (!node || typeof node !== 'object' || !('type' in node)) {
      return '' as unknown as T;
    }

    const resolver = mergedResolvers.get(node.type as StoryblokRichTextNodeTypes);
    if (!resolver) {
      console.error('<Storyblok>', `No resolver found for node type ${node.type}`);
      return '' as unknown as T;
    }

    const context = createRenderContext();

    if (node.type === 'text') {
      return resolver(node as StoryblokRichTextNode<T>, context);
    }

    const children = node.content
      ? node.content.filter(Boolean).map(render) // filter null/undefined
      : undefined;

    return resolver({
      ...node,
      children: children as T,
    }, context);
  }

  function render(node: any): T {
    if (Array.isArray(node)) {
      return node.filter(Boolean).map(renderNode) as T;
    }
    if (!node) return '' as T;
    if (node.type === 'doc') {
      const rendered = node.content
        .filter(Boolean)
        .map(renderNode);
      return isExternalRenderFn ? rendered as T : rendered.join('') as T;
    }
    return renderNode(node) as T;
  }

  return {
    render,

    /** async renderHTML to handle blok components */
    async renderHTML(richTextField: StoryblokRichTextNode<T>) {
      if (!container) {
        container = await experimental_AstroContainer.create();
      }
      asyncReplacements = [];
      let html = render(richTextField) as string;
      const results = await Promise.all(asyncReplacements);
      const replacements = new Map(results.map(r => [r.id, r.result ?? '']));
      html = html.replace(/<!--ASYNC-([\w-]+)-->/g, (_, id) => replacements.get(id) ?? '');
      return html;
    },
  };
}
