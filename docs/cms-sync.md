# CMS 内容保存与 GitHub 自动版本记录

## 保存流程

现有 CMS 页面、编辑功能和 JSON 数据结构继续使用。管理员发布后，Python 内容服务在本机保存内容并生成一份不可变快照；文章、图片、附件及题库的公开数据写入持久化队列。独立 worker 通过 GitHub Git Data API 创建 blob、tree 和 commit，再以 `force: false` 更新 `main`，同一次快照中的所有文件一起生效。

运行内容继续保存在服务器 JSON 与题库文件中；SQLite 仅用于同步队列和版本基线。前台读取最新运行数据，打开的公开页面每 5 秒检查内容变化，后台编辑页不参与轮询，避免覆盖草稿。数据发布无需等待 GitHub 网络请求完成，GitHub 失败不会阻断已排队内容的前台展示。

网站内容台的 `POST /api/data` 和题库内容台的发布、回滚都会触发快照。worker 每 15 秒执行恢复扫描，补获本机保存完成但进程意外退出时尚未入队的变化。重复快照不生成重复提交。上传操作先写文件，待发布的 JSON 引用它时再同步；删除文章或移除图片引用后，下一次快照会从 GitHub 移除对应附件。服务器保留未引用的旧文件，便于恢复。

## 存储与部署边界

- `resources/content.json`：当前公告、活动、部门、资料目录和站点设置。
- `resources/assets/`：当前 JSON 引用的图片与资料。
- `resources/question-banks/`：药分、药剂与药化数据。
- `resources/editor/`：内容台导出数据、药化编辑数据及引用的图片。
- `resources/cms-manifest.json`：当前同步快照的文件大小与 SHA-256。

原 `resources/manifest.json` 记录的是首次人工导出的资料快照；自动同步后请以 `cms-manifest.json` 为准。

`main` 更新后，原有 `xuecuhui-sync.timer` 继续每 60 秒检查代码部署。内容已在保存时对前台生效，部署器仍保护运行数据，不会把 GitHub 的内容副本回灌并覆盖 CMS。来自 GitHub 的网页代码修改照常部署；直接在 GitHub 改 `resources/` 不会替代后台数据，这种操作与后续 CMS 修改同一文件时会产生同步冲突。

## 并发与故障

`GET /api/data` 返回附加的 `revision`，前端保存时通过 `If-Match` 提交该值。服务器在同一把锁内检查版本并保存；旧版本返回 HTTP 409，保留原有服务器内容及当前浏览器草稿。CMS 发布时若无法持久化快照，恢复发布前的内容并返回失败。

队列、不可变文件对象及每次同步结果保存于 `/var/lib/xuecuhui-cms-sync/`。网络故障、凭据失效、限流等错误留在队列，之后自动重试；服务重启不会丢失任务。分支前进但涉及不同文件时会重试提交；同一文件的远端内容偏离已知基线时，将任务标记为 `conflict` 并停止其后任务，不强制覆盖任何一方。管理员可查询 `GET /api/sync-status`，请求需要现有 CMS 管理口令；返回不含 GitHub Token。

```sh
systemctl status xuecuhui-cms-sync
journalctl -u xuecuhui-cms-sync -n 40 --no-pager
python3 /opt/xuecuhui-upload/cms_sync.py status
```

出现内容冲突时，先核对冲突文件和本机队列快照。如果管理员明确选择以本机排队内容继续发布，可执行以下操作；远端旧内容仍保留在 Git 历史中：

```sh
systemctl stop xuecuhui-cms-sync
python3 /opt/xuecuhui-upload/cms_sync.py resolve --accept-local
systemctl start xuecuhui-cms-sync
```

如果选择远端内容，请先将它与本机编辑内容合并，保留队列文件再处理，不要删除队列或数据库来消除冲突。

## 服务端凭据

GitHub Token 位于 `/etc/xuecuhui/github-token`，仅 root 可读（0600），不进入仓库、网页、接口响应或日志。当前配置使用部署时本机已登录 GitHub 账户的凭据；后续可替换为仅此仓库 `Contents: read/write` 的专用细粒度 Token。模块每次 API 请求重新读凭据文件，替换凭据后可自动重试。

`/etc/xuecuhui/cms-sync.env` 仅包含启用开关、仓库名、分支名和凭据文件路径；两个 CMS 服务通过 systemd drop-in 加载它。独立同步服务使用 `deploy/xuecuhui-cms-sync.service`，首次运行需先执行 `cms_sync.py initialize`，明确以当时线上内容为第一次导出的来源。

测试：Linux 上运行 `cd services/upload && python3 -m unittest -v test_cms_sync`；前端行为测试运行 `node deploy/test_cms_frontend.cjs`。前者覆盖增改删、持久化重试、同文件冲突、分支竞争、独立发布版本、HTTP 版本检查及快照失败回滚；后者覆盖前台刷新和后台草稿保护。
