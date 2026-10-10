---
name: query-geogebra
description: 查询或修改某道错题在 dev.db 里 AI 生成的 GeoGebra 指令集（ErrorItem.geogebraCommands）。只要用户给出一个错题 id（cuid 形如 cms...）并要求查看、检查、修复、改、调整、调试该题的 GeoGebra 指令/命令/动态图/演示，就必须用本技能。即使用户只说"看看这道题的 geogebra""改一下 cmsxxx 的图""这条指令有问题"，也应触发。本技能提供一个固定脚本入口，替代每次手动找 schema、找 db、现写 sqlite 查询的折腾流程。
---

# query-geogebra

按错题 id 读取/修改 `ErrorItem.geogebraCommands`（AI 生成的 GeoGebra 指令 JSON 数组）的固定入口。

## 为什么存在这个技能

历史上，每次用户给一个错题 id 要看 GeoGebra 指令，都要重走四步、还经常踩坑，根因是：

1. **没有固定入口** —— 每次都得 Glob 找 `schema.prisma` → 确认字段名 → 查 `.env` 确认 db 路径 → 现写 `python sqlite3` 查询。这四步每次重复，却没有固化。
2. **字段名不直观、存储格式不统一** —— 字段叫 `geogebraCommands`（不是 `geogebra_commands`，也不是独立 JSON 字段），schema 注释还写着 `"JSON or newline-separated"`，解析前得先看首字符是不是 `[` 才知道走 `json.loads` 还是 `splitlines`。
3. **db 路径解析的坑** —— `DATABASE_URL=file:./dev.db`，Prisma 按 **schema.prisma 所在目录**解析，而 `sqlite3.connect` 按 **cwd** 解析，两套规则不同（见 memory `prisma-sqlite-path-resolution`）。直接拿相对路径连库，cwd 不对时会静默建空库或报"table does not exist"，误导归因。
4. **shell cwd 污染** —— Bash 工具的 cwd 在调用间持久。一旦在某个命令里 `cd prisma`，后续所有相对路径全被带偏，要连试几次才发现。

本技能用一个脚本把这四层坑一次性消除：脚本**按自身文件位置**找 `prisma/dev.db`（不依赖 cwd）、自动判断格式、读写格式与 app 写入路径一致、写入前自动备份且回读校验。

## 核心规则

**拿到 id 后，第一步永远是跑脚本读取，而不是手动翻 schema 或现写 sqlite。** 这条规则的价值在于：它把"找数据"从几分钟的探索压缩成一秒的命令，并且绝不会因为 cwd、路径解析、格式判断而跑偏。即使用户只是随口问"看看这道题的图"，也先跑脚本拿到真实指令集再说话——基于猜测讨论指令等于在沙子上盖楼。

脚本路径：`scripts/query_geogebra.py`

## 用法

### 读取（默认：带表头的可读列表）

```bash
python scripts/query_geogebra.py <id>
```

输出：id、db 路径、格式（json-array / newline）、命令数、updatedAt、题面前 80 字，然后是编号命令列表。

### 机器可读（给后续处理用）

```bash
python scripts/query_geogebra.py <id> --json      # 解析后的 JSON 数组
python scripts/query_geogebra.py <id> --raw       # 原始存储字符串
python scripts/query_geogebra.py <id> --field questionText   # 任意字段
```

### 修改指令集（写回数据库）

```bash
# 从 JSON 文件写入（文件内容是字符串数组）
python scripts/query_geogebra.py <id> --write path/to/new_commands.json

# 从内联 JSON 字符串写入
python scripts/query_geogebra.py <id> --write '["A=(0,0)","B=(1,1)"]' --inline
```

写入流程：先把旧值备份到 `prisma/<id>.geogebra.bak.<timestamp>.json`，再写入，最后**回读校验**（`verify: OK`）。回读与预期不一致会非零退出。备份是为了让任何误改都能一键还原。

写入格式与 app 的写入路径完全一致（`JSON.stringify(commands)` → 这里是 `json.dumps(cmds, ensure_ascii=False)`），所以脚本写入的值 app 能原样读出，往返一致。

## 标准工作流（修改某题 GeoGebra 指令时）

1. **取 id** —— 从用户消息里提取错题 id（cuid，`cms` 开头 25 字符）。
2. **读** —— `python scripts/query_geogebra.py <id>`，拿到当前指令集和题面。
3. **理解题意** —— 读题面 + 现有指令，定位要改的点。GeoGebra 命令的事实约束见 memory：`geogebra-command-facts-verified`、`geogebra-ggb-xml-vs-dsl`、`geogebra-rigid-transform-coords-only` 等。
4. **提出修改** —— 在对话里说清要改哪几条、为什么。涉及构造方法的坑（setCoords 表达式、Intersect 多交点花括号、Polygon 静默失败等）先查对应 memory。
5. **确认** —— 涉及数据库写入，先和用户确认再写（除非用户已明确授权"直接改"）。
6. **写** —— 把改后的完整指令数组存成 JSON 文件（建议放 `tmp/`），`--write` 写入，确认 `verify: OK`。
7. **再读核验** —— 再跑一次无参数读取，确认改动落地、命令数符合预期。

## 边界与注意

- **cwd 无关**：脚本按自身位置找 db，从哪个目录跑都行。但你自己写 bash 时别用 `cd` 污染 cwd——Bash 工具的 cwd 跨调用持久，一次 `cd` 会带偏后续所有相对路径。需要切目录时用绝对路径或子 shell `( ... )`。
- **Windows + Git Bash 路径**：`/tmp/...` 这类 Unix 路径在 bash 里能写，但原生 Windows 的 Python 读不到（bash 把 `/tmp` 映射到 Windows 临时目录，Python 不认）。临时文件用仓库内相对路径如 `tmp/...`。
- **中文乱码**：脚本已强制 UTF-8 输出。若仍见乱码，是终端编码问题，不是数据问题——存储的字符串本身是正确 Unicode。
- **只读 vs 可写**：读取用只读连接（`mode=ro`），写入才开可写连接。误开只读库写入会直接报错而非静默失败。
- **不要手写 sqlite 查这个字段**：字段名、格式判断、路径解析三层坑都在脚本里兜底了，手写等于重新踩一遍。
