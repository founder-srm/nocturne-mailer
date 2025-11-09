import mailjet from "node-mailjet";

// Types for statcounters query parameters
export interface StatCountersParams {
  SourceId?: string; // Campaign/List/Sender ID depending on CounterSource
  CounterSource?: string; // Campaign | ApiKey | List | Sender
  CounterTiming?: string; // Message | Event
  CounterResolution?: string; // Lifetime | Day | Hour | FiveMinutes
  FromTS?: string; // epoch or timestamp string
  ToTS?: string; // epoch or timestamp string
}

export interface LinkClickParams { CampaignId: string }
export interface RecipientEspParams { CampaignId: string }

const client = (apiKey: string, apiSecret: string) => mailjet.apiConnect(apiKey, apiSecret);

export const fetchMailjetStatCounters = async (
  apiKey: string,
  apiSecret: string,
  params: StatCountersParams
) => {
  const req = client(apiKey, apiSecret)
    .get('statcounters')
    .request({
      ...(params.SourceId ? { SourceId: params.SourceId } : {}),
      CounterSource: params.CounterSource || 'ApiKey',
      CounterTiming: params.CounterTiming || 'Message',
      CounterResolution: params.CounterResolution || 'Lifetime',
      ...(params.FromTS ? { FromTS: params.FromTS } : {}),
      ...(params.ToTS ? { ToTS: params.ToTS } : {}),
    });
  const res = await req;
  return res.body;
};

export const fetchMailjetLinkClicks = async (
  apiKey: string,
  apiSecret: string,
  params: LinkClickParams
) => {
  const req = client(apiKey, apiSecret)
    .get('statistics')
    .action('link-click')
    .request({ CampaignId: params.CampaignId });
  const res = await req;
  return res.body;
};

export const fetchMailjetRecipientEsp = async (
  apiKey: string,
  apiSecret: string,
  params: RecipientEspParams
) => {
  const req = client(apiKey, apiSecret)
    .get('statistics')
    .action('recipient-esp')
    .request({ CampaignId: params.CampaignId });
  const res = await req;
  return res.body;
};
