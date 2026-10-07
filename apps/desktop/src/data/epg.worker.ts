import { parseXMLTV, type EpgData } from "@kinonyx/epg";

export interface EpgWorkerRequest {
  id: number;
  xml: string;
}

export interface EpgWorkerResponse {
  id: number;
  data?: EpgData;
  error?: string;
}

self.onmessage = (e: MessageEvent<EpgWorkerRequest>) => {
  const { id, xml } = e.data;
  try {
    const data = parseXMLTV(xml);
    const reply: EpgWorkerResponse = { id, data };
    self.postMessage(reply);
  } catch (err) {
    const reply: EpgWorkerResponse = { id, error: err instanceof Error ? err.message : String(err) };
    self.postMessage(reply);
  }
};
