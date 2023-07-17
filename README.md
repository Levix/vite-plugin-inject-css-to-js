# vite-plugin-inject-css-to-js

Combine this with the **[Vite 3+](https://vitejs.dev/)** build.cssCodeSplit CSS code splitting capability to build css into individual js files instead of using css links.

## Install

> Make sure your vite version is 3 or higher.

```sh
# pnpm
pnpm add -D vite-plugin-inject-css-to-js
# yarn
yarn add -D vite-plugin-inject-css-to-js
# npm
npm i -D vite-plugin-inject-css-to-js
```

## Usage

```ts
// vite.config.js
import { defineConfig } from 'vite';

// 1. import the plugin
import { InjectCssToJsPlugin } from 'vite-plugin-inject-css-to-js';

export default defineConfig({
    plugins: [
        // 2. add it to the plugins list
        InjectCssToJsPlugin(),
    ],
});
```

## Q&A

### Why can't I build all css files into js?

Since Vite [vite:build-html](https://github.com/vitejs/vite/blob/fd1b7315852616a00156f79b413c0f2a0029e51b/packages/vite/src/node/plugins/html.ts#L287) plugin is executed before this plugin (i.e. enforce: pre is set by default), when this plugin generateBundle hook is executed, the html file has already been transformed, so it is not desirable to violently remove all the link css links on the html, and we can't rule out the scenarios where the plugin dynamically inserts link css links via transformIndexHtml hook. It is not desirable to violently remove all the link css links on html, we can't exclude the scenario that other plugins dynamically insert link css links through transformIndexHtml hook.

### How transformIndexHtml hooks are implemented in vite:build-html plugin.

The vite:build-html plugin calls the resolveHtmlTransforms method to get all the transformIndexHtml hooks inside the plugin, which are classified as preHooks, normalHooks and postHooks.

If order: pre is set, it is classified as preHooks, if post is set, it is classified as postHooks, and if transformIndexHtml is a pure method, it is classified as normalHooks.

```JavaScript
/** preHooks */
transformIndexHtml: {
    order: 'pre',
    handler: (html) => {
        return html;
    }
}

/** normalHooks */
transformIndexHtml() {}

/** postHooks */
transformIndexHtml: {
    order: 'post',
    handler: (html) => {
        return html;
    }
}
```

At this point, the vite:build-html plugin will call applyHtmlTransforms inside the transform hook to execute the preHooks, and then the generateBundle hook to execute the [... .normalHooks, . .postHooks] hooks. This also explains why we can't remove all css links from html by transformIndexHtml hook in this plugin, because other plugins may manually insert other css links inside transformIndexHtml hook.

### How to get the path of the css external link referenced inside the html file?

Refer to Vite4 source code [getCssTagsForChunk](https://github.com/vitejs/vite/blob/fd1b7315852616a00156f79b413c0f2a0029e51b/packages/vite/src/node/plugins/html.ts#L654) method to get the css external file name (i.e. final file path).

```Typescript
const cssTags: Set<string> = new Set();
const analyzedChunk: Map<OutputChunk, number> = new Map();
const getCssTagsForChunk = (chunk: OutputChunk, seen: Set<string> = new Set()) => {
    const tags: { filename: string }[] = [];
    if (!analyzedChunk.has(chunk)) {
        analyzedChunk.set(chunk, 1);
        chunk.imports.forEach(file => {
            const importee = ctx.bundle?.[file];
            if (importee?.type === 'chunk') {
                tags.push(...getCssTagsForChunk(importee, seen));
            }
        });
    }

    chunk.viteMetadata!.importedCss.forEach(file => {
        if (!seen.has(file)) {
            seen.add(file);
            tags.push({
                filename: file,
            });
        }
    });

    return tags;
};
```

### Is it a concern that other plugins manually inject css files via the transformIndexHtml hook?

Personally, I don't need to pay attention to css files, because usually emitFile is used to create a file, and the path to the file will be available in the production package that is built.

## License

[MIT](./LICENSE) © Levix
