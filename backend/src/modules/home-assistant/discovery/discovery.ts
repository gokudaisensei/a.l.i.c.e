import type { HomeAssistantGateway } from "../gateway";
import { buildInventory, type Inventory } from "./inventory";

export async function discover(gateway: HomeAssistantGateway): Promise<{ inventory: Inventory; states: Awaited<ReturnType<HomeAssistantGateway["getStates"]>> }> {
  const [areas, devices, entityRegistry, states, services] = await Promise.all([
    gateway.getAreas(),
    gateway.getDevices(),
    gateway.getEntityRegistry(),
    gateway.getStates(),
    gateway.getServices(),
  ]);
  return { inventory: buildInventory({ areas, devices, entityRegistry, states, services }), states };
}
