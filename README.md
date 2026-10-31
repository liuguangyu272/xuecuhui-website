# 学习小站 · 药学院学促会

现有服务器 http://123.206.117.192/ 的网站源码与[当前公开学习资料](resources/README.md)。GitHub 是代码来源，服务器每 60 秒拉取 `main`；拉取、语法检查和健康检查成功后上线。网络和部署耗时会增加延迟，这不是逐秒同步。

## 目录

- `web/`：首页、公告、活动、资料页面和静态资源。
- `services/console/`：题库内容台 Node 服务及药化页面源模板。
- `services/upload/`：公告数据与上传文件 Python 服务。
- `deploy/`：部署脚本和 systemd 单元。

在 GitHub 修改 `web/index.html`、`web/assets/style.css` 等文件并提交到 `main`，等待约一分钟后刷新网站。其他分支不会部署。网站继续在现有服务器运行，没有启用 GitHub Pages。

## 数据与口令

以下运行数据继续由服务器管理，不被代码更新覆盖；经筛选的当前公开副本位于 `resources/`，是本次导出的快照：

- `/opt/xuecuhui-upload/data/` 的公告、活动、部门等 JSON。
- 网站的 `assets/posters/`、`assets/docs/`、`assets/issue/` 上传文件。
- 药分、药剂的 `data_*.js` 和单文件导出版。
- 题库后台的 `content_data.js`、`_versions/` 和药化分子数据、图片。
- `yaohua/index.html` 是生成页；修改后台 `yaohua-src/index.html` 模板会结合服务器现有分子数据重新生成。

仓库不含 SSH 私钥、服务器管理口令或完整服务器状态；`resources/` 包含本次筛选的公开数据快照，单独克隆不能恢复完整服务器。迁移到另一台机器需要另外转移这些数据与 Python RDKit 环境。现有后台配置和登录方式沿用服务器。前端中的 `__SERVER_CONSOLE_TOKEN__` 在部署时从服务器的 systemd 环境填入；请勿在 GitHub 填写真实口令。当前应用的旧设计会将管理口令发到浏览器，这一机制本次没有重构；建议后续改为服务端会话认证。

## 运维

部署行为的隔离测试：在 Linux 上运行 `python3 deploy/test_sync.py`，验证正常上线、数据保护、失败回滚与语法错误拦截。测试使用临时目录，不修改真实网站。

服务器使用该仓库专用的只读 Deploy Key，私钥留在 `/root/.ssh/xuecuhui_github_deploy`。部署不依赖本机电脑或 GitHub Actions。

```sh
systemctl status xuecuhui-sync.timer
journalctl -u xuecuhui-sync.service -n 40 --no-pager
systemctl start xuecuhui-sync.service  # 立即检查一次
systemctl disable --now xuecuhui-sync.timer  # 暂停自动更新
```

访问 `/deployment-status.json` 查看已部署提交和 UTC 时间。内部状态在 `/var/lib/xuecuhui-deploy/deployed.json`，每次变更的代码备份在同目录 `backups/`；安装前的完整备份另存服务器 `/root/backup/`。健康检查失败自动还原本次代码更新。恢复某次历史版本：在 GitHub revert 对应代码提交，提交到 `main` 后自动部署。数据备份独立于此部署，不会因 Git revert 恢复。

部署程序和 systemd 单元安装在仓库目录之外，避免运行中自行覆盖。修改 `deploy/` 后需管理员手动安装到 `/usr/local/libexec/xuecuhui-sync.py` 与 `/etc/systemd/system/`，执行 `systemctl daemon-reload`。部署代码以 root 执行，仅向可信人员开放仓库写权限。

参考：[GitHub Deploy Keys](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys)、[systemd timers](https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html)。
