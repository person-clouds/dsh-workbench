# 发布到 DSH 插件市场

> 包名：`dsh-workbench`（`0.2.0`，破坏性改名，不兼容旧包名）  
> 公开仓库：<https://github.com/person-clouds/dsh-workbench>  
> 市场条目：`market/person-clouds__dsh-workbench.yml`

## 一、构建并验证安装包

```bash
cd /home/zh/www/personalCloud/task/dsh-workbench
npm_config_cache=/tmp/npm-cache npm pack --pack-destination release
# 产物：release/dsh-workbench-0.2.0.tgz
```

GitHub Release 资源名保持无版本号：`dsh-workbench.tgz`。

## 二、发布 npm

```bash
npm login --registry=https://registry.npmjs.org
npm publish --registry=https://registry.npmjs.org --access public
```

安装：

```bash
dsh plugin --profile web add dsh-workbench
```

## 三、提交市场条目

把 `market/person-clouds__dsh-workbench.yml` 放到 awesome-dsh-plugin 的
`data/plugins/person-clouds__dsh-workbench.yml` 并提交 PR。条目要求：

1. 公开 GitHub 仓库，`package.json` 声明 `dsh.bundle`；
2. 仓库创建满 1 天；
3. 仓库添加 topic：`dsh-plugin`；
4. 推荐发布 npm 包或 GitHub Release tarball。

提交 PR 后由市场维护者审核，合并后 dsh-market / Plugin Discover 自动收录。
