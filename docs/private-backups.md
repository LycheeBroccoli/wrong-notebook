# 私人错题库备份与恢复

代码使用 GitHub，私人错题、图片、用户账户、配置和 Git 归档使用独立备份。本地快照是明文私人文件，不能提交 GitHub 或直接分享。

## 创建和验证快照

首次整合及更新前先暂停本项目应用和编辑。每日 SQLite 快照通过备份接口读取一致性事务，也包含 WAL 中已提交的数据；备份时不要同时编辑运行配置。

```powershell
python scripts/backup_data.py backup --lb-repo E:\2026_wrong-notebook-LB
python scripts/backup_data.py verify E:\wrong-notebook-backups\<snapshot>
python scripts/backup_data.py restore E:\wrong-notebook-backups\<snapshot> --target E:\wrong-notebook-backups\restore-<date>
python scripts/test_backup_data.py
```

默认源数据库从 DATABASE_URL 解析，相对路径按 prisma/schema.prisma 所在目录解析。文件不存在或为空时失败，绝不自动创建空库。每份快照含数据库、表记录数与内容摘要、图片统计、私人配置、代码文件、Git bundle 和 SHA-256 清单。失败快照带 INCOMPLETE.txt，不用于恢复或上传。

restore 仅复制到新的隔离目录，拒绝现有目录和原仓库目录。恢复应用时，从 repositories/deploy/files 提取代码；将 database.sqlite 复制为隔离应用的 prisma/dev.db，使用独立端口及 NEXTAUTH_URL。配置中若原先使用绝对路径，必须改指向隔离副本。不得覆盖正式数据库。

## 加密并保存到百度网盘

在你自己的交互式 PowerShell 中运行：

```powershell
powershell -NoProfile -File scripts/encrypt-backup.ps1 -Snapshot E:\wrong-notebook-backups\<snapshot>
```

脚本使用本机 7-Zip，密码在 7-Zip 的隐藏提示中输入，不出现在命令行参数中。使用 AES-256 及文件名加密，并再次测试归档。将验证成功的 .7z 和 .sha256 上传个人百度网盘 /wrong-notebook-backups/。密码单独保管，不与归档一起保存。

首次上传后下载到另一个目录，比较 .sha256；解密到新目录，再运行 verify 和 restore，检查图片、解法、笔记及 GeoGebra 内容。上传成功不能替代下载恢复验证。完成后在自己的备份记录中登记时间、云端位置和下载验证结果。

## 每日任务与保留规则

第一次完整恢复验证通过后注册任务：

```powershell
powershell -NoProfile -File scripts/register-backup-task.ps1
```

任务每天 20:00 在当前 Windows 用户已登录时运行，错过时间后尽可能补跑。不保存账户密码，不上传云盘，不自动删除快照。离线或未登录期间不能保证每日执行，请检查任务 LastTaskResult 和最近快照。

至少保留最近 30 份日备份、12 份月备份和整合前永久基线。尚未验证或尚未异地保存的快照一律保留。当前不自动清理；超过保留量时，人工核对完整性及网盘下载验证记录后处理。每月至少下载验证一次。

## 回退

代码回退到已保存的整合前提交，重新构建并启动。此次不迁移正式数据库，通常无需恢复数据。确需恢复时先给当时的正式库做新快照，防止丢失整合后新增的错题。原 deploy 历史的完整 bundle 含私人凭据，只能在本地或加密归档中保管。

本地启用 pre-push，阻止 archive 分支和原 deploy 私人祖先被意外推送。新克隆默认不自动启用 Git hooks，可用 `powershell -NoProfile -File scripts/install-history-guard.ps1` 显式安装。安装副本位于 Git 元数据目录，切换到归档分支时仍然有效。该保护针对已识别的私人历史，不能替代新增代码的凭据检查。
