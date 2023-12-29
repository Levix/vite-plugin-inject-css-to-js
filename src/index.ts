import type { OutputChunk } from 'rollup';
import type { BuildOptions, Plugin } from 'vite';
import { createLogger } from 'vite';
import CleanCSS from 'clean-css';

export function InjectCssToJsPlugin({
    beforeInjectCss,
}: {
    beforeInjectCss?: (cssCode: string) => string | Promise<string>;
} = {}): Plugin {
    const logger = createLogger();

    let buildConfig: BuildOptions | undefined;

    // css full resource mapping list
    const cssSourceMap: Map<string, string> = new Map();

    // external links css tags collection
    const cssTags: Set<string> = new Set();

    let isSkip = false;

    // Compress css (not just minimise it), remove same class names, attributes, etc.
    const compressCss = (chunk: OutputChunk, cssCode: string) => {
        let processedCssCode = cssCode;
        let moduleIds = chunk.moduleIds;
        if (!moduleIds) {
            moduleIds = Object.keys(chunk.modules);
        }
        // chunk module from node_modules, no css compression required.
        const isFromNodeModules = moduleIds.filter(id => id.includes('node_modules')).length;
        if (!isFromNodeModules) {
            try {
                const output = new CleanCSS({
                    level: 2,
                    compatibility: 'ie7',
                }).minify(cssCode);
                processedCssCode = output.styles;
            } catch (error: any) {
                logger.error('Failed to compress CSS: ', { error });
            }
        }
        return processedCssCode;
    };

    // Checking for skipping
    const checkIsSkip = () => {
        if (buildConfig?.cssCodeSplit === false) {
            logger.warn(
                `The 'cssCodeSplit' option is set to true in the 'build' configuration of userConfig, which is not supported by this plugin, so it is skipped.`,
            );
            isSkip = true;
        }
    };

    return {
        name: 'vite-plugin-inject-css-to-js',
        apply: 'build',
        enforce: 'post',

        config(userConfig) {
            buildConfig = userConfig.build;
            checkIsSkip();
        },

        transformIndexHtml: {
            enforce: 'post',
            transform: function (html, ctx) {
                if (isSkip) {
                    return html;
                }

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
                if (ctx.chunk?.type === 'chunk' && ctx.chunk.isEntry) {
                    getCssTagsForChunk(ctx.chunk).forEach(cssTag => {
                        cssTags.add(cssTag.filename);
                    });
                }
                return html;
            },
        },

        async generateBundle(_, bundle) {
            if (isSkip) {
                return;
            }

            const emittedFileList: string[] = [];

            let bundleKeys = Object.keys(bundle);

            for (let i = 0; i < bundleKeys.length; i++) {
                const key = bundleKeys[i];
                const chunk = bundle[key];
                if (chunk.type === 'asset' && chunk.fileName.endsWith('.css')) {
                    /**
                     * Stores the css mapping list, currently the fileName matches the id inside the entry chunk.viteMetadata.importedCss because build.cssCodeSplit is set to true.
                     * Refer to node_modules\vite\dist\node\chunks\dep-51c4f80a.js L43554 chunk.viteMetadata.importedCss.add
                     */
                    cssSourceMap.set(chunk.fileName, chunk.source as string);
                    delete bundle[key];
                }
            }

            bundleKeys = Object.keys(bundle);

            for (let i = 0; i < bundleKeys.length; i++) {
                const key = bundleKeys[i];
                const chunk = bundle[key];
                if (chunk.type === 'chunk' && chunk?.viteMetadata?.importedCss.size) {
                    // get the importedCss setting from viteMetadata and inject the corresponding css content into the js based on the id.
                    const importedCss = Array.from(chunk.viteMetadata.importedCss);
                    for (let cssId of importedCss) {
                        let cssCode = cssSourceMap.get(cssId);
                        if (!cssCode) {
                            continue;
                        }
                        cssCode = compressCss(chunk, cssCode);
                        // If the match can not be written directly to the js file, but should manually create a css file, so that the html file inside the css external links can be accessed normally!
                        if (cssTags.has(cssId)) {
                            if (!emittedFileList.includes(cssId)) {
                                emittedFileList.push(cssId);
                                this.emitFile({ type: 'asset', fileName: cssId, source: cssCode });
                            }
                        } else {
                            const initialCode = chunk.code;
                            const originalCssCode = cssCode;
                            if (cssCode && typeof beforeInjectCss === 'function') {
                                cssCode = await beforeInjectCss(cssCode);
                            }
                            if (!cssCode || typeof cssCode !== 'string') {
                                logger.warn(
                                    `The beforeInjectCss hook returns content that is not a string or is empty, reverting to the original content.`,
                                );
                                cssCode = JSON.stringify(originalCssCode.trim());
                            }
                            chunk.code =
                                `(function(){ try {var elementStyle = document.createElement('style'); elementStyle.appendChild(document.createTextNode(` +
                                `${cssCode}` +
                                `));document.head.appendChild(elementStyle);} catch(e) {console.error('style-injected-by-js', e);} })(); ` +
                                `${initialCode}`;
                        }
                    }

                    // Clear the importedCss dependency, this is to prevent the module from inserting css into the html at runtime if modulePreload is true and the file can't be found.
                    chunk.viteMetadata.importedCss.clear();
                }
            }
            cssSourceMap.clear();
        },
    };
}
