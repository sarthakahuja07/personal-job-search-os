"""A tiny field-mapping language, so a new source is configuration rather than code.

Most careers sites that are not on a known ATS still expose their jobs as JSON somewhere -- via
a search endpoint, or embedded in the page as hydration state. What differs between them is not
the mechanism, it is where the fields sit. Encoding that difference as data means adding such a
company is a config row, exactly as it is for Greenhouse or Workday (PRD §97).

Four forms, deliberately no more. Anything needing more than these is a real adapter, not a
configuration, and pretending otherwise produces a config language nobody can read:

    "title"                                     dot path
    {"path": "a.b", "default": "x"}             dot path with a fallback
    {"template": "https://x.com{job_path}"}     interpolate {dot.paths} into a string
    {"path": "office", "pluck": "name",         collapse a list of objects into a string
     "join": ", "}
"""

from __future__ import annotations

import re
from typing import Any

_TEMPLATE_TOKEN = re.compile(r"\{([A-Za-z0-9_.]+)\}")


class FieldMapError(ValueError):
    """A mapping refers to something the payload does not contain."""


def resolve_path(data: Any, path: str) -> Any:
    """Walk a dotted path. Returns None rather than raising -- a missing optional field is
    ordinary, and the required-field check belongs at the NormalizedJob boundary."""
    current: Any = data
    for part in path.split("."):
        if current is None:
            return None
        if isinstance(current, dict):
            current = current.get(part)
        elif isinstance(current, list):
            try:
                current = current[int(part)]
            except (ValueError, IndexError):
                return None
        else:
            return None
    return current


def apply_spec(data: Any, spec: Any) -> Any:
    """Resolve one field spec against a record."""
    if spec is None:
        return None

    if isinstance(spec, str):
        return resolve_path(data, spec)

    if not isinstance(spec, dict):
        raise FieldMapError(f"field spec must be a string or object, got {type(spec).__name__}")

    if "template" in spec:
        template = spec["template"]

        def substitute(match: re.Match[str]) -> str:
            value = resolve_path(data, match.group(1))
            return "" if value is None else str(value)

        rendered = _TEMPLATE_TOKEN.sub(substitute, template)
        # A template that resolved to nothing is worse than absent: it produces a URL like
        # "https://x.com" that looks valid and points at the wrong place.
        return rendered if rendered != _TEMPLATE_TOKEN.sub("", template) else None

    value = resolve_path(data, spec["path"]) if "path" in spec else None

    if value is not None and "pluck" in spec:
        if isinstance(value, list):
            plucked = [
                resolve_path(item, spec["pluck"]) if isinstance(item, dict) else item
                for item in value
            ]
            value = [str(p) for p in plucked if p not in (None, "")]
        elif isinstance(value, dict):
            value = resolve_path(value, spec["pluck"])

    if isinstance(value, list) and "join" in spec:
        value = spec["join"].join(str(v) for v in value if v not in (None, ""))

    if value in (None, "", []) and "default" in spec:
        return spec["default"]
    return value


def map_record(data: Any, fields: dict[str, Any]) -> dict[str, Any]:
    """Apply a whole field map to one record."""
    return {name: apply_spec(data, spec) for name, spec in fields.items()}
