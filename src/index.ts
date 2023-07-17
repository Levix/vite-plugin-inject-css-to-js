import type { OutputChunk } from 'rollup';
import type { BuildOptions, Plugin } from 'vite';
import { createLogger } from 'vite';
import CleanCSS from 'clean-css';

/**
 * @file 转换 css 插件，将其内置到模块内
 */
export function InjectCssToJsPlugin(): Plugin {
    const logger = createLogger();

    let buildConfig: BuildOptions | undefined;

    // css 全量资源映射表
    const cssSourceMap: Map<string, string> = new Map();

    // 外链 css 标签集合
    const cssTags: Set<string> = new Set();

    // 是否跳过
    let isSkip = false;

    // 压缩 css（非单纯最小化），移除相同类名、属性等
    const compressCss = (chunk: OutputChunk, cssCode: string) => {
        let processedCssCode = cssCode;
        // 来自于 node_modules 的 chunk 模块，无需压缩 css
        const isFromNodeModules = chunk.moduleIds.filter(id => id.includes('node_modules')).length;
        if (!isFromNodeModules) {
            try {
                // 压缩 css（非单纯最小化），移除相同类名、属性等
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

    // 检查是否跳过
    const checkIsSkip = () => {
        logger.warn(
            `The 'cssCodeSplit' option is set to true in the 'build' configuration of userConfig, which is not supported by this plugin, so it is skipped.`,
        );
        if (buildConfig?.cssCodeSplit === false) {
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
            order: 'post',
            handler: function (html, ctx) {
                if (isSkip) {
                    return html;
                }

                // 参考 Vite4 源码 packages\vite\src\node\plugins\html.ts getCssTagsForChunk 方法拿到 css 外链文件名
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

            // 已处理过的 emitted 文件列表
            const emittedFileList: string[] = [];

            let bundleKeys = Object.keys(bundle);

            for (let i = 0; i < bundleKeys.length; i++) {
                const key = bundleKeys[i];
                const chunk = bundle[key];
                if (chunk.type === 'asset' && chunk.fileName.endsWith('.css')) {
                    /**
                     * 存储 css 映射表，由于设置了 build.cssCodeSplit 为 true，
                     * 目前 fileName 跟入口 chunk.viteMetadata.importedCss 内部的 id 是匹配的。
                     * 参考 node_modules\vite\dist\node\chunks\dep-51c4f80a.js L43554 chunk.viteMetadata.importedCss.add
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
                    // 从 viteMetadata 中拿到 importedCss 设置，并根据 id 拿到对应的 css 内容注入到 js 内部
                    const importedCss = Array.from(chunk.viteMetadata.importedCss);
                    for (let cssId of importedCss) {
                        let cssCode = cssSourceMap.get(cssId);
                        if (!cssCode) {
                            continue;
                        }
                        cssCode = compressCss(chunk, cssCode);
                        // 若匹配上不能直接写入 js 文件，而是应该手动创建一个 css 文件，这样 html 文件内部的 css 外链才能正常访问
                        if (cssTags.has(cssId)) {
                            if (!emittedFileList.includes(cssId)) {
                                emittedFileList.push(cssId);
                                this.emitFile({ type: 'asset', fileName: cssId, source: cssCode });
                            }
                        } else {
                            const initialCode = chunk.code;
                            chunk.code =
                                `(function(){ try {var elementStyle = document.createElement('style'); elementStyle.appendChild(document.createTextNode(` +
                                `${JSON.stringify(cssCode.trim())}` +
                                `));document.head.appendChild(elementStyle);} catch(e) {console.error('style-injected-by-js', e);} })(); ` +
                                `${initialCode}`;
                        }
                    }

                    // 清除 importedCss 依赖项，这么做是为了防止 modulePreload 为 true 时，模块会在运行时将 css 以外链形式插入 html 从而导致文件无法找到
                    chunk.viteMetadata.importedCss.clear();
                }
            }
            cssSourceMap.clear();
        },
    };
}
