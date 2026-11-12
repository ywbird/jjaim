"""Command-line entry point for glyph-inspect."""

from __future__ import annotations

import argparse
import signal
import sys
from pathlib import Path

from .commands import (
    group_entries,
    list_entries,
    render_groups_text,
    render_list_text,
    run_sheet,
    run_text,
    write_payload,
)
from .decl import parse_file
from .errors import CliError, DeclError, ResourceError, UsageError


def _positive_int(value: str) -> int:
    try:
        number = int(value)
    except ValueError:
        raise argparse.ArgumentTypeError(f"양의 정수가 아닙니다: {value!r}") from None
    if number <= 0:
        raise argparse.ArgumentTypeError(f"양의 정수가 아닙니다: {value!r}")
    return number


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="glyph-inspect",
        description=(
            "선언형 글리프 대응을 조사하고 실제 텍스처 조합을 PNG로 검증합니다. "
            "TTF를 만들거나 렌더링하지 않습니다."
        ),
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    list_parser = subparsers.add_parser(
        "list", help="생성되는 유니코드 코드 포인트 목록"
    )
    list_parser.add_argument("decl", metavar="<decl.json>", help="선언 JSON 파일")
    _add_report_options(list_parser)

    groups_parser = subparsers.add_parser(
        "groups", help="코드 포인트마다 참여하는 그룹 목록"
    )
    groups_parser.add_argument("decl", metavar="<decl.json>", help="선언 JSON 파일")
    _add_report_options(groups_parser)
    groups_parser.add_argument(
        "--parts",
        action="store_true",
        help="JSON 결과에 텍스처 원본 글리프의 배치 발생 건별 parts를 추가",
    )

    sheet_parser = subparsers.add_parser(
        "sheet", help="매핑된 글리프 전체를 격자 PNG로 렌더링"
    )
    sheet_parser.add_argument("decl", metavar="<decl.json>", help="선언 JSON 파일")
    sheet_parser.add_argument(
        "--output", required=True, help="PNG 파일 경로 (페이지 모드에서는 디렉터리)"
    )
    sheet_parser.add_argument(
        "--columns", type=_positive_int, default=64, help="한 줄의 최대 슬롯 수 (기본 64)"
    )
    sheet_parser.add_argument(
        "--scale", type=_positive_int, default=2, help="최근접 이웃 정수 배율 (기본 2)"
    )
    sheet_parser.add_argument(
        "--border", action="store_true", help="글리프 이미지 경계에 1픽셀 테두리"
    )
    sheet_parser.add_argument(
        "--box-kind",
        choices=("cell", "ink"),
        default="cell",
        help="테두리 기준: cell은 그룹 size, ink는 실제 알파 경계 (기본 cell)",
    )
    _add_background_option(sheet_parser)
    sheet_parser.add_argument(
        "--per-page", type=_positive_int, default=None, metavar="N", help="페이지당 글리프 수"
    )

    text_parser = subparsers.add_parser(
        "text", help="예시 문자열을 조합해 PNG로 렌더링"
    )
    text_parser.add_argument("decl", metavar="<decl.json>", help="선언 JSON 파일")
    text_source = text_parser.add_mutually_exclusive_group(required=True)
    text_source.add_argument("--text", metavar="STRING", help="렌더링할 문자열")
    text_source.add_argument(
        "--text-file", metavar="PATH", help="UTF-8 텍스트 파일 ('-'는 표준 입력)"
    )
    text_parser.add_argument("--output", required=True, help="출력 PNG 경로")
    text_parser.add_argument(
        "--scale", type=_positive_int, default=2, help="최근접 이웃 정수 배율 (기본 2)"
    )
    _add_background_option(text_parser)

    return parser


def _add_report_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--format",
        choices=("text", "json"),
        default="text",
        help="출력 형식 (기본 text)",
    )
    parser.add_argument("--output", metavar="PATH", help="표준 출력 대신 기록할 파일")


def _add_background_option(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--background",
        choices=("white", "transparent"),
        default="white",
        help="미리보기 배경 (기본 white)",
    )


def _read_text(args: argparse.Namespace) -> str:
    if args.text is not None:
        return args.text
    if args.text_file == "-":
        data = sys.stdin.buffer.read()
    else:
        path = Path(args.text_file)
        try:
            data = path.read_bytes()
        except OSError as exc:
            raise ResourceError(
                f"텍스트 파일을 읽을 수 없습니다: {path} ({exc.strerror})"
            ) from None
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        raise UsageError("텍스트 입력이 올바른 UTF-8이 아닙니다") from None


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "list":
            declaration = parse_file(args.decl)
            entries = list_entries(declaration)
            if args.format == "json":
                from .commands import _json_text

                payload = _json_text(entries) + "\n"
            else:
                payload = render_list_text(entries)
            write_payload(payload, args.output)
        elif args.command == "groups":
            if args.parts and args.format != "json":
                raise UsageError("--parts는 --format json과 함께만 사용할 수 있습니다")
            declaration = parse_file(args.decl)
            entries = group_entries(declaration, args.parts)
            if args.format == "json":
                from .commands import _json_text

                payload = _json_text(entries) + "\n"
            else:
                payload = render_groups_text(entries)
            write_payload(payload, args.output)
        elif args.command == "sheet":
            declaration = parse_file(args.decl)
            run_sheet(
                declaration,
                output=args.output,
                columns=args.columns,
                scale=args.scale,
                border=args.border,
                box_kind=args.box_kind,
                background=args.background,
                per_page=args.per_page,
            )
        elif args.command == "text":
            declaration = parse_file(args.decl)
            run_text(
                declaration,
                text=_read_text(args),
                output=args.output,
                scale=args.scale,
                background=args.background,
            )
        else:  # pragma: no cover - argparse enforces the command
            raise UsageError(f"알 수 없는 명령입니다: {args.command}")
    except CliError as exc:
        print(f"glyph-inspect: error: {exc}", file=sys.stderr)
        return exc.code
    return 0


def entry() -> None:
    # A closed pipe (e.g. `| head`) is normal for a report command.
    if hasattr(signal, "SIGPIPE"):
        signal.signal(signal.SIGPIPE, signal.SIG_DFL)
    sys.exit(main())


if __name__ == "__main__":  # pragma: no cover
    entry()
