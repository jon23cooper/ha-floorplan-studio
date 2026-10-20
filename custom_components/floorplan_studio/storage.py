"""One layout, kept in `.storage/floorplan_studio.layout`."""
from __future__ import annotations

import asyncio
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import LAYOUT_VERSION, STORAGE_KEY, STORAGE_VERSION


class InvalidLayout(ValueError):
    """The layout is not a version 2 object."""


class RevConflict(Exception):
    """The caller's expected revision is not the stored one: someone saved in between."""

    def __init__(self, current: int) -> None:
        super().__init__(f"stored revision is {current}")
        self.current = current


class LayoutStore:
    """The layout and a revision counter, stored as `{"rev": n, "layout": {...}}`.

    Older installs stored the layout itself, with no wrapper. That reads as rev 0
    and is rewritten in the new shape on the next save.
    """

    def __init__(self, hass: HomeAssistant) -> None:
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        # Check and write must not interleave, or two saves with the same expected_rev both win.
        self._lock = asyncio.Lock()

    async def async_load_with_rev(self) -> tuple[dict[str, Any] | None, int]:
        data = await self._store.async_load()
        if isinstance(data, dict) and isinstance(data.get("layout"), dict):
            rev = data.get("rev")
            return data["layout"], rev if isinstance(rev, int) and rev >= 0 else 0
        return data, 0

    async def async_load(self) -> dict[str, Any] | None:
        return (await self.async_load_with_rev())[0]

    async def async_save(self, layout: Any, expected_rev: int | None = None) -> int:
        """Writes the layout and returns the new revision. With `expected_rev`, refuses (RevConflict) when it is not the stored one."""
        # The full schema check lives in the editor (src/core/schema.ts); here only the door.
        if not isinstance(layout, dict) or layout.get("version") != LAYOUT_VERSION:
            raise InvalidLayout(f"layout.version must be {LAYOUT_VERSION}")
        async with self._lock:
            _, current = await self.async_load_with_rev()
            if expected_rev is not None and expected_rev != current:
                raise RevConflict(current)
            await self._store.async_save({"rev": current + 1, "layout": layout})
            return current + 1
