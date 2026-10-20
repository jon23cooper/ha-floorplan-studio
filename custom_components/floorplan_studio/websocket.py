"""floorplan_studio/load and floorplan_studio/version (any user), floorplan_studio/save (admin only)."""
from __future__ import annotations

from typing import Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.loader import async_get_integration

from .const import DOMAIN
from .storage import InvalidLayout, LayoutStore


@callback
def async_register(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, ws_load)
    websocket_api.async_register_command(hass, ws_save)
    websocket_api.async_register_command(hass, ws_version)


def _store(hass: HomeAssistant) -> LayoutStore | None:
    return hass.data.get(DOMAIN)


def _without_trace(layout: Any) -> Any:
    """A copy with every floor's trace image left out. Stored data is untouched; a trace can be megabytes."""
    floors = layout.get("floors") if isinstance(layout, dict) else None
    if not isinstance(floors, dict):
        return layout
    return {**layout, "floors": {k: ({n: v for n, v in f.items() if n != "trace"} if isinstance(f, dict) else f) for k, f in floors.items()}}


@websocket_api.websocket_command({vol.Required("type"): "floorplan_studio/load", vol.Optional("with_trace", default=False): bool})
@websocket_api.async_response
async def ws_load(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    store = _store(hass)
    if store is None:
        connection.send_error(msg["id"], "not_loaded", "Floorplan Studio is not set up. Add it under Settings, Devices & services.")
        return
    layout = await store.async_load()
    # Traces are scanned plans, often with an address on them, and the card never draws them: only the Studio (admin) asks.
    if not (msg["with_trace"] and connection.user.is_admin):
        layout = _without_trace(layout)
    connection.send_result(msg["id"], {"layout": layout})


@websocket_api.websocket_command({vol.Required("type"): "floorplan_studio/save", vol.Required("layout"): dict})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_save(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    store = _store(hass)
    if store is None:
        connection.send_error(msg["id"], "not_loaded", "Floorplan Studio is not set up. Add it under Settings, Devices & services.")
        return
    try:
        await store.async_save(msg["layout"])
    except InvalidLayout as err:
        connection.send_error(msg["id"], "invalid_format", str(err))
        return
    hass.bus.async_fire("floorplan_studio_updated")  # open cards reload
    connection.send_result(msg["id"], {"ok": True})


@websocket_api.websocket_command({vol.Required("type"): "floorplan_studio/version"})
@websocket_api.async_response
async def ws_version(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """The installed version, so an open page that is older than it can ask for a reload."""
    connection.send_result(msg["id"], {"version": str((await async_get_integration(hass, DOMAIN)).version)})
