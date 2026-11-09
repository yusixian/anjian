export interface RemoteProject {
  id: string;
  name: string;
}

export interface RemoteDeviceSummary {
  id: string;
  name: string;
  projects: string[];
  createdAt: number;
  expiresAt: number;
}

export interface RemoteDevicesResponse {
  devices: RemoteDeviceSummary[];
  projects: RemoteProject[];
  origin: string;
}

export interface RemotePairingSummary {
  code: string;
  name: string;
  expiresAt: number;
}

export interface RemotePairingResponse {
  pairing: RemotePairingSummary;
  projects: RemoteProject[];
}
