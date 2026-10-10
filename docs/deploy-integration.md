# deploy 开发基线接入记录

主开发目录继续使用 deploy，GitHub 仓库保持 LycheeBroccoli/wrong-notebook。LB 目录保留历史归档，不再复制源码覆盖 deploy。群晖部署不属于此次整合范围。

## 历史保存方式

整合分支从 origin/main 建立，采用经过审核的 deploy 文件快照，再以 ours 策略连接 LB 开发分支。GeoGebra 实现和配套测试整体保留 deploy 版本。保史合并前后代码树相同。

deploy 原始提交历史中的可选探测脚本曾含硬编码运行凭据。因此原始 deploy 历史仅保存在本地归档分支和私人备份中，不进入待推送祖先。新快照中的脚本从环境变量读取凭据。本次不重写或删除原本地历史。

LB 独有的 build.yml 缩进异常，功能与已有手动镜像流程重叠，未机械移植。保留 deploy 的 CI 和发布流程，CI 增加合成 SQLite 备份回归；不新增自动部署，不发布版本标签。

## LB 未推送提交核对

| 提交 | 内容及处理 |
| --- | --- |
| 454a7c1 | 点标签、坐标轴与刻度兜底；deploy 已包含，保留其完整实现 |
| 9a699f3 | setCoords 路由；deploy 已包含数值 API 路径和表达式 DSL 路径 |
| cfb980b | GeoGebra 后处理、提示词与路由；采用 deploy 功能超集，未按提交说明假设所有兜底已存在 |
| 073f570 | 笔记 Markdown；deploy 已包含 |
| 690994b | 证明环境与 QED；deploy 已包含，并保留数学块保护修复 |
| fca8e5d | 数学分隔符兼容；deploy 已包含 |
| 4bec8b4 | EnvHttpProxyAgent 与 NO_PROXY；deploy 对应实现相同 |

其余共享差异是 deploy 的教学提示词、答案与解析加粗显示、未引用脚注恢复、GeoGebra 比较运算符兼容及本地启动配置。独有诊断脚本纳入源码前检查凭据，临时源码备份与本地镜像保持本地保存。

## 验证结果

- 全部 Vitest：36 个文件，634 个用例通过。
- Python 备份回归：3 项通过，覆盖 WAL、隔离恢复、防覆盖和篡改检测。
- TypeScript 检查与隔离生产构建通过。
- 现有 E2E：3 项通过；使用合成数据库、独立端口、独立 Chrome 测试会话。
- lint：整合前后均为 147 个错误、92 个警告，规范化目录路径后无新增问题；lint 未达到全绿。

种子测试补齐 Vitest 导入和回调类型；临时 worktree 从 TypeScript 收集范围排除。Playwright 支持独立端口、禁止复用服务及选择已安装浏览器渠道。正式数据库、配置和证书未用于自动测试。

## 审核与回退

远程提交止于草稿 PR，不自动合并 main 或切换运行构建。合并必须保留祖先历史，不使用 squash/rebase。代码回退使用本地 archive/deploy-before-integration；运行数据另行恢复前先制作新的快照。

私人备份、加密、下载恢复验证和每日任务见 [私人数据备份说明](private-backups.md)。原始历史 bundle 也需要加密保存，不能直接上传公开仓库。
