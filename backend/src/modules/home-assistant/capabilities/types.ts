export interface DeviceCapability {
  name: string;
  readable: boolean;
  controllable: boolean;
  operations: string[];
  metadata?: Record<string, unknown>;
}

export interface CapabilitySource {
  entityId: string;
  domain: string;
  attributes: Record<string, unknown>;
}
