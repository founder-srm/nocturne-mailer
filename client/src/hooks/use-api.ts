/**
 * SWR Hooks for Nocturne Mailer Dashboard
 */

import useSWR, { type SWRConfiguration } from 'swr'
import { apiClient } from '@/lib/api-client'

const defaultConfig: SWRConfiguration = {
  revalidateOnFocus: false,
  revalidateOnReconnect: true,
  refreshInterval: 30000, // 30 seconds
}

// Email hooks
export function useEmails(params?: { status?: string; limit?: number }, config?: SWRConfiguration) {
  const query = new URLSearchParams()
  if (params?.status) query.append('status', params.status)
  if (params?.limit) query.append('limit', params.limit.toString())
  
  const key = `/api/emails?${query.toString()}`
  
  return useSWR(
    key,
    () => apiClient.getEmails(params),
    { ...defaultConfig, ...config }
  )
}

export function useEmail(id: string | null, config?: SWRConfiguration) {
  return useSWR(
    id ? `/api/emails/${id}` : null,
    () => id ? apiClient.getEmail(id) : null,
    { ...defaultConfig, ...config }
  )
}

// Admin logs hook
export function useLogs(
  params?: { since?: string; until?: string; scriptName?: string },
  config?: SWRConfiguration
) {
  const query = new URLSearchParams()
  if (params?.since) query.append('since', params.since)
  if (params?.until) query.append('until', params.until)
  if (params?.scriptName) query.append('scriptName', params.scriptName)
  
  const key = `/api/admin/logs?${query.toString()}`
  
  return useSWR(
    key,
    async () => {
      const response = await apiClient.getLogs(params)
      return response.success ? response.data : []
    },
    { ...defaultConfig, ...config }
  )
}

// Mailjet Messages API hooks
export function useMessages(
  params?: {
    campaign?: string
    contact?: string
    fromTs?: string
    toTs?: string
    fromType?: string
    messageStatus?: string
    limit?: number
    offset?: number
    showSubject?: boolean
  },
  config?: SWRConfiguration
) {
  const query = new URLSearchParams()
  if (params?.campaign) query.append('Campaign', params.campaign)
  if (params?.contact) query.append('Contact', params.contact)
  if (params?.fromTs) query.append('FromTS', params.fromTs)
  if (params?.toTs) query.append('ToTS', params.toTs)
  if (params?.fromType) query.append('FromType', params.fromType)
  if (params?.messageStatus) query.append('MessageStatus', params.messageStatus)
  if (params?.limit) query.append('Limit', params.limit.toString())
  if (params?.offset) query.append('Offset', params.offset.toString())
  if (params?.showSubject !== undefined) query.append('ShowSubject', params.showSubject.toString())
  
  const key = `/api/admin/mailjet/messages?${query.toString()}`
  
  return useSWR(
    key,
    async () => {
      const response = await apiClient.getMessages(params)
      return response.success ? response.data : null
    },
    { ...defaultConfig, ...config }
  )
}

export function useMessage(messageId: string | null, config?: SWRConfiguration) {
  return useSWR(
    messageId ? `/api/admin/mailjet/messages/${messageId}` : null,
    async () => {
      if (!messageId) return null
      const response = await apiClient.getMessage(messageId)
      return response.success ? response.data : null
    },
    { ...defaultConfig, ...config }
  )
}

export function useMessageHistory(messageId: string | null, config?: SWRConfiguration) {
  return useSWR(
    messageId ? `/api/admin/mailjet/messages/${messageId}/history` : null,
    async () => {
      if (!messageId) return null
      const response = await apiClient.getMessageHistory(messageId)
      return response.success ? response.data : null
    },
    { ...defaultConfig, ...config }
  )
}

export function useMessageInformation(
  params?: {
    campaignId?: string
    messageStatus?: string
  },
  config?: SWRConfiguration
) {
  const query = new URLSearchParams()
  if (params?.campaignId) query.append('CampaignID', params.campaignId)
  if (params?.messageStatus) query.append('MessageStatus', params.messageStatus)
  
  const key = `/api/admin/mailjet/messageinformation?${query.toString()}`
  
  return useSWR(
    key,
    async () => {
      const response = await apiClient.getMessageInformation(params)
      return response.success ? response.data : null
    },
    { ...defaultConfig, ...config }
  )
}
