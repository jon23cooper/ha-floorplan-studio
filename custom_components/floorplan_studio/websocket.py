"""floorplan_studio/load and floorplan_studio/version (any user), floorplan_studio/save (admin only).

load replies `{layout, rev}`; save replies `{ok, rev}`. A save may carry `expected_rev`; when it is not the stored
revision the reply is the error `conflict` and nothing is written. Without it the save overwrites, as before."""
from __future__ import annotations

from typing import Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.loader import async_get_integration

from .const import DOMAIN
from .storage import InvalidLayout, LayoutStore, RevConflict


@callback
def async_register(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, ws_load)
    websocket_api.async_register_command(hass, ws_save)
    websocket_api.async_register_command(hass, ws_version)


def _store(hass: HomeAssistant) -> LayoutStore | None:
    return hass.data.get(DOMAIN)


@websocket_api.websocket_command({vol.Required("type"): "floorplan_studio/load"})
@websocket_api.async_response
async def ws_load(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    store = _store(hass)
    if store is None:
        connection.send_error(msg["id"], "not_loaded", "Floorplan Studio is not set up. Add it under Settings, Devices & services.")
        return
    layout, rev = await store.async_load_with_rev()
    connection.send_result(msg["id"], {"layout": layout, "rev": rev})


@websocket_api.websocket_command({vol.Required("type"): "floorplan_studio/save", vol.Required("layout"): dict, vol.Optional("expected_rev"): vol.All(int, vol.Range(min=0))})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_save(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    store = _store(hass)
    if store is None:
        connection.send_error(msg["id"], "not_loaded", "Floorplan Studio is not set up. Add it under Settings, Devices & services.")
        return
    try:
        rev = await store.async_save(msg["layout"], msg.get("expected_rev"))
    except InvalidLayout as err:
        connection.send_error(msg["id"], "invalid_format", str(err))
        return
    except RevConflict as err:
        connection.send_error(msg["id"], "conflict", f"The plan was saved elsewhere (revision {err.current}, you have {msg['expected_rev']}). Reload it, or overwrite it with yours.")
        return
    connection.send_result(msg["id"], {"ok": True, "rev": rev})


@websocket_api.websocket_command({vol.Required("type"): "floorplan_studio/version"})
@websocket_api.async_response
async def ws_version(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """The installed version, so an open page that is older than it can ask for a reload."""
    connection.send_result(msg["id"], {"version": str((await async_get_integration(hass, DOMAIN)).version)})
