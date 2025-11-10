import type { Env } from '../types/env'

// Minimal Mailjet REST helpers (avoid heavy client in Worker)
const mailjetFetch = async (
  resourcePath: string,
  apiKey: string,
  apiSecret: string,
  query?: Record<string, string | undefined>
) => {
  const url = new URL(`https://api.mailjet.com/v3/REST/${resourcePath}`)
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v != null && v !== '') url.searchParams.set(k, String(v))
    }
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Basic ${btoa(`${apiKey}:${apiSecret}`)}` }
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function fetchWorkerLogs(env: Env, sinceISO?: string, untilISO?: string, scriptName?: string) {
  const accountId = env.CF_ACCOUNT_ID
  const apiToken = env.CF_API_TOKEN
  const script = scriptName || env.CF_WORKER_SCRIPT || 'nocturne-functions'
  if (!accountId || !apiToken) throw new Error('Missing Cloudflare API credentials')
  const since = sinceISO || new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const until = untilISO || new Date().toISOString()
  const query = `
  query getWorkerLogs($accountId: String!, $since: Time!, $until: Time!, $scriptName: String!) {
    viewer { accounts(filter: { accountTag: $accountId }) {
      workersInvocationsAdaptive(
        filter: { scriptName: $scriptName, datetime_geq: $since, datetime_leq: $until },
        limit: 100,
        orderBy: [datetime_ASC]
      ) {
        timestamp
        outcome
        exceptions { name message }
        logs { level message timestamp }
      }
    }}
  }`
  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` },
    body: JSON.stringify({ query, variables: { accountId, since, until, scriptName: script } })
  })
  if (!res.ok) throw new Error(await res.text())
  interface InvocationLogEntry {
    timestamp: string
    outcome: string
    exceptions?: Array<{ name?: string; message?: string }>
    logs?: Array<{ level?: string; message?: string; timestamp?: string }>
  }
  interface WorkerLogResponse {
    data?: { viewer?: { accounts?: Array<{ workersInvocationsAdaptive?: InvocationLogEntry[] }> } }
  }
  const data: WorkerLogResponse = await res.json()
  return data.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive || []
}

// New Messages API endpoints
export async function getMessages(env: Env, params: {
  Campaign?: string;
  Contact?: string;
  FromTS?: string;
  ToTS?: string;
  FromType?: string;
  MessageStatus?: string;
  Limit?: string;
  Offset?: string;
  ShowSubject?: string;
}) {
  const { MAILJET_API_KEY: apiKey, MAILJET_SECRET_KEY: secret } = env
  if (!apiKey || !secret) throw new Error('Missing Mailjet credentials')
  return mailjetFetch('message', apiKey, secret, {
    ...(params.Campaign ? { Campaign: params.Campaign } : {}),
    ...(params.Contact ? { Contact: params.Contact } : {}),
    ...(params.FromTS ? { FromTS: params.FromTS } : {}),
    ...(params.ToTS ? { ToTS: params.ToTS } : {}),
    ...(params.FromType ? { FromType: params.FromType } : {}),
    ...(params.MessageStatus ? { MessageStatus: params.MessageStatus } : {}),
    Limit: params.Limit || '100',
    Offset: params.Offset || '0',
    ShowSubject: params.ShowSubject || 'true',
  })
}

export async function getMessage(env: Env, messageId: string) {
  const { MAILJET_API_KEY: apiKey, MAILJET_SECRET_KEY: secret } = env
  if (!apiKey || !secret) throw new Error('Missing Mailjet credentials')
  return mailjetFetch(`message/${messageId}`, apiKey, secret)
}

export async function getMessageHistory(env: Env, messageId: string) {
  const { MAILJET_API_KEY: apiKey, MAILJET_SECRET_KEY: secret } = env
  if (!apiKey || !secret) throw new Error('Missing Mailjet credentials')
  return mailjetFetch(`messagehistory/${messageId}`, apiKey, secret)
}

export async function getMessageInformation(env: Env, params: {
  CampaignID?: string;
  FromTS?: string;
  ToTS?: string;
  MessageStatus?: string;
  Limit?: string;
  Offset?: string;
}) {
  const { MAILJET_API_KEY: apiKey, MAILJET_SECRET_KEY: secret } = env
  if (!apiKey || !secret) throw new Error('Missing Mailjet credentials')
  return mailjetFetch('messageinformation', apiKey, secret, {
    ...(params.CampaignID ? { CampaignID: params.CampaignID } : {}),
    ...(params.FromTS ? { FromTS: params.FromTS } : {}),
    ...(params.ToTS ? { ToTS: params.ToTS } : {}),
    ...(params.MessageStatus ? { MessageStatus: params.MessageStatus } : {}),
    Limit: params.Limit || '100',
    Offset: params.Offset || '0',
  })
}

export async function getMessageSentStatistics(env: Env, messageId?: string) {
  const { MAILJET_API_KEY: apiKey, MAILJET_SECRET_KEY: secret } = env
  if (!apiKey || !secret) throw new Error('Missing Mailjet credentials')
  const path = messageId ? `messagesentstatistics/${messageId}` : 'messagesentstatistics'
  return mailjetFetch(path, apiKey, secret)
}


