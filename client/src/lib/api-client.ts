/**
 * API Client for Nocturne Mailer
 * Handles authentication and requests to the Hono backend
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787'
const API_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN || ''

export interface APIError {
  error: string
  details?: string
}

export interface SuccessEnvelope<T> {
  success: true
  data: T
}

export interface ErrorEnvelope {
  success: false
  error: string
}

export type APIResponse<T> = SuccessEnvelope<T> | ErrorEnvelope

// Mailjet Messages API types
export interface MailjetMessage {
  ID: number
  ArrivedAt: string
  Status: string
  From?: string
  To?: string
  Subject?: string
  MessageSize?: number
  SpamassassinScore?: number
}

export interface MailjetMessageHistory {
  EventType: string
  EventAt: string
  UserAgent?: string
  Url?: string
  Geo?: string
}

export interface MailjetMessageInformation {
  CampaignID?: number
  ClickTrackedCount?: number
  OpenTrackedCount?: number
  Total?: number
  MessageSize?: number
  SpamassassinScore?: number
}

class APIClient {
  private baseURL: string
  private token: string

  constructor(baseURL: string, token: string) {
    this.baseURL = baseURL
    this.token = token
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseURL}${endpoint}`
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.token}`,
      ...options.headers,
    }

    const response = await fetch(url, {
      ...options,
      headers,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }))
      throw new Error(error.error || `API Error: ${response.status}`)
    }

    return response.json()
  }

  // Emails
  async getEmails(params?: { status?: string; limit?: number }) {
    const query = new URLSearchParams()
    if (params?.status) query.append('status', params.status)
    if (params?.limit) query.append('limit', params.limit.toString())
    
    return this.request<Array<{
      id: string
      recipient: string
      subject: string
      body: string
      status: 'queued' | 'processing' | 'sent' | 'failed' | 'dead'
      retry_count: number
      created_at: string
      updated_at: string
    }>>(`/api/emails?${query.toString()}`)
  }

  async getEmail(id: string) {
    return this.request<{
      id: string
      recipient: string
      subject: string
      body: string
      status: string
      retry_count: number
      created_at: string
      updated_at: string
    }>(`/api/emails/${id}`)
  }

  async getEmailStats() {
    return this.request<{
      queued: number
      processing: number
      sent: number
      failed: number
      dead: number
      total: number
    }>('/api/emails/stats')
  }

  async getEmailsPaginated(params?: {
    limit?: number
    offset?: number
    status?: string
    orderBy?: 'created_at' | 'updated_at'
    order?: 'ASC' | 'DESC'
  }) {
    const query = new URLSearchParams()
    if (params?.limit) query.append('limit', params.limit.toString())
    if (params?.offset) query.append('offset', params.offset.toString())
    if (params?.status) query.append('status', params.status)
    if (params?.orderBy) query.append('orderBy', params.orderBy)
    if (params?.order) query.append('order', params.order)
    
    return this.request<{
      emails: Array<{
        id: string
        recipient: string
        subject: string
        body: string
        status: 'queued' | 'processing' | 'sent' | 'failed' | 'dead'
        retry_count: number
        created_at: string
        updated_at: string
      }>
      total: number
      limit: number
      offset: number
      hasMore: boolean
    }>(`/api/emails/paginated?${query.toString()}`)
  }

  async sendEmails(emails: Array<{ recipient: string; subject: string; body: string }>) {
    return this.request<{ message: string; jobIds: string[] }>('/api/send', {
      method: 'POST',
      body: JSON.stringify(emails),
    })
  }

  async sendBulkEmails(recipients: string[], template: { subject: string; body: string }) {
    return this.request<{ message: string; jobIds: string[]; recipientCount: number }>('/api/send/bulk', {
      method: 'POST',
      body: JSON.stringify({ recipients, template }),
    })
  }

  // Admin - Logs
  async getLogs(params?: { since?: string; until?: string; scriptName?: string }) {
    const query = new URLSearchParams()
    if (params?.since) query.append('since', params.since)
    if (params?.until) query.append('until', params.until)
    if (params?.scriptName) query.append('scriptName', params.scriptName)
    
    return this.request<APIResponse<Array<{
      timestamp: string
      outcome: string
      exceptions?: Array<{ name?: string; message?: string }>
      logs?: Array<{ level?: string; message?: string; timestamp?: string }>
    }>>>(`/api/admin/logs?${query.toString()}`)
  }

  // Admin - Mailjet Messages API
  async getMessages(params?: {
    campaign?: string
    contact?: string
    fromTs?: string
    toTs?: string
    fromType?: string
    messageStatus?: string
    limit?: number
    offset?: number
    showSubject?: boolean
  }) {
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
    
    return this.request<APIResponse<{ Data: MailjetMessage[]; Count: number; Total: number }>>(`/api/admin/mailjet/messages?${query.toString()}`)
  }

  async getMessage(messageId: string) {
    return this.request<APIResponse<{ Data: MailjetMessage[] }>>(`/api/admin/mailjet/messages/${messageId}`)
  }

  async getMessageHistory(messageId: string) {
    return this.request<APIResponse<{ Data: MailjetMessageHistory[] }>>(`/api/admin/mailjet/messages/${messageId}/history`)
  }

  async getMessageInformation(params?: {
    campaignId?: string
    messageStatus?: string
  }) {
    const query = new URLSearchParams()
    if (params?.campaignId) query.append('CampaignID', params.campaignId)
    if (params?.messageStatus) query.append('MessageStatus', params.messageStatus)
    
    return this.request<APIResponse<{ Data: MailjetMessageInformation[] }>>(`/api/admin/mailjet/messageinformation?${query.toString()}`)
  }

  // Admin - Requeue
  async requeueEmail(id: string, reset = true) {
    return this.request<{
      id: string
      recipient: string
      subject: string
      body: string
      status: string
      retry_count: number
      created_at: string
      updated_at: string
    }>(`/api/admin/emails/${id}/requeue?reset=${reset}`, {
      method: 'POST',
    })
  }
}

export const apiClient = new APIClient(API_BASE_URL, API_TOKEN)
