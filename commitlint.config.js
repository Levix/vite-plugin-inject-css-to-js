/**
 * feat: 新功能
 * refactor: 更新某功能
 * fix: 修复bug
 * build: 基建相关: 配置修改，流水线，打包等等
 * docs: 仅文档新增/改动
 * style: 样式
 * test: 单测
 * ci: 流水线相关
 * chore: 发包
 * revert: 还原改动
 */
module.exports = {
    extends: ['@commitlint/config-conventional'],
    rules: {
        'type-enum': [
            2,
            'always',
            ['feat', 'refactor', 'fix', 'build', 'docs', 'style', 'test', 'ci', 'chore', 'revert'],
        ],
    },
};
