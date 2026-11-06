# 宣传资料与活动报名

## 宣传资料

新生刊和活动海报上传支持 PNG、JPEG、GIF、WebP 图片，以及 PDF、Word、PowerPoint、Excel、ZIP/RAR/7Z、TXT 和 Markdown，单文件最大 50MB。后台选择文件后保存对应内容即可生效，沿用现有 GitHub 内容版本同步。

图片按原方式预览；PDF 在活动详情页提供内嵌阅读和单独打开入口，其余文件显示下载链接。新生刊的页脚阅读入口同样支持上述文件。新文件使用独立文件名，发布前不会覆盖旧内容。HTML、脚本和 SVG 不作为上传格式开放。

## 报名表配置

进入内容台 → 活动 → 编辑，可设置开放报名、截止时间、人数上限（0 为不限）和报名字段。字段一行一项，例如：

```text
姓名 | text | 必填
学号 | text | 必填
班级 | text | 必填
邮箱 | email | 选填
场次 | select | 必填 | 上午,下午
备注 | textarea | 选填
```

类型对应：text 为单行文本，tel 为电话，email 为邮箱，number 为数字，textarea 为多行文本，select 为单选下拉框。学号应使用 text，保留前导零。管理员可增减字段；已有记录保留填写时的字段信息，导出时列出历史字段。人数上限和截止时间在服务器校验。

## 名单与 Excel

活动列表的“报名名单 / Excel”按钮进入受网页登录保护的管理页，使用原题库内容台的网页登录账号密码。名单接口另使用服务器内部密钥鉴权，公开网站的旧 CMS 口令不能读取名单。

“导出名单 / 下载字段模板”下载真正的 `.xlsx` 工作簿；没有记录时可作为当前表单字段模板。导入需要 `.xlsx`，最大 5MB、5000 行。首行为字段名称，必填字段对应的列必须存在。系统校验整批数据，任何一行无效均不写入；按学号或相同导入答案去重。公式需要先转换为纯文本，导出文本也不会作为 Excel 公式执行。

## 数据边界与部署

报名记录位于 `/var/lib/xuecuhui-registrations/records.sqlite3`，只保留在服务器，不加入公开内容 JSON、GitHub 或网站静态资源。公开接口只允许提交，不能查询名单。字段配置属于活动公开信息，随 CMS 内容正常同步 GitHub。

Python 服务需要 `services/upload/requirements.txt` 中的 openpyxl。在服务端为内容服务和题库服务共同设置 `REGISTRATION_ADMIN_SECRET`，不得将它放入网页或仓库。现有部署机已写入 root 专用的 `/etc/xuecuhui/cms-sync.env`，由两个服务的 systemd drop-in 加载。
