#!/usr/bin/env python3

import json
import os
import re
import shlex
import sys


SHELL_WRAPPERS = {"bash", "sh", "zsh"}
SHELL_EXEC_FLAGS = {"-c", "-lc", "-ic", "-ec", "-lec", "-xc", "-exc"}
PREFIX_WRAPPERS = {"command", "builtin", "nohup"}


def is_env_assignment(token: str) -> bool:
    return bool(re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*=.*", token))


def parse_command(command: str) -> list[str]:
    try:
        return shlex.split(command, posix=True)
    except ValueError:
        return []


def strip_wrappers(tokens: list[str]) -> list[str]:
    current = tokens
    while current:
        while current and is_env_assignment(current[0]):
            current = current[1:]

        if not current:
            return current

        head = current[0]
        if head == "sudo":
            index = 1
            while index < len(current) and current[index].startswith("-"):
                index += 1
            current = current[index:]
            continue

        if head == "env":
            index = 1
            while index < len(current) and (
                current[index].startswith("-") or is_env_assignment(current[index])
            ):
                index += 1
            current = current[index:]
            continue

        if head in PREFIX_WRAPPERS:
            current = current[1:]
            continue

        if head in SHELL_WRAPPERS and len(current) >= 3 and current[1] in SHELL_EXEC_FLAGS:
            current = parse_command(current[2])
            continue

        return current

    return current


def has_short_flag(option: str, flag: str) -> bool:
    if not option.startswith("-") or option.startswith("--"):
        return False
    return flag in option[1:]


def rm_is_recursive_force(tokens: list[str]) -> bool:
    recursive = False
    force = False

    for token in tokens[1:]:
        if token == "--":
            break
        if not token.startswith("-"):
            break
        if token == "--recursive":
            recursive = True
            continue
        if token == "--force":
            force = True
            continue
        if has_short_flag(token, "r") or has_short_flag(token, "R"):
            recursive = True
        if has_short_flag(token, "f"):
            force = True

    return recursive and force


def git_clean_is_forceful(tokens: list[str]) -> bool:
    force = False
    dirs = False

    for token in tokens[2:]:
        if token == "--":
            break
        if not token.startswith("-"):
            break
        if has_short_flag(token, "f"):
            force = True
        if has_short_flag(token, "d"):
            dirs = True

    return force and dirs


def find_delete(tokens: list[str]) -> bool:
    return any(token == "-delete" for token in tokens[1:])


def git_push_force(tokens: list[str]) -> bool:
    if len(tokens) < 2 or tokens[0] != "git" or tokens[1] != "push":
        return False
    return "--force" in tokens[2:] or "-f" in tokens[2:]


def aws_dsql_delete_cluster(tokens: list[str]) -> bool:
    # Matches: aws dsql delete-cluster ...
    return (
        len(tokens) >= 3
        and tokens[0] == "aws"
        and tokens[1] == "dsql"
        and tokens[2] == "delete-cluster"
    )


def sql_drop_statement(command: str) -> bool:
    pattern = re.compile(
        r"\bDROP\s+(TABLE|DATABASE|SCHEMA)\b", re.IGNORECASE
    )
    return bool(pattern.search(command))


def blocked_reason(command: str) -> str | None:
    tokens = strip_wrappers(parse_command(command))
    if not tokens:
        return None

    if tokens[0] == "rm" and rm_is_recursive_force(tokens):
        return "Blocked destructive command pattern `rm -rf`."

    if len(tokens) >= 2 and tokens[0] == "terraform" and tokens[1] == "destroy":
        return "Blocked destructive command pattern `terraform destroy`."

    if len(tokens) >= 3 and tokens[0] == "git" and tokens[1] == "reset" and "--hard" in tokens[2:]:
        return "Blocked destructive command pattern `git reset --hard`."

    if len(tokens) >= 2 and tokens[0] == "git" and tokens[1] == "clean" and git_clean_is_forceful(tokens):
        return "Blocked destructive command pattern `git clean -fd`."

    if tokens[0] == "find" and find_delete(tokens):
        return "Blocked destructive command pattern `find ... -delete`."

    if git_push_force(tokens):
        return "Blocked destructive command pattern `git push --force`."

    if aws_dsql_delete_cluster(tokens):
        return "Blocked destructive command pattern `aws dsql delete-cluster`."

    if sql_drop_statement(command):
        return "Blocked destructive SQL pattern `DROP TABLE/DATABASE/SCHEMA`."

    return None


def main() -> int:
    command = os.environ.get("CLAUDE_HOOK_COMMAND", "")
    reason = blocked_reason(command)
    if not reason:
        return 0

    json.dump(
        {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": (
                    f"{reason} Run it manually outside Claude Code if you really intend to perform this operation."
                ),
            }
        },
        sys.stdout,
    )
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
