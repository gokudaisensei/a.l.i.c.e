import { buildInventory, type RawDiscovery } from "../../discovery/inventory";
import type { HaDeviceRegistryEntry, HaEntityRegistryEntry } from "../../types";
import { state } from "../../testing";

type Dev = Partial<HaDeviceRegistryEntry> & { id: string; name: string };
const dev = (d: Dev): HaDeviceRegistryEntry => ({ area_id: null, manufacturer: null, model: null, ...d });
type Reg = Partial<HaEntityRegistryEntry> & { entity_id: string };
const reg = (r: Reg): HaEntityRegistryEntry => ({ device_id: null, area_id: null, platform: "test", has_entity_name: true, ...r });

const MAC = ["mac", "aa:bb:cc:dd:ee:01"] as [string, string];

/** A custom-flashed Echo Show running as an ESPHome device, plus a few other household shapes. */
export const homeRaw = (): RawDiscovery => ({
    areas: [
      { area_id: "kitchen", name: "Kitchen" },
      { area_id: "living", name: "Living room" },
      { area_id: "hall", name: "Hall" },
    ],
    devices: [
      // ESPHome Echo, and the same hardware seen through a second integration (same MAC)
      dev({ id: "echo", name: "Echo Show", area_id: "kitchen", manufacturer: "Amazon", model: "Echo Show 8", identifiers: [["esphome", "echo01"]], connections: [MAC] }),
      dev({ id: "echo_alexa", name: "Kitchen display (Alexa)", area_id: "kitchen", identifiers: [["alexa_media", "G090"]], connections: [MAC] }),
      // Hue bridge with two bulbs behind it
      dev({ id: "hue_bridge", name: "Hue Bridge", manufacturer: "Signify", identifiers: [["hue", "bridge"]] }),
      dev({ id: "floor", name: "Living room Floor lamp", area_id: "living", via_device_id: "hue_bridge", identifiers: [["hue", "b1"]] }),
      dev({ id: "ceiling", name: "Ceiling lights", area_id: "living", via_device_id: "hue_bridge", identifiers: [["hue", "b2"]] }),
      // Smart plug: a switch and power readings, no primary-class entity
      dev({ id: "kettle", name: "Kettle plug", area_id: "kitchen", manufacturer: "Tapo", identifiers: [["tapo", "k1"]] }),
      // Door contact sensor: only binary_sensor + battery
      dev({ id: "front_contact", name: "Front door sensor", area_id: "hall", identifiers: [["zha", "c1"]] }),
      // A service, not hardware
      dev({ id: "sun", name: "Sun", entry_type: "service", identifiers: [["sun", "x"]] }),
    ],
    entityRegistry: [
      reg({ entity_id: "media_player.echo_show", device_id: "echo", platform: "esphome", name: null, original_name: null }),
      reg({ entity_id: "camera.echo_show_camera", device_id: "echo", platform: "esphome", original_name: "Camera" }),
      reg({ entity_id: "switch.echo_show_microphone_mute", device_id: "echo", platform: "esphome", original_name: "Microphone mute" }),
      reg({ entity_id: "number.echo_show_volume", device_id: "echo", platform: "esphome", original_name: "Volume" }),
      reg({ entity_id: "binary_sensor.echo_show_camera_shutter", device_id: "echo", platform: "esphome", original_name: "Camera shutter" }),
      reg({ entity_id: "sensor.echo_show_wifi_signal", device_id: "echo", platform: "esphome", original_name: "WiFi signal", entity_category: "diagnostic" }),
      reg({ entity_id: "sensor.echo_show_uptime", device_id: "echo", platform: "esphome", original_name: "Uptime", entity_category: "diagnostic" }),
      reg({ entity_id: "button.echo_show_restart", device_id: "echo", platform: "esphome", original_name: "Restart", entity_category: "config" }),
      reg({ entity_id: "sensor.kitchen_display_next_alarm", device_id: "echo_alexa", platform: "alexa_media", original_name: "Next alarm" }),
      reg({ entity_id: "button.hue_bridge_identify", device_id: "hue_bridge", platform: "hue", original_name: "Identify", entity_category: "config" }),
      reg({ entity_id: "light.floor_lamp", device_id: "floor", platform: "hue", name: null, original_name: null, has_entity_name: false }),
      reg({ entity_id: "light.ceiling_lights", device_id: "ceiling", platform: "hue", name: null, original_name: null }),
      reg({ entity_id: "switch.kettle_plug", device_id: "kettle", platform: "tapo", name: null, original_name: null }),
      reg({ entity_id: "sensor.kettle_plug_power", device_id: "kettle", platform: "tapo", original_name: "Power" }),
      reg({ entity_id: "binary_sensor.front_door_sensor_door", device_id: "front_contact", platform: "zha", original_name: "Door" }),
      reg({ entity_id: "sensor.front_door_sensor_battery", device_id: "front_contact", platform: "zha", original_name: "Battery" }),
      reg({ entity_id: "sensor.sun_next_dawn", device_id: "sun", platform: "sun", original_name: "Next dawn" }),
    ],
    states: [
      state("media_player.echo_show", "idle", { friendly_name: "Echo Show" }),
      state("camera.echo_show_camera", "idle", { friendly_name: "Echo Show Camera" }),
      state("switch.echo_show_microphone_mute", "off", { friendly_name: "Echo Show Microphone mute" }),
      state("number.echo_show_volume", "40", { friendly_name: "Echo Show Volume", min: 0, max: 100 }),
      state("binary_sensor.echo_show_camera_shutter", "off", { friendly_name: "Echo Show Camera shutter" }),
      state("sensor.echo_show_wifi_signal", "-61", { friendly_name: "Echo Show WiFi signal", device_class: "signal_strength", unit_of_measurement: "dBm" }),
      state("sensor.echo_show_uptime", "12345", { friendly_name: "Echo Show Uptime" }),
      state("button.echo_show_restart", "unknown", { friendly_name: "Echo Show Restart" }),
      state("sensor.kitchen_display_next_alarm", "unknown", { friendly_name: "Kitchen display (Alexa) Next alarm" }),
      state("button.hue_bridge_identify", "unknown", { friendly_name: "Hue Bridge Identify" }),
      state("light.floor_lamp", "on", { friendly_name: "Living room Floor lamp", supported_color_modes: ["brightness"] }),
      state("light.ceiling_lights", "off", { friendly_name: "Ceiling lights", supported_color_modes: ["brightness"] }),
      state("switch.kettle_plug", "off", { friendly_name: "Kettle plug" }),
      state("sensor.kettle_plug_power", "0", { friendly_name: "Kettle plug Power", device_class: "power", unit_of_measurement: "W" }),
      state("binary_sensor.front_door_sensor_door", "off", { friendly_name: "Front door sensor Door", device_class: "door" }),
      state("sensor.front_door_sensor_battery", "88", { friendly_name: "Front door sensor Battery", device_class: "battery", unit_of_measurement: "%" }),
      state("sensor.sun_next_dawn", "2026-11-06T00:00:00Z", { friendly_name: "Sun Next dawn", device_class: "timestamp" }),
      // No device at all: a helper and a YAML sensor
      state("input_boolean.movie_mode", "off", { friendly_name: "Movie mode" }),
      state("sensor.outdoor_temp_2", "21.5", { friendly_name: "outdoor_temp_2", device_class: "temperature", unit_of_measurement: "°C" }),
    ],
    services: {},
});

export const homeInventory = () => buildInventory(homeRaw());
