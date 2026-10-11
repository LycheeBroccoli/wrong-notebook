#!/usr/bin/env python
# query_geogebra.py — 固定入口：按错题 id 查询/修改 ErrorItem.geogebraCommands
#
# 设计目的：消除每次"给 id → 找 schema → 找 db → 现写 sqlite 查询"的四步折腾。
# 关键约束：
#   1. db 路径按"脚本文件位置"解析，绝不依赖 cwd（Prisma 的 file:./dev.db 按
#      schema.prisma 目录解析，而 sqlite3.connect 按 cwd 解析——两套规则不同，
#      这是历史踩坑根因，见 memory [[prisma-sqlite-path-resolution]]）。
#   2. 读写格式与 app 写入路径完全一致：JSON 数组 of 字符串
#      （src/app/api/error-items/[id]/geogebra/route.ts 用 JSON.stringify(result.commands)）。
#   3. 写入前自动备份旧值，写后回读校验，绝不静默破坏数据。

import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone

# Windows 控制台默认 GBK，会把中文题面打成乱码；强制 UTF-8 输出。
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass


def find_dev_db(start_file: str) -> str:
    """从脚本文件位置向上找 prisma/dev.db，绝不依赖 cwd。"""
    d = os.path.dirname(os.path.abspath(start_file))
    for _ in range(10):
        cand = os.path.join(d, "prisma", "dev.db")
        if os.path.isfile(cand):
            return cand
        parent = os.path.dirname(d)
        if parent == d:
            break
        d = parent
    raise FileNotFoundError(
        "找不到 prisma/dev.db（从脚本位置向上查 10 层未命中）。"
        "请确认在仓库内运行，或用 --db 指定绝对路径。"
    )


def connect(db_path: str) -> sqlite3.Connection:
    if not os.path.isfile(db_path):
        raise FileNotFoundError(f"数据库文件不存在: {db_path}")
    # SQLite 路径用正斜杠，避免 Windows 反斜杠转义问题
    uri = "file:" + db_path.replace("\\", "/") + "?mode=ro"
    con = sqlite3.connect(uri, uri=True)
    con.row_factory = sqlite3.Row
    return con


def parse_commands(raw: str | None):
    """自动识别 JSON 数组 vs 换行分隔，返回 (list[str], format_label)。"""
    if raw is None:
        return [], "null"
    s = raw.strip()
    if not s:
        return [], "empty"
    if s[0] == "[":
        try:
            arr = json.loads(s)
            if isinstance(arr, list):
                return [str(c) for c in arr], "json-array"
        except json.JSONDecodeError:
            pass
    return [ln.strip() for ln in s.splitlines() if ln.strip()], "newline"


def cmd_read(con, item_id, raw=False, as_json=False, field=None):
    if field:
        cur = con.execute(
            f"SELECT {field} AS v FROM ErrorItem WHERE id = ?", (item_id,)
        )
        row = cur.fetchone()
        if row is None:
            print(f"NOT FOUND: id={item_id}", file=sys.stderr)
            sys.exit(2)
        print(row["v"] if row["v"] is not None else "")
        return

    cur = con.execute(
        "SELECT id, questionText, geogebraCommands, updatedAt "
        "FROM ErrorItem WHERE id = ?",
        (item_id,),
    )
    row = cur.fetchone()
    if row is None:
        print(f"NOT FOUND: id={item_id}", file=sys.stderr)
        sys.exit(2)

    raw_val = row["geogebraCommands"]
    cmds, fmt = parse_commands(raw_val)

    if as_json:
        print(json.dumps(cmds, ensure_ascii=False, indent=2))
        return
    if raw:
        print(raw_val if raw_val is not None else "")
        return

    db_path = con.execute("PRAGMA database_list").fetchone()["file"]
    print(f"id        : {row['id']}")
    print(f"db        : {db_path}")
    print(f"format    : {fmt}")
    print(f"count     : {len(cmds)}")
    print(f"updatedAt : {fmt_updated_at(row['updatedAt'])}")
    q = (row["questionText"] or "").strip().replace("\n", " ")
    print(f"question  : {q[:80]}{'…' if len(q) > 80 else ''}")
    print("-" * 60)
    if not cmds:
        print("(geogebraCommands 为空)")
    for i, c in enumerate(cmds):
        print(f"{i:3d}: {c}")


def cmd_write(con, item_id, src_file, src_is_inline):
    """从文件或内联 JSON 读取命令数组，备份旧值后写入。"""
    if src_is_inline:
        new_cmds = json.loads(src_file)
    else:
        with open(src_file, "r", encoding="utf-8") as f:
            new_cmds = json.load(f)
    if not isinstance(new_cmds, list):
        raise ValueError("命令集必须是 JSON 数组（list of string）。")
    new_cmds = [str(c) for c in new_cmds]
    new_val = json.dumps(new_cmds, ensure_ascii=False)

    cur = con.execute(
        "SELECT geogebraCommands FROM ErrorItem WHERE id = ?", (item_id,)
    )
    row = cur.fetchone()
    if row is None:
        print(f"NOT FOUND: id={item_id}", file=sys.stderr)
        sys.exit(2)
    old_val = row["geogebraCommands"]

    # 备份旧值（即使为空也记一条，便于审计）
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    bak_dir = os.path.join(repo_root, "prisma")
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    bak_path = os.path.join(bak_dir, f"{item_id}.geogebra.bak.{ts}.json")
    with open(bak_path, "w", encoding="utf-8") as f:
        f.write(old_val if old_val is not None else "")
    print(f"backup    : {bak_path}")

    # Prisma SQLite 存 DateTime 为 epoch 毫秒整数（见 fmt_updated_at 注释）。
    # 早期版本误写成文本 "YYYY-MM-DD HH:MM:SS.000"，致 Prisma 读取时
    # P2023 "Conversion failed: input contains invalid characters"，
    # 且因 findMany 整集转换而连带拖垮整个错题列表。必须写整数毫秒。
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    con.execute(
        "UPDATE ErrorItem SET geogebraCommands = ?, updatedAt = ? WHERE id = ?",
        (new_val, now_ms, item_id),
    )
    con.commit()

    # 回读校验
    chk = con.execute(
        "SELECT geogebraCommands FROM ErrorItem WHERE id = ?", (item_id,)
    ).fetchone()
    chk_cmds, chk_fmt = parse_cmds_for_verify(chk["geogebraCommands"])
    ok = chk_cmds == new_cmds
    print(f"verify    : {'OK' if ok else 'MISMATCH!'} "
          f"(format={chk_fmt}, count={len(chk_cmds)})")
    if not ok:
        print("写入后回读与预期不一致，请检查备份恢复。", file=sys.stderr)
        sys.exit(3)


def parse_cmds_for_verify(raw):
    return parse_commands(raw)


def fmt_updated_at(val):
    """Prisma SQLite 存 DateTime 为 epoch 毫秒整数；转成可读 ISO。"""
    if val is None:
        return "(null)"
    try:
        n = int(val)
        return datetime.fromtimestamp(n / 1000, tz=timezone.utc).isoformat()
    except (ValueError, TypeError):
        return str(val)


def main():
    ap = argparse.ArgumentParser(
        prog="query-geogebra",
        description="按错题 id 查询/修改 GeoGebra 指令集（ErrorItem.geogebraCommands）",
    )
    ap.add_argument("id", help="ErrorItem id，如 cmszzcfw40003eha6auaxfo5o")
    ap.add_argument("--db", help="指定 dev.db 绝对路径（默认从脚本位置向上查找）")
    sub = ap.add_mutually_exclusive_group()
    sub.add_argument("--raw", action="store_true", help="只打印原始字符串")
    sub.add_argument("--json", action="store_true", help="打印解析后的 JSON 数组")
    sub.add_argument("--field", metavar="NAME", help="打印任意字段值")
    sub.add_argument(
        "--write",
        metavar="FILE|JSON",
        help="从 JSON 文件或内联 JSON 字符串写入新指令集（先备份）",
    )
    ap.add_argument(
        "--inline", action="store_true",
        help="--write 的值按内联 JSON 字符串解析，而非文件路径",
    )
    args = ap.parse_args()

    db_path = args.db or find_dev_db(__file__)
    # 读用只读连接；写需要可写连接
    if args.write:
        if os.path.isfile(db_path):
            uri = "file:" + db_path.replace("\\", "/")
            con = sqlite3.connect(uri, uri=True)
        else:
            con = sqlite3.connect(db_path)
        con.row_factory = sqlite3.Row
        cmd_write(con, args.id, args.write, args.inline)
    else:
        con = connect(db_path)
        cmd_read(con, args.id, raw=args.raw, as_json=args.json, field=args.field)
    con.close()


if __name__ == "__main__":
    main()
